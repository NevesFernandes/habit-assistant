// Talks to the user's own Google Drive. Auth uses the narrow `drive.file`
// scope, and the data file lives in a visible "Habit Assistant" folder —
// see the "Storage" decision in CLAUDE.md for why (user data ownership).
import type { AppData } from "../types/models";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Habit Assistant";
const FILE_NAME = "habit-assistant-data.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// Google's access tokens last an hour (expires_in); nothing renews them on their own, so
// the app tracks expiresAt and refreshes before it passes — see GitHub issue #7.
export interface DriveSession {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/** Refresh this long before the real expiry, so a token can't lapse between a tap and its save. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

export function tokenNeedsRefresh(session: DriveSession, now = Date.now()): boolean {
  return now >= session.expiresAt - REFRESH_MARGIN_MS;
}

export interface DriveFileRef {
  fileId: string;
  modifiedTime: string;
}

export class DriveConflictError extends Error {
  constructor(public readonly currentModifiedTime: string) {
    super("The data file changed on another device since it was last loaded.");
    this.name = "DriveConflictError";
  }
}

/** Drive answered 401: the access token expired or was revoked. Recoverable by getting a new one. */
export class DriveAuthError extends Error {
  constructor() {
    super("Your Google sign-in has expired.");
    this.name = "DriveAuthError";
  }
}

/** A request failed outright (offline, DNS, etc.) even after one retry — see fetchWithRetry. */
export class DriveOfflineError extends Error {
  constructor() {
    super("You're offline.");
    this.name = "DriveOfflineError";
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

export function signIn(clientId: string): Promise<DriveSession> {
  return requestToken(clientId);
}

/**
 * A new token for someone who already granted access: prompt "" makes Google skip the
 * consent screen, so at most a popup opens and closes by itself. Browsers block popups not
 * started by a tap, so call this from one (or within a few seconds of it).
 */
export function refreshSession(clientId: string): Promise<DriveSession> {
  return requestToken(clientId, "");
}

async function requestToken(clientId: string, prompt?: string): Promise<DriveSession> {
  await loadGisScript();
  if (!window.google) throw new Error("Google Identity Services did not load.");

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        resolve({ accessToken: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 });
      },
      error_callback: (error) => reject(new Error(error.message ?? error.type)),
    });
    client.requestAccessToken(prompt === undefined ? undefined : { prompt });
  });
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 500;

async function attemptFetch(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    // Network failure (offline, DNS, etc.) rather than an HTTP error response.
    return null;
  }
}

/**
 * Drive's own guidance treats 5xx responses as generally transient — retry
 * once after a short delay before giving up. Also retries once on an actual
 * network failure (the initial fetch() call throwing, not just a bad status);
 * if that retry also fails outright, raises DriveOfflineError instead of a
 * raw TypeError, so callers can show a specific "you're offline" message.
 * Request bodies here are always plain strings (JSON or a multipart string),
 * so replaying them is safe.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const first = await attemptFetch(url, init);
  if (first && !RETRYABLE_STATUS.has(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  const second = await attemptFetch(url, init);
  if (!second) throw new DriveOfflineError();
  return second;
}

/** A 401 becomes DriveAuthError; anything else keeps its status and Google's short message, not the raw JSON. */
async function driveError(res: Response): Promise<Error> {
  if (res.status === 401) return new DriveAuthError();
  const text = await res.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    // not JSON — keep the text as it is
  }
  return new Error(`Drive API error ${res.status}: ${message}`);
}

async function driveFetch(session: DriveSession, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchWithRetry(`${DRIVE_API}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}` },
  });
  if (!res.ok) throw await driveError(res);
  return res;
}

export async function findOrCreateFolder(session: DriveSession): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await driveFetch(session, `/files?q=${q}&fields=files(id,name)`);
  const { files } = (await res.json()) as { files: { id: string }[] };
  if (files.length > 0) return files[0].id;

  const createRes = await driveFetch(session, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = (await createRes.json()) as { id: string };
  return folder.id;
}

export async function findDataFile(session: DriveSession, folderId: string): Promise<DriveFileRef | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(session, `/files?q=${q}&fields=files(id,modifiedTime)`);
  const { files } = (await res.json()) as { files: { id: string; modifiedTime: string }[] };
  if (files.length === 0) return null;
  return { fileId: files[0].id, modifiedTime: files[0].modifiedTime };
}

export async function createDataFile(
  session: DriveSession,
  folderId: string,
  data: AppData,
): Promise<DriveFileRef> {
  const boundary = "habit_assistant_boundary";
  const metadata = { name: FILE_NAME, parents: [folderId], mimeType: "application/json" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const res = await fetchWithRetry(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw await driveError(res);
  const file = (await res.json()) as { id: string; modifiedTime: string };
  return { fileId: file.id, modifiedTime: file.modifiedTime };
}

export async function readDataFile(session: DriveSession, fileId: string): Promise<AppData> {
  const res = await driveFetch(session, `/files/${fileId}?alt=media`);
  return res.json();
}

/**
 * Overwrites the data file, first checking the remote modifiedTime against
 * what we last saw. Throws DriveConflictError (carrying the actual current
 * modifiedTime) on a mismatch rather than attempting any merge here — the
 * caller (App.tsx's persist()) is what has the mutation available to replay
 * against fresh data — see §21 in Roadmap.md.
 */
export async function writeDataFile(
  session: DriveSession,
  ref: DriveFileRef,
  data: AppData,
): Promise<DriveFileRef> {
  const currentRes = await driveFetch(session, `/files/${ref.fileId}?fields=modifiedTime`);
  const current = (await currentRes.json()) as { modifiedTime: string };
  if (current.modifiedTime !== ref.modifiedTime) {
    throw new DriveConflictError(current.modifiedTime);
  }

  const res = await fetchWithRetry(`${DRIVE_UPLOAD_API}/files/${ref.fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await driveError(res);
  const file = (await res.json()) as { id: string; modifiedTime: string };
  return { fileId: file.id, modifiedTime: file.modifiedTime };
}
