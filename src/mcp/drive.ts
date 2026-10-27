// Server-side Drive access for the MCP Worker. Finds and reads the same file the PWA uses
// (src/lib/driveClient.ts: FOLDER_NAME, FILE_NAME). It never creates the folder or the
// file, so a user with no PWA data sees a clear "not found" instead of an empty file
// appearing in their Drive; it only overwrites the file the app already made.
import type { AppData } from "../types/models.ts";

const FOLDER_NAME = "Habit Assistant";
const FILE_NAME = "habit-assistant-data.json";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFileRef {
  fileId: string;
  modifiedTime: string;
}

/** Drive refused the token (401) or the scope (403). */
export class DriveAccessError extends Error {
  constructor(public readonly status: number) {
    super(`Google Drive refused access (HTTP ${status}).`);
    this.name = "DriveAccessError";
  }
}

/** No data file this OAuth client can see: either the PWA never saved one, or `drive.file` hides it from this client. */
export class DriveFileNotFoundError extends Error {
  constructor(public readonly missing: "folder" | "file") {
    super(`No "${missing === "folder" ? FOLDER_NAME : FILE_NAME}" visible in Google Drive.`);
    this.name = "DriveFileNotFoundError";
  }
}

/** The file changed since it was read (the app, or another Claude chat, saved in between). Same rule as the app's driveClient.ts: re-read and replay, never merge. */
export class DriveConflictError extends Error {
  constructor() {
    super("The data file changed since it was read.");
    this.name = "DriveConflictError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function driveFetch(fetchFn: FetchLike, accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401 || res.status === 403) throw new DriveAccessError(res.status);
  if (!res.ok) throw new Error(`Google Drive request failed (HTTP ${res.status}).`);
  return res;
}

function driveGet(fetchFn: FetchLike, accessToken: string, path: string): Promise<Response> {
  return driveFetch(fetchFn, accessToken, `${DRIVE_API}${path}`);
}

export async function findDataFile(fetchFn: FetchLike, accessToken: string): Promise<DriveFileRef> {
  const folderQuery = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const folders = (await (await driveGet(fetchFn, accessToken, `/files?q=${folderQuery}&fields=files(id)`)).json()) as {
    files: { id: string }[];
  };
  if (folders.files.length === 0) throw new DriveFileNotFoundError("folder");

  const fileQuery = encodeURIComponent(`name='${FILE_NAME}' and '${folders.files[0].id}' in parents and trashed=false`);
  const files = (await (
    await driveGet(fetchFn, accessToken, `/files?q=${fileQuery}&fields=files(id,modifiedTime)`)
  ).json()) as { files: { id: string; modifiedTime: string }[] };
  if (files.files.length === 0) throw new DriveFileNotFoundError("file");
  return { fileId: files.files[0].id, modifiedTime: files.files[0].modifiedTime };
}

export async function readDataFile(fetchFn: FetchLike, accessToken: string): Promise<{ ref: DriveFileRef; data: AppData }> {
  const ref = await findDataFile(fetchFn, accessToken);
  const data = (await (await driveGet(fetchFn, accessToken, `/files/${ref.fileId}?alt=media`)).json()) as AppData;
  return { ref, data };
}

/**
 * Overwrites the data file if it's still the version `ref` was read at. Like the app's
 * writeDataFile, the check and the upload are two requests, so two writers inside the
 * same instant can still both win; the app accepts the same window.
 */
export async function writeDataFile(fetchFn: FetchLike, accessToken: string, ref: DriveFileRef, data: AppData): Promise<DriveFileRef> {
  const current = (await (await driveGet(fetchFn, accessToken, `/files/${ref.fileId}?fields=modifiedTime`)).json()) as {
    modifiedTime: string;
  };
  if (current.modifiedTime !== ref.modifiedTime) throw new DriveConflictError();
  const res = await driveFetch(fetchFn, accessToken, `${DRIVE_UPLOAD_API}/files/${ref.fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const file = (await res.json()) as { id: string; modifiedTime: string };
  return { fileId: file.id, modifiedTime: file.modifiedTime };
}
