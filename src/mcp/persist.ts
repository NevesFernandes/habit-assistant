// Server-side saves with the app's conflict rule (§21): the file is overwritten only if
// it's still the version that was read; otherwise it's re-read and the same mutation is
// replayed on the fresh copy. No merge logic, so mutations work by id and re-derive
// anything they depend on from the data they're given.
import type { AppData } from "../types/models.ts";
import { rolloverPersistentTasks } from "../lib/dataStore.ts";
import { withUndoRecord } from "../lib/undo.ts";
import { DriveConflictError, type DriveFileRef } from "./drive.ts";

export interface LoadedFile {
  ref: DriveFileRef;
  data: AppData;
}

export interface FileStore {
  load(): Promise<LoadedFile>;
  /** Throws DriveConflictError when the file changed since `ref` was read. */
  save(ref: DriveFileRef, data: AppData): Promise<DriveFileRef>;
}

/** The first write plus two replays; a third conflict surfaces as DriveConflictError. */
export const MAX_WRITE_ATTEMPTS = 3;

/**
 * Applies `mutate` to the file and saves it. Every write first rolls unfinished one-off
 * tasks forward to `todayISO`, as the app does when it opens, so a task ticked here lands
 * on the day the app shows it. Returns the data as saved, or as read when nothing changed
 * (no write then).
 */
export async function persist(
  store: FileStore,
  first: LoadedFile,
  todayISO: string,
  mutate: (data: AppData) => AppData,
  // §70: each change is Claude's last one, for "undo that"; the undo itself isn't.
  options: { recordUndo?: boolean } = {},
): Promise<{ data: AppData; written: boolean }> {
  let loaded = first;
  for (let attempt = 1; ; attempt++) {
    const base = rolloverPersistentTasks(loaded.data, todayISO);
    const changed = mutate(base);
    const next = options.recordUndo === false ? changed : withUndoRecord(base, changed, "claude", todayISO);
    if (next === loaded.data) return { data: next, written: false };
    try {
      await store.save(loaded.ref, next);
      return { data: next, written: true };
    } catch (error) {
      if (!(error instanceof DriveConflictError) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
      loaded = await store.load();
    }
  }
}
