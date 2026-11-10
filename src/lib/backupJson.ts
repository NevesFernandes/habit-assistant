// §82: a JSON backup of the parts of the data the user picks (categories, planned items,
// history, goals, week start), and importing one back by Merge or Replace. One file format
// for the Settings section, the app's chat (a Download button) and the Claude connector.
// Unlike §72's CSV (a period's history to read in a spreadsheet), this is full fidelity and
// re-importable. Pure: no Drive, no DOM. `applyBackup` is a plain AppData → AppData reducer,
// so it goes through the usual persist (conflict replay, and §70's undo diff from chat).
//
// Never in a file, never imported: API keys, the shared-trial counter, read-aloud choices,
// the time zone and undo records. They belong to an account or a device, not to the data.
import type {
  AppData,
  Category,
  ChecklistItem,
  CompletionLogEntry,
  DayNote,
  Goal,
  Habit,
  RecurringTask,
  SingleTask,
  WeekStart,
} from "../types/models.ts";
import { isArchived } from "./recurrence.ts";
import { deleteHabits, deleteRecurringTasks, deleteSingleTasks } from "./dataStore.ts";
import { activeCategoryGoalOf, activeGoalOf } from "./goals.ts";

export const BACKUP_FORMAT = "habit-assistant-export";
export const BACKUP_VERSION = 1;

import { BACKUP_SECTIONS, type BackupSection } from "./backupSections.ts";
export { BACKUP_SECTIONS, type BackupSection };

export const SECTION_LABELS: Record<BackupSection, string> = {
  habits: "Habits",
  recurringTasks: "Recurring tasks",
  singleTasksOpen: "One-off tasks still to do",
  habitHistory: "Habit history",
  recurringTaskHistory: "Recurring task history",
  singleTasksDone: "One-off tasks done",
  categories: "Your own categories",
  goals: "Goals",
  weekStart: "First day of the week",
};

/** The groups the Settings section shows the sections in. */
export const SECTION_GROUPS: { label: string; sections: BackupSection[] }[] = [
  { label: "Planned", sections: ["habits", "recurringTasks", "singleTasksOpen"] },
  { label: "History", sections: ["habitHistory", "recurringTaskHistory", "singleTasksDone"] },
  { label: "Other", sections: ["categories", "goals", "weekStart"] },
];

export interface BackupPayloads {
  habits?: { items: Habit[] };
  recurringTasks?: { items: RecurringTask[] };
  singleTasksOpen?: { items: SingleTask[]; notes: DayNote[] };
  habitHistory?: { log: CompletionLogEntry[]; notes: DayNote[] };
  recurringTaskHistory?: { log: CompletionLogEntry[]; notes: DayNote[] };
  singleTasksDone?: { items: SingleTask[]; notes: DayNote[] };
  categories?: { categories: Category[] };
  goals?: { goals: Goal[] };
  weekStart?: { weekStartsOn: WeekStart };
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Archived habits and recurring tasks were left out (the "include archived" box was off). */
  archivedLeftOut?: boolean;
  /** Your own categories the exported items and goals use, carried even when "categories" wasn't picked. */
  categoriesUsed: Category[];
  sections: BackupPayloads;
}

export interface BackupOptions {
  /** Habits and recurring tasks whose end date has passed, and their history. Default true. */
  includeArchived?: boolean;
}

export type ImportMode = "merge" | "replace";

// ---------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------

function keepItem(item: { endDate?: string }, today: string, opts: BackupOptions): boolean {
  return opts.includeArchived !== false || !isArchived(item, today);
}

/**
 * An item without the parts that are history rather than plan: stats-reset dates, ticked or
 * removed checklist items, a "same list" routine's ticks. A "planned only" backup is a fresh
 * start, so a ticked "milk" on a carry-over shopping list doesn't come back either.
 */
export function withoutHistoryFields<T extends Habit | RecurringTask>(item: T): T {
  const copy: T = { ...item };
  delete copy.statsFrom;
  delete copy.bestStreakFrom;
  delete copy.statsUndo;
  if (copy.checklist) {
    copy.checklist = copy.checklist
      .filter((entry) => !entry.removedOn && !entry.doneOn)
      .map((entry) => {
        const fresh: ChecklistItem = { ...entry, checked: false };
        delete fresh.doneOn;
        return fresh;
      });
  }
  if (copy.kind === "recurringTask") delete (copy as RecurringTask).checklistDoneByDate;
  return copy;
}

/** How many things each section would hold right now, for the tick-boxes. */
export function sectionCounts(data: AppData, today: string, opts: BackupOptions = {}): Record<BackupSection, number> {
  const habitIds = new Set(data.habits.filter((h) => keepItem(h, today, opts)).map((h) => h.id));
  const taskIds = new Set(data.recurringTasks.filter((t) => keepItem(t, today, opts)).map((t) => t.id));
  return {
    habits: habitIds.size,
    recurringTasks: taskIds.size,
    singleTasksOpen: data.singleTasks.filter((t) => !t.done).length,
    habitHistory: data.completionLog.filter((e) => habitIds.has(e.itemId)).length,
    recurringTaskHistory: data.completionLog.filter((e) => taskIds.has(e.itemId)).length,
    singleTasksDone: data.singleTasks.filter((t) => t.done).length,
    categories: data.categories.filter((c) => !c.isDefault).length,
    goals: (data.goals ?? []).length,
    weekStart: 1,
  };
}

export function backupFilename(today: string): string {
  return `habit-assistant-${today}.json`;
}

export function buildBackup(
  data: AppData,
  sections: readonly BackupSection[],
  today: string,
  opts: BackupOptions = {},
  now: Date = new Date(),
): BackupFile {
  const picked = new Set(sections);
  const notes = data.notes ?? [];
  const notesOf = (ids: Set<string>) => notes.filter((n) => ids.has(n.itemId));
  const habits = data.habits.filter((h) => keepItem(h, today, opts));
  const tasks = data.recurringTasks.filter((t) => keepItem(t, today, opts));
  const out: BackupPayloads = {};

  if (picked.has("habits")) {
    out.habits = { items: picked.has("habitHistory") ? habits : habits.map(withoutHistoryFields) };
  }
  if (picked.has("recurringTasks")) {
    out.recurringTasks = { items: picked.has("recurringTaskHistory") ? tasks : tasks.map(withoutHistoryFields) };
  }
  for (const [section, done] of [["singleTasksOpen", false], ["singleTasksDone", true]] as const) {
    if (!picked.has(section)) continue;
    const items = data.singleTasks.filter((t) => t.done === done);
    out[section] = { items, notes: notesOf(new Set(items.map((t) => t.id))) };
  }
  if (picked.has("habitHistory")) {
    const ids = new Set(habits.map((h) => h.id));
    out.habitHistory = { log: data.completionLog.filter((e) => ids.has(e.itemId)), notes: notesOf(ids) };
  }
  if (picked.has("recurringTaskHistory")) {
    const ids = new Set(tasks.map((t) => t.id));
    out.recurringTaskHistory = { log: data.completionLog.filter((e) => ids.has(e.itemId)), notes: notesOf(ids) };
  }
  if (picked.has("categories")) out.categories = { categories: data.categories.filter((c) => !c.isDefault) };
  if (picked.has("goals")) {
    // A goal on an archived item that was left out goes with it.
    const kept = new Set([...habits, ...tasks].map((i) => i.id));
    out.goals = { goals: (data.goals ?? []).filter((g) => !g.itemId || kept.has(g.itemId)) };
  }
  if (picked.has("weekStart")) out.weekStart = { weekStartsOn: data.weekStartsOn ?? 0 };

  const used = new Set<string>();
  for (const list of [out.habits?.items, out.recurringTasks?.items, out.singleTasksOpen?.items, out.singleTasksDone?.items]) {
    for (const item of list ?? []) if (item.categoryId) used.add(item.categoryId);
  }
  for (const goal of out.goals?.goals ?? []) if (goal.categoryId) used.add(goal.categoryId);
  const categoriesUsed = out.categories ? [] : data.categories.filter((c) => !c.isDefault && used.has(c.id));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    ...(opts.includeArchived === false ? { archivedLeftOut: true } : {}),
    categoriesUsed,
    sections: out,
  };
}

export function backupText(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/** What's in a backup, per section, e.g. for the import tick-boxes and the connector's preview. */
export function fileCounts(file: BackupFile): Partial<Record<BackupSection, number>> {
  const s = file.sections;
  const counts: Partial<Record<BackupSection, number>> = {};
  if (s.habits) counts.habits = s.habits.items.length;
  if (s.recurringTasks) counts.recurringTasks = s.recurringTasks.items.length;
  if (s.singleTasksOpen) counts.singleTasksOpen = s.singleTasksOpen.items.length;
  if (s.habitHistory) counts.habitHistory = s.habitHistory.log.length;
  if (s.recurringTaskHistory) counts.recurringTaskHistory = s.recurringTaskHistory.log.length;
  if (s.singleTasksDone) counts.singleTasksDone = s.singleTasksDone.items.length;
  if (s.categories) counts.categories = s.categories.categories.length;
  if (s.goals) counts.goals = s.goals.goals.length;
  if (s.weekStart) counts.weekStart = 1;
  return counts;
}

/** The sections a file holds, in display order. */
export function sectionsInFile(file: BackupFile): BackupSection[] {
  return BACKUP_SECTIONS.filter((s) => file.sections[s] !== undefined);
}

/** "habits (3), habit history (120), …" — what a backup holds, for a reply. */
export function describeBackupContents(file: BackupFile): string {
  const counts = fileCounts(file);
  const parts = sectionsInFile(file).map((s) =>
    s === "weekStart" ? "the first day of the week" : `${SECTION_LABELS[s].toLowerCase()} (${counts[s]})`,
  );
  if (file.categoriesUsed.length) parts.push(`the ${file.categoriesUsed.length === 1 ? "category" : `${file.categoriesUsed.length} categories`} of your own these use`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function checkList(value: unknown, where: string, check: (x: Record<string, unknown>) => boolean): string | undefined {
  if (!Array.isArray(value)) return `${where} isn't a list.`;
  const bad = value.findIndex((x) => !isObj(x) || !check(x));
  return bad === -1 ? undefined : `${where} has an entry that isn't valid (number ${bad + 1}).`;
}

const validCategory = (c: Record<string, unknown>) => isStr(c.id) && isStr(c.name) && typeof c.icon === "string";
const validItem = (kind: string) => (i: Record<string, unknown>) =>
  isStr(i.id) && isStr(i.name) && isDate(i.startDate) && i.kind === kind &&
  (kind !== "habit" || (isObj(i.recurrence) && typeof i.completionType === "string")) &&
  (kind !== "recurringTask" || isObj(i.recurrence)) &&
  (kind !== "singleTask" || typeof i.done === "boolean");
const validEntry = (e: Record<string, unknown>) => isStr(e.id) && isStr(e.itemId) && isDate(e.date);
const validNote = (n: Record<string, unknown>) => isStr(n.id) && isStr(n.itemId) && isDate(n.date) && typeof n.text === "string";
const validGoal = (g: Record<string, unknown>) =>
  isStr(g.id) && (isStr(g.itemId) || isStr(g.categoryId)) && typeof g.target === "number" && isDate(g.from) && isDate(g.to);

/** Reads a backup file's text: either the file, or a plain error (and nothing gets imported). */
export function parseBackup(text: string): { file: BackupFile } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "That file isn't a Habit Assistant backup (it isn't valid JSON)." };
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return { error: "That file isn't a Habit Assistant backup." };
  if (typeof raw.version !== "number" || raw.version < 1) return { error: "That backup has no version, so it can't be read." };
  if (raw.version > BACKUP_VERSION) {
    return { error: "That backup was made by a newer version of Habit Assistant. Reload the app to update it, then try again." };
  }
  if (!isObj(raw.sections)) return { error: "That backup has no sections." };
  const s = raw.sections;
  const sub = (key: string, field: string) => (isObj(s[key]) ? (s[key] as Record<string, unknown>)[field] : undefined);
  const problems: (string | undefined)[] = [checkList(raw.categoriesUsed ?? [], "Categories used", validCategory)];
  if (s.habits !== undefined) problems.push(checkList(sub("habits", "items"), "Habits", validItem("habit")));
  if (s.recurringTasks !== undefined) problems.push(checkList(sub("recurringTasks", "items"), "Recurring tasks", validItem("recurringTask")));
  for (const key of ["singleTasksOpen", "singleTasksDone"]) {
    if (s[key] === undefined) continue;
    problems.push(checkList(sub(key, "items"), "One-off tasks", validItem("singleTask")));
    problems.push(checkList(sub(key, "notes") ?? [], "Notes", validNote));
  }
  for (const key of ["habitHistory", "recurringTaskHistory"]) {
    if (s[key] === undefined) continue;
    problems.push(checkList(sub(key, "log"), "History", validEntry));
    problems.push(checkList(sub(key, "notes") ?? [], "Notes", validNote));
  }
  if (s.categories !== undefined) problems.push(checkList(sub("categories", "categories"), "Categories", validCategory));
  if (s.goals !== undefined) problems.push(checkList(sub("goals", "goals"), "Goals", validGoal));
  if (s.weekStart !== undefined && sub("weekStart", "weekStartsOn") !== 0 && sub("weekStart", "weekStartsOn") !== 1) {
    problems.push("The first day of the week isn't valid.");
  }
  const problem = problems.find(Boolean);
  if (problem) return { error: `That backup is damaged: ${problem} Nothing was imported.` };

  const sections: BackupPayloads = {};
  for (const key of BACKUP_SECTIONS) {
    if (s[key] === undefined) continue;
    const payload = { ...(s[key] as Record<string, unknown>) };
    if (key.startsWith("singleTasks") || key.endsWith("History")) payload.notes = payload.notes ?? [];
    (sections as Record<string, unknown>)[key] = payload;
  }
  return {
    file: {
      format: BACKUP_FORMAT,
      version: raw.version,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      ...(raw.archivedLeftOut === true ? { archivedLeftOut: true } : {}),
      categoriesUsed: (raw.categoriesUsed as Category[] | undefined) ?? [],
      sections,
    },
  };
}

// ---------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------

export interface ImportSummary {
  added: Partial<Record<BackupSection, number>>;
  updated: Partial<Record<BackupSection, number>>;
  /** Under Replace: what was there and isn't any more. */
  removed: Partial<Record<BackupSection, number>>;
  /** Left out, with the reason ("their habits aren't in your data"). */
  skipped: { section: BackupSection; count: number; reason: string }[];
  /** Categories of the user's own brought in because imported items or goals use them. */
  categoriesAdded: number;
  notes: number;
  weekStartChanged: boolean;
}

export function changedAnything(summary: ImportSummary): boolean {
  const any = (m: Partial<Record<BackupSection, number>>) => Object.values(m).some(Boolean);
  return any(summary.added) || any(summary.updated) || any(summary.removed) || summary.categoriesAdded > 0 || summary.notes > 0 || summary.weekStartChanged;
}

function bump(map: Partial<Record<BackupSection, number>>, section: BackupSection, by = 1) {
  if (by) map[section] = (map[section] ?? 0) + by;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const ITEM_HISTORY_FIELDS = ["statsFrom", "bestStreakFrom", "statsUndo", "checklistDoneByDate"] as const;

/**
 * Applies a backup's picked sections to `data`. Merge: add what's new, and the file's version
 * wins for what's already there (matched by id; history and notes by item and day), leaving
 * the rest alone. Replace: each picked section is cleared first, and items it removes take
 * their history, notes and goals with them. Run it on the current data to preview, then again
 * inside persist() to save.
 */
export function applyBackup(
  data: AppData,
  file: BackupFile,
  sections: readonly BackupSection[],
  mode: ImportMode,
  today: string,
): { data: AppData; summary: ImportSummary } {
  const picked = new Set(sections.filter((s) => file.sections[s] !== undefined));
  const summary: ImportSummary = { added: {}, updated: {}, removed: {}, skipped: [], categoriesAdded: 0, notes: 0, weekStartChanged: false };
  const s = file.sections;
  let next: AppData = { ...data };

  // --- Categories: the file's ids map onto this account's (same id, else same name). ---
  const categoryMap = new Map<string, string>(next.categories.map((c) => [c.id, c.id]));
  const addCategory = (c: Category, section?: BackupSection) => {
    const existing =
      next.categories.find((x) => x.id === c.id) ??
      next.categories.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (existing) {
      categoryMap.set(c.id, existing.id);
      if (section && existing.id === c.id && !existing.isDefault && (existing.name !== c.name || existing.icon !== c.icon)) {
        next.categories = next.categories.map((x) => (x.id === c.id ? { ...x, name: c.name, icon: c.icon } : x));
        bump(summary.updated, section);
      }
      return;
    }
    next.categories = [...next.categories, { id: c.id, name: c.name, icon: c.icon, isDefault: false }];
    categoryMap.set(c.id, c.id);
    if (section) bump(summary.added, section);
    else summary.categoriesAdded++;
  };
  if (picked.has("categories")) for (const c of s.categories!.categories) addCategory(c, "categories");
  // Categories the file's items use come along only when an item (or goal) that uses them
  // does, also from an unpicked categories section.
  const usedCategories = new Map([...file.categoriesUsed, ...(s.categories?.categories ?? [])].map((c) => [c.id, c]));
  const categoryFor = (id: string | undefined, required: boolean): string | undefined => {
    if (id && !categoryMap.has(id) && usedCategories.has(id)) addCategory(usedCategories.get(id)!);
    return (id && categoryMap.get(id)) || (required ? "other" : undefined);
  };
  const withCategory = <T extends { categoryId?: string }>(item: T, required: boolean): T => {
    const copy = { ...item, categoryId: categoryFor(item.categoryId, required) };
    if (!copy.categoryId) delete copy.categoryId;
    return copy;
  };

  // --- Items: planned ones, and done one-off tasks (which are items too). ---
  const removedIds = new Set<string>();
  const applyItems = <T extends Habit | RecurringTask | SingleTask>(
    section: BackupSection,
    incoming: T[],
    current: T[],
    inScope: (item: T) => boolean,
    prepare: (item: T, existing: T | undefined) => T,
  ): T[] => {
    let list = current;
    if (mode === "replace") {
      const fileIds = new Set(incoming.map((i) => i.id));
      const dropped = list.filter((i) => inScope(i) && !fileIds.has(i.id));
      for (const i of dropped) removedIds.add(i.id);
      bump(summary.removed, section, dropped.length);
      list = list.filter((i) => !dropped.includes(i));
    }
    const byId = new Map(list.map((i) => [i.id, i]));
    for (const raw of incoming) {
      const existing = byId.get(raw.id);
      const item = prepare(raw, existing);
      if (existing && same(existing, item)) continue;
      bump(existing ? summary.updated : summary.added, section);
      byId.set(item.id, item);
    }
    return [...byId.values()];
  };
  // The plan only (its history section not picked): a fresh item, or for one this account
  // already has, the file's plan with this account's own history fields kept.
  const prepareRepeating = <T extends Habit | RecurringTask>(historySection: BackupSection, categoryRequired: boolean) =>
    (raw: T, existing: T | undefined): T => {
      let item = withCategory(raw, categoryRequired);
      if (picked.has(historySection)) return item;
      item = withoutHistoryFields(item);
      if (!existing) return item;
      for (const key of ITEM_HISTORY_FIELDS) {
        const value = (existing as unknown as Record<string, unknown>)[key];
        if (value !== undefined) (item as unknown as Record<string, unknown>)[key] = value;
      }
      if (existing.checklist && item.checklist) {
        const fileIds = new Set(item.checklist.map((x) => x.id));
        const mine = new Map(existing.checklist.map((x) => [x.id, x]));
        item.checklist = [
          ...item.checklist.map((x) => ({ ...x, ...(mine.get(x.id)?.addedOn ? { addedOn: mine.get(x.id)!.addedOn } : {}) })),
          // Ticked and removed entries are history: keep the ones the file no longer lists.
          ...existing.checklist.filter((x) => (x.removedOn || x.doneOn) && !fileIds.has(x.id)),
        ];
      }
      return item;
    };

  if (picked.has("habits")) {
    next.habits = applyItems("habits", s.habits!.items, next.habits, () => true, prepareRepeating<Habit>("habitHistory", true));
  }
  if (picked.has("recurringTasks")) {
    next.recurringTasks = applyItems(
      "recurringTasks", s.recurringTasks!.items, next.recurringTasks, () => true,
      prepareRepeating<RecurringTask>("recurringTaskHistory", false),
    );
  }
  for (const [section, done] of [["singleTasksOpen", false], ["singleTasksDone", true]] as const) {
    if (!picked.has(section)) continue;
    next.singleTasks = applyItems(section, s[section]!.items, next.singleTasks, (t) => t.done === done, (t) => withCategory(t, false));
  }
  // Replace's cascade: an item it removed takes its history, notes and goals along.
  if (removedIds.size) {
    const ids = [...removedIds];
    next = deleteSingleTasks(deleteRecurringTasks(deleteHabits(next, ids), ids), ids);
  }

  // --- History and notes: only for items this account has (after the step above). ---
  const habitIds = new Set(next.habits.map((h) => h.id));
  const taskIds = new Set(next.recurringTasks.map((t) => t.id));
  const dayKey = (e: { itemId: string; date: string }) => `${e.itemId}|${e.date}`;
  const applyLog = (section: BackupSection, incoming: CompletionLogEntry[], owners: Set<string>, ownerWord: string) => {
    const known = incoming.filter((e) => owners.has(e.itemId));
    if (incoming.length > known.length) {
      summary.skipped.push({ section, count: incoming.length - known.length, reason: `their ${ownerWord} aren't in your data` });
    }
    let log = next.completionLog;
    if (mode === "replace") {
      const fileKeys = new Set(known.map(dayKey));
      bump(summary.removed, section, log.filter((e) => owners.has(e.itemId) && !fileKeys.has(dayKey(e))).length);
      log = log.filter((e) => !owners.has(e.itemId));
    }
    const byKey = new Map(log.map((e) => [dayKey(e), e]));
    const before = new Map(next.completionLog.map((e) => [dayKey(e), e]));
    for (const e of known) {
      const mine = before.get(dayKey(e));
      const entry = { ...e, id: mine?.id ?? e.id };
      byKey.set(dayKey(e), entry);
      if (mine && same(mine, entry)) continue;
      bump(mine ? summary.updated : summary.added, section);
    }
    next.completionLog = [...byKey.values()];
  };
  const applyNotes = (incoming: DayNote[], owners: Set<string>) => {
    let notes = next.notes ?? [];
    const before = new Map(notes.map((n) => [dayKey(n), n]));
    if (mode === "replace") notes = notes.filter((n) => !owners.has(n.itemId));
    const byKey = new Map(notes.map((n) => [dayKey(n), n]));
    for (const n of incoming) {
      if (!owners.has(n.itemId)) continue;
      const mine = before.get(dayKey(n));
      byKey.set(dayKey(n), { ...n, id: mine?.id ?? n.id });
      if (mine?.text !== n.text) summary.notes++;
    }
    next.notes = [...byKey.values()];
  };
  if (picked.has("habitHistory")) {
    applyLog("habitHistory", s.habitHistory!.log, habitIds, "habits");
    applyNotes(s.habitHistory!.notes, habitIds);
  }
  if (picked.has("recurringTaskHistory")) {
    applyLog("recurringTaskHistory", s.recurringTaskHistory!.log, taskIds, "recurring tasks");
    applyNotes(s.recurringTaskHistory!.notes, taskIds);
  }
  for (const section of ["singleTasksOpen", "singleTasksDone"] as const) {
    if (!picked.has(section)) continue;
    const present = new Set(next.singleTasks.map((t) => t.id));
    applyNotes(s[section]!.notes, new Set(s[section]!.items.map((t) => t.id).filter((id) => present.has(id))));
  }

  // --- Goals: need their item or category; one running goal per item or category (§71). ---
  if (picked.has("goals")) {
    let goals = next.goals ?? [];
    if (mode === "replace") {
      const fileIds = new Set(s.goals!.goals.map((g) => g.id));
      bump(summary.removed, "goals", goals.filter((g) => !fileIds.has(g.id)).length);
      goals = [];
    }
    const mineBefore = new Map((next.goals ?? []).map((g) => [g.id, g]));
    let orphans = 0;
    let clashes = 0;
    for (const raw of s.goals!.goals) {
      const goal: Goal = raw.categoryId ? withCategory(raw, false) : { ...raw };
      const owned = goal.itemId
        ? habitIds.has(goal.itemId) || taskIds.has(goal.itemId)
        : !!goal.categoryId && next.categories.some((c) => c.id === goal.categoryId);
      if (!owned) {
        orphans++;
        continue;
      }
      const existing = goals.find((g) => g.id === goal.id);
      if (!existing && goal.to >= today) {
        const view = { ...next, goals };
        const running = goal.itemId ? activeGoalOf(view, goal.itemId, today) : activeCategoryGoalOf(view, goal.categoryId!, today);
        if (running) {
          clashes++;
          continue;
        }
      }
      goals = existing ? goals.map((g) => (g.id === goal.id ? goal : g)) : [...goals, goal];
      const mine = mineBefore.get(goal.id);
      if (mine && same(mine, goal)) continue;
      bump(mine ? summary.updated : summary.added, "goals");
    }
    if (orphans) summary.skipped.push({ section: "goals", count: orphans, reason: "their item or category isn't in your data" });
    if (clashes) summary.skipped.push({ section: "goals", count: clashes, reason: "that item or category already has a running goal" });
    next.goals = goals;
  }

  if (picked.has("weekStart")) {
    const value = s.weekStart!.weekStartsOn;
    if ((next.weekStartsOn ?? 0) !== value) {
      next.weekStartsOn = value;
      summary.weekStartChanged = true;
    }
  }

  return { data: next, summary };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An import's result (or its preview) in plain words, one line per kind of change. */
export function describeImport(summary: ImportSummary, preview: boolean): string {
  const verb = preview
    ? { add: "Adds", update: "Updates", remove: "Removes", note: "Brings in", week: "Changes", skip: "Skips" }
    : { add: "Added", update: "Updated", remove: "Removed", note: "Brought in", week: "Changed", skip: "Skipped" };
  const list = (map: Partial<Record<BackupSection, number>>) =>
    BACKUP_SECTIONS.filter((s) => map[s]).map((s) => `${SECTION_LABELS[s].toLowerCase()} ${map[s]}`).join(", ");
  const lines: string[] = [];
  if (list(summary.added)) lines.push(`${verb.add}: ${list(summary.added)}.`);
  if (list(summary.updated)) lines.push(`${verb.update}: ${list(summary.updated)}.`);
  if (list(summary.removed)) lines.push(`${verb.remove}: ${list(summary.removed)}.`);
  if (summary.notes) lines.push(`${verb.note} ${plural(summary.notes, "day note")}.`);
  if (summary.categoriesAdded) lines.push(`${verb.add} ${plural(summary.categoriesAdded, "category", "categories")} the imported items use.`);
  if (summary.weekStartChanged) lines.push(`${verb.week} the first day of the week.`);
  for (const skip of summary.skipped) {
    lines.push(`${verb.skip} ${skip.count} from ${SECTION_LABELS[skip.section].toLowerCase()}: ${skip.reason}.`);
  }
  if (!lines.length) return preview ? "Nothing to change: your data already matches this backup." : "Nothing changed: your data already matched this backup.";
  return lines.join("\n");
}
