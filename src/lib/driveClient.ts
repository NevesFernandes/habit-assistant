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

export interface DriveSession {
  accessToken: string;
}

export interface DriveFileRef {
  fileId: string;
  modifiedTime: string;
}

export class DriveConflictError extends Error {
  constructor() {
    super("The data file changed on another device since it was last loaded.");
    this.name = "DriveConflictError";
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

export async function signIn(clientId: string): Promise<DriveSession> {
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
        resolve({ accessToken: response.access_token });
      },
      error_callback: (error) => reject(new Error(error.message ?? error.type)),
    });
    client.requestAccessToken();
  });
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const RETRY_DELAY_MS = 500;

/**
 * Drive's own guidance treats 5xx responses as generally transient — retry
 * once after a short delay before giving up. Request bodies here are always
 * plain strings (JSON or a multipart string), so replaying them is safe.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!RETRYABLE_STATUS.has(res.status)) return res;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return fetch(url, init);
}

async function driveFetch(session: DriveSession, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchWithRetry(`${DRIVE_API}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  }
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
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  const file = (await res.json()) as { id: string; modifiedTime: string };
  return { fileId: file.id, modifiedTime: file.modifiedTime };
}

export async function readDataFile(session: DriveSession, fileId: string): Promise<AppData> {
  const res = await driveFetch(session, `/files/${fileId}?alt=media`);
  return res.json();
}

/**
 * Overwrites the data file, first checking the remote modifiedTime against
 * what we last saw. v1 has no merge logic — a conflict just means "reload
 * and try again" (see the open question logged in CLAUDE.md).
 */
export async function writeDataFile(
  session: DriveSession,
  ref: DriveFileRef,
  data: AppData,
): Promise<DriveFileRef> {
  const currentRes = await driveFetch(session, `/files/${ref.fileId}?fields=modifiedTime`);
  const current = (await currentRes.json()) as { modifiedTime: string };
  if (current.modifiedTime !== ref.modifiedTime) {
    throw new DriveConflictError();
  }

  const res = await fetchWithRetry(`${DRIVE_UPLOAD_API}/files/${ref.fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  const file = (await res.json()) as { id: string; modifiedTime: string };
  return { fileId: file.id, modifiedTime: file.modifiedTime };
}
