// §67: a short note on an item's day, like a journal line. One per item per day: a new one
// replaces it, an empty one removes it. Stored in AppData.notes, apart from the completion
// log, so un-ticking a day keeps its note and a missed day can have one. Shared by the
// app's chat and the Claude connector.
import type { AppData, DayNote } from "../types/models.ts";

export const NOTE_MAX_LENGTH = 500;

export function noteOn(data: Pick<AppData, "notes">, itemId: string, dateISO: string): string | undefined {
  return data.notes?.find((note) => note.itemId === itemId && note.date === dateISO)?.text;
}

/** Sets the note for that item and day; blank text removes it. */
export function setDayNote(data: AppData, itemId: string, dateISO: string, text: string): AppData {
  const trimmed = text.trim();
  const others = (data.notes ?? []).filter((note) => !(note.itemId === itemId && note.date === dateISO));
  if (!trimmed) return { ...data, notes: others };
  const note: DayNote = { id: crypto.randomUUID(), itemId, date: dateISO, text: trimmed };
  return { ...data, notes: [...others, note] };
}

/** Deleting an item erases its notes, as it erases its completion history. */
export function withoutNotesOf(data: AppData, ids: Set<string>): AppData {
  return data.notes ? { ...data, notes: data.notes.filter((note) => !ids.has(note.itemId)) } : data;
}
