// §70: "undo that": the last change made by chat, one per side (the app's chat, Claude), kept
// in the Drive file so it survives a reload and works for the stateless connector. A change
// is recorded by diffing the file before and after it, so no action has to report what it
// touched: the records it changed (items, completion log entries, notes, categories, the
// first day of the week) are kept as they were before and after. Undo puts the "before" back
// only if those records still match "after", so a later change from another device or from
// Claude is never overwritten; and only the same day, since the app looks forward. Undoing a
// delete brings the item back with its history. Pure: no Drive, no clock.
import type { AppData, Category, CompletionLogEntry, DayNote, Goal, Habit, RecurringTask, SingleTask, WeekStart } from "../types/models.ts";
import { rolloverPersistentTasks } from "./dataStore.ts";

export type UndoSide = "app" | "claude";
type Item = Habit | RecurringTask | SingleTask;

/** Each touched record by id, as it was; null = it didn't exist. */
export interface UndoSnapshot {
  items: Record<string, Item | null>;
  log: Record<string, CompletionLogEntry | null>;
  notes: Record<string, DayNote | null>;
  categories: Record<string, Category | null>;
  /** §71. Absent in records made before goals existed. */
  goals?: Record<string, Goal | null>;
  /** Present only when the change moved it; `value` absent = the default (Sunday). */
  weekStartsOn?: { value?: WeekStart };
}

export interface UndoRecord {
  /** The day the change was made; undo works only that day. */
  date: string;
  before: UndoSnapshot;
  after: UndoSnapshot;
}

export type UndoRecords = Partial<Record<UndoSide, UndoRecord>>;

const itemsOf = (data: AppData): Item[] => [...data.habits, ...data.recurringTasks, ...data.singleTasks];

/** JSON with sorted keys, so two copies of a record compare equal however they were built or read back. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

function byId<T extends { id: string }>(list: T[] | undefined): Map<string, T> {
  return new Map((list ?? []).map((entry) => [entry.id, entry]));
}

/** The records that differ between two lists, as they were in each. */
function diffById<T extends { id: string }>(before: T[] | undefined, after: T[] | undefined) {
  const a = byId(before);
  const b = byId(after);
  const was: Record<string, T | null> = {};
  const now: Record<string, T | null> = {};
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) ?? null;
    const y = b.get(id) ?? null;
    if (stable(x) !== stable(y)) {
      was[id] = x;
      now[id] = y;
    }
  }
  return { was, now };
}

/** What a change did, or undefined when it touched nothing undo looks after. */
export function diffChange(before: AppData, after: AppData): { before: UndoSnapshot; after: UndoSnapshot } | undefined {
  const items = diffById(itemsOf(before), itemsOf(after));
  const log = diffById(before.completionLog, after.completionLog);
  const notes = diffById(before.notes, after.notes);
  const categories = diffById(before.categories, after.categories);
  const goals = diffById(before.goals, after.goals);
  const weekMoved = (before.weekStartsOn ?? 0) !== (after.weekStartsOn ?? 0);
  const touched = [items.was, log.was, notes.was, categories.was, goals.was].some((part) => Object.keys(part).length > 0) || weekMoved;
  if (!touched) return undefined;
  return {
    before: { items: items.was, log: log.was, notes: notes.was, categories: categories.was, goals: goals.was, ...(weekMoved ? { weekStartsOn: { value: before.weekStartsOn } } : {}) },
    after: { items: items.now, log: log.now, notes: notes.now, categories: categories.now, goals: goals.now, ...(weekMoved ? { weekStartsOn: { value: after.weekStartsOn } } : {}) },
  };
}

/**
 * `after` with this change recorded as `side`'s last one. A save that touched nothing undo
 * looks after (a time zone, a message count) leaves the last change as it was.
 */
export function withUndoRecord(before: AppData, after: AppData, side: UndoSide, today: string): AppData {
  if (after === before) return after;
  // Unfinished one-off tasks moving to today isn't the change; compare both sides moved.
  const change = diffChange(rolloverPersistentTasks(before, today), rolloverPersistentTasks(after, today));
  // A record from an earlier day can't be undone any more, so it goes: a deleted item doesn't
  // linger in the file past the day it could come back.
  const current = Object.fromEntries(Object.entries(after.undo ?? {}).filter(([, record]) => record?.date === today)) as UndoRecords;
  const undo: UndoRecords = change ? { ...current, [side]: { date: today, ...change } } : current;
  if (!change && Object.keys(current).length === Object.keys(after.undo ?? {}).length) return after;
  if (Object.keys(undo).length === 0) {
    const { undo: _gone, ...rest } = after;
    return rest;
  }
  return { ...after, undo };
}

/** The names of the items a change touched, itself or through its log entries and notes, for the replies. */
function namesIn(record: UndoRecord, data: AppData): string[] {
  const names = new Map<string, string>();
  const known = byId(itemsOf(data));
  const nameOf = (id: string) => known.get(id)?.name ?? (record.before.items[id] ?? record.after.items[id])?.name;
  for (const id of new Set([...Object.keys(record.before.items), ...Object.keys(record.after.items)])) {
    const name = nameOf(id);
    if (name) names.set(id, name);
  }
  for (const snapshot of [record.before, record.after]) {
    for (const entry of [...Object.values(snapshot.log), ...Object.values(snapshot.notes)]) {
      const name = entry && !names.has(entry.itemId) ? nameOf(entry.itemId) : undefined;
      if (entry && name) names.set(entry.itemId, name);
    }
    // §71/§81: a goal is named by its item, or by its category.
    for (const goal of Object.values(snapshot.goals ?? {})) {
      if (goal?.itemId && !names.has(goal.itemId)) {
        const name = nameOf(goal.itemId);
        if (name) names.set(goal.itemId, name);
      }
      const category = goal?.categoryId ? data.categories.find((c) => c.id === goal.categoryId)?.name : undefined;
      if (category) names.set(`category:${goal!.categoryId}`, category);
    }
  }
  return [...names.values()];
}

function quoted(names: string[]): string {
  const list = names.map((name) => `"${name}"`);
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export type UndoPlan = { status: "rejected"; message: string } | { status: "ok"; apply: (data: AppData) => AppData; message: string };

function current<T extends { id: string }>(list: T[] | undefined, id: string): T | null {
  return (list ?? []).find((entry) => entry.id === id) ?? null;
}

/** Puts `snapshot`'s records in place: replaced, added back, or removed when null. */
function restore<T extends { id: string }>(list: T[], records: Record<string, T | null>): T[] {
  const replaced = list.flatMap((entry) => (entry.id in records ? (records[entry.id] ? [records[entry.id]!] : []) : [entry]));
  const added = Object.values(records).filter((entry): entry is T => !!entry && !list.some((existing) => existing.id === entry.id));
  return [...replaced, ...added];
}

/** The items whose records changed since `record` was made (by id), and whether the week start or a category did. */
function changedSince(data: AppData, record: UndoRecord): { ids: Set<string>; week: boolean; category: boolean; goal: boolean } {
  const ids = new Set<string>();
  const all = itemsOf(data);
  for (const [id, item] of Object.entries(record.after.items)) if (stable(current(all, id)) !== stable(item)) ids.add(id);
  for (const [id, entry] of Object.entries(record.after.log)) if (stable(current(data.completionLog, id)) !== stable(entry)) ids.add((entry ?? record.before.log[id])!.itemId);
  for (const [id, note] of Object.entries(record.after.notes)) if (stable(current(data.notes, id)) !== stable(note)) ids.add((note ?? record.before.notes[id])!.itemId);
  let goal = false;
  for (const [id, after] of Object.entries(record.after.goals ?? {})) {
    if (stable(current(data.goals, id)) === stable(after)) continue;
    const itemId = (after ?? record.before.goals![id])!.itemId;
    if (itemId) ids.add(itemId);
    else goal = true; // §81: a category goal
  }
  const category = Object.entries(record.after.categories).some(([id, value]) => stable(current(data.categories, id)) !== stable(value));
  const week = !!record.after.weekStartsOn && (data.weekStartsOn ?? 0) !== (record.after.weekStartsOn.value ?? 0);
  return { ids, week, category, goal };
}

/** Undoing `side`'s last change, or why not. Undoing clears it: a second undo has nothing to undo. */
export function planUndo(stored: AppData, side: UndoSide, today: string): UndoPlan {
  const data = rolloverPersistentTasks(stored, today);
  const record = data.undo?.[side];
  if (!record) return { status: "rejected", message: "There's nothing to undo." };
  if (record.date !== today) return { status: "rejected", message: "The last change was made on an earlier day, so it can't be undone any more." };

  // Only if nothing changed those records since: never overwrite a newer change.
  const since = changedSince(data, record);
  if (since.ids.size || since.week || since.category || since.goal) {
    const names = [...since.ids].map((id) => current(itemsOf(data), id)?.name ?? (record.after.items[id] ?? record.before.items[id])?.name).filter((name): name is string => !!name);
    const what = names.length ? quoted(names) : since.week ? "the first day of the week" : since.goal ? "that goal" : "a category";
    return { status: "rejected", message: `${what} changed again since then, so I can't undo that without losing the newer change.` };
  }

  const restoredItems = Object.values(record.before.items).filter((item): item is Item => !!item);
  const removed = Object.entries(record.before.items).filter(([, item]) => !item).map(([id]) => record.after.items[id]!.name);
  const deleted = restoredItems.filter((item) => !record.after.items[item.id]).map((item) => item.name);
  const changed = namesIn(record, data).filter((name) => !removed.includes(name) && !deleted.includes(name));
  const parts: string[] = [];
  if (removed.length) parts.push(`removed ${quoted(removed)}`);
  if (deleted.length) parts.push(`brought back ${quoted(deleted)} with ${deleted.length === 1 ? "its" : "their"} history`);
  if (changed.length) parts.push(`put ${quoted(changed)} back as ${changed.length === 1 ? "it was" : "they were"}`);
  if (record.before.weekStartsOn) parts.push(`set the week back to start on ${record.before.weekStartsOn.value === 1 ? "Monday" : "Sunday"}`);
  if (!parts.length && Object.keys(record.before.categories).length) parts.push("put the categories back as they were");
  // §71: a change to a goal only.
  const goalsOnly = Object.keys(record.before.goals ?? {}).length > 0 && !Object.keys(record.before.items).length && !Object.keys(record.before.log).length && !Object.keys(record.before.notes).length;
  const message = goalsOnly ? `Undone: I put the goal on ${quoted(changed)} back as it was.` : `Undone: I ${parts.join(", ")}.`;

  return {
    status: "ok",
    message,
    apply: (read) => {
      const fresh = rolloverPersistentTasks(read, today);
      // A save replayed on a re-read file checks again: a newer change there wins.
      const again = changedSince(fresh, record);
      if (again.ids.size || again.week || again.category || again.goal) return read;
      const items = restore(itemsOf(fresh), record.before.items);
      const { [side]: _done, ...otherSides } = fresh.undo ?? {};
      const next: AppData = {
        ...fresh,
        habits: items.filter((item): item is Habit => item.kind === "habit"),
        recurringTasks: items.filter((item): item is RecurringTask => item.kind === "recurringTask"),
        singleTasks: items.filter((item): item is SingleTask => item.kind === "singleTask"),
        completionLog: restore(fresh.completionLog, record.before.log),
        notes: restore(fresh.notes ?? [], record.before.notes),
        categories: restore(fresh.categories, record.before.categories),
        undo: otherSides,
      };
      if (record.before.goals && Object.keys(record.before.goals).length) {
        const goals = restore(fresh.goals ?? [], record.before.goals);
        if (goals.length) next.goals = goals;
        else delete next.goals;
      }
      if (record.before.weekStartsOn) {
        if (record.before.weekStartsOn.value === undefined) delete next.weekStartsOn;
        else next.weekStartsOn = record.before.weekStartsOn.value;
      }
      return next;
    },
  };
}
