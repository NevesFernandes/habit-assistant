// §66: what happened over a date range, day by day, for the app's chat and the Claude
// connector alike. Built on occursOn and the completion log, so "due", "done" and "missed"
// mean what they mean everywhere else. Pure: no Drive, no clock.
import { weekStartOf, type AppData, type CompletionLogEntry, type Habit, type RecurringTask, type SingleTask } from "../types/models.ts";
import { addDays, isPausedOn, occursOn, startOfMonth, startOfWeek } from "./recurrence.ts";
import { checklistProgress, isHabitEntryComplete } from "./habitStats.ts";
import { recurringTaskChecklistOn } from "./recurringChecklist.ts";
import { compareForDay } from "./dayParts.ts";
import { noteOn } from "./dayNotes.ts";
import { skipOn } from "./skip.ts";

/** Longest range one call covers; a longer one is refused so the answer stays readable. */
export const HISTORY_MAX_DAYS = 366;
/** Past this many item-days the day-by-day list is left out and only the totals come back. */
export const HISTORY_MAX_ENTRIES = 400;

/**
 * done / missed: a past or current day that was due. open: today, due, not done yet.
 * upcoming: a later day that is due. paused: would have been due, but paused.
 * skipped: the same, for one day the user skipped (§68).
 * not_due: a day it wasn't due (nor done) but has a note (§67).
 * For "N times a week/month" habits no single day is due, so only done days are listed.
 */
export type HistoryStatus = "done" | "missed" | "open" | "upcoming" | "paused" | "skipped" | "not_due";

export interface HistoryEntry {
  id: string;
  name: string;
  kind: "habit" | "recurringTask" | "singleTask";
  status: HistoryStatus;
  value?: number; // value and timer habits: what was logged
  target?: number;
  unit?: string;
  checklist?: { checked: number; total: number };
  note?: string; // §67
}

export interface HistoryDay {
  date: string;
  items: HistoryEntry[];
}

export interface HistoryPeriod {
  start: string; // first day of the week or month
  done: number;
  target: number;
}

export interface HistoryItemSummary {
  id: string;
  name: string;
  kind: HistoryEntry["kind"];
  due: number; // past and current days that were due (done + missed + open)
  done: number;
  missed: number;
  paused: number;
  skipped: number;
  upcoming: number;
  /** Last day it was done, on or before the range's end, even if that's before the range. */
  lastDone?: string;
  /** "N times a week/month" habits: each period that overlaps the range. */
  periods?: HistoryPeriod[];
}

/** §65: one day's totals across the items, for a calendar or a chart. */
export interface HistoryDayTotal {
  date: string;
  done: number;
  missed: number;
  /** Today, due and not done yet. */
  open: number;
  upcoming: number;
}

export interface History {
  from: string;
  to: string;
  today: string;
  items: HistoryItemSummary[];
  /** §65: every day of the range, kept even when `days` is left out. */
  daily: HistoryDayTotal[];
  /** Days with something on them, oldest first; left out when `daysOmitted`. */
  days?: HistoryDay[];
  daysOmitted?: boolean;
}

export type HistoryItem = Habit | RecurringTask | SingleTask;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function historyRangeDays(from: string, to: string): number {
  return to < from ? 0 : datesBetween(from, to).length;
}

function entryFor(log: CompletionLogEntry[], id: string, date: string): CompletionLogEntry | undefined {
  return log.find((entry) => entry.itemId === id && entry.date === date);
}

function lastDoneOf(data: AppData, item: HistoryItem, to: string): string | undefined {
  if (item.kind === "singleTask") return item.done && item.startDate <= to ? item.startDate : undefined;
  return data.completionLog
    .filter((entry) => entry.itemId === item.id && entry.date <= to)
    .filter((entry) => item.kind !== "habit" || isHabitEntryComplete(item, entry))
    .reduce<string | undefined>((last, entry) => (!last || entry.date > last ? entry.date : last), undefined);
}

function recurringEntry(data: AppData, item: Habit | RecurringTask, date: string, today: string): HistoryEntry | undefined {
  const base = { id: item.id, name: item.name, kind: item.kind } as const;
  const due = occursOn(item, date);
  if (!due) {
    // A paused day shows only if the rule would have made it due.
    const wouldBeDue = isPausedOn(item, date) && occursOn({ ...item, pauses: [] }, date);
    if (!wouldBeDue || item.recurrence.type === "timesPerPeriod") return undefined;
    return { ...base, status: skipOn(item, date) ? "skipped" : "paused" };
  }
  const entry = entryFor(data.completionLog, item.id, date);
  const done = item.kind === "habit" ? isHabitEntryComplete(item, entry) : entry !== undefined;
  // "N times a week/month": every day is eligible but none is due, so only done days count.
  if (item.recurrence.type === "timesPerPeriod" && !done) return undefined;
  const status: HistoryStatus = done ? "done" : date > today ? "upcoming" : date === today ? "open" : "missed";
  const view: HistoryEntry = { ...base, status };
  if (item.kind === "habit") {
    if (item.completionType === "value" || item.completionType === "timer") {
      view.value = entry?.value ?? 0;
      view.target = item.target;
      view.unit = item.completionType === "timer" ? "minutes" : item.unit;
    }
    if (item.completionType === "checklist" && date <= today) view.checklist = checklistProgress(item, entry, date);
  } else {
    const list = date <= today ? recurringTaskChecklistOn(item, date) : undefined;
    if (list) view.checklist = { checked: list.filter((i) => i.checked).length, total: list.length };
  }
  return view;
}

// A one-off task sits on its startDate: an unfinished one that carries over has already been
// moved to today, so its day is today. Its done day isn't stored; the startDate stands in.
function singleTaskEntry(task: SingleTask, date: string, today: string): HistoryEntry | undefined {
  if (task.startDate !== date) return undefined;
  const status: HistoryStatus = task.done ? "done" : date > today ? "upcoming" : date === today ? "open" : "missed";
  const view: HistoryEntry = { id: task.id, name: task.name, kind: "singleTask", status };
  if (task.checklist) view.checklist = { checked: task.checklist.filter((i) => i.checked).length, total: task.checklist.length };
  return view;
}

function periodsOf(data: AppData, habit: Habit, from: string, to: string): HistoryPeriod[] | undefined {
  if (habit.recurrence.type !== "timesPerPeriod") return undefined;
  const { period, count } = habit.recurrence;
  const startOf = (date: string) => (period === "week" ? startOfWeek(date, weekStartOf(data)) : startOfMonth(date));
  const next = (start: string) => (period === "week" ? addDays(start, 7) : startOfMonth(addDays(start, 31)));
  const periods: HistoryPeriod[] = [];
  for (let start = startOf(from); start <= to; start = next(start)) {
    // Counted up to the range's end, and only where the habit was running inside the range.
    const end = [addDays(next(start), -1), to, habit.endDate ?? to].sort()[0];
    if (end < habit.startDate || end < from) continue;
    const done = data.completionLog.filter(
      (entry) => entry.itemId === habit.id && entry.date >= start && entry.date <= end && isHabitEntryComplete(habit, entry),
    ).length;
    periods.push({ start, done, target: count });
  }
  return periods;
}

/**
 * The history of `items` (default: every item) from `from` to `to`, both included. Items
 * with nothing in the range are left out, unless `keepEmpty` (one item asked about by name:
 * "when did I last…" still needs its last done day). `allDays` keeps the day-by-day list
 * past HISTORY_MAX_ENTRIES. The caller checks the range (from ≤
 * to, at most HISTORY_MAX_DAYS days).
 */
export function getHistory(
  data: AppData,
  from: string,
  to: string,
  today: string,
  items?: HistoryItem[],
  options: { keepEmpty?: boolean; allDays?: boolean } = {},
): History {
  const all: HistoryItem[] = items ?? [...data.habits, ...data.recurringTasks, ...data.singleTasks];
  const sorted = [...all].sort(compareForDay);
  const days: HistoryDay[] = [];
  const counts = new Map<string, HistoryItemSummary>();
  const daily: HistoryDayTotal[] = [];
  for (const date of datesBetween(from, to)) {
    const entries: HistoryEntry[] = [];
    const total: HistoryDayTotal = { date, done: 0, missed: 0, open: 0, upcoming: 0 };
    daily.push(total);
    for (const item of sorted) {
      const note = noteOn(data, item.id, date);
      const found = item.kind === "singleTask" ? singleTaskEntry(item, date, today) : recurringEntry(data, item, date, today);
      const entry: HistoryEntry | undefined = found
        ? { ...found, ...(note ? { note } : {}) }
        : note
          ? { id: item.id, name: item.name, kind: item.kind, status: "not_due", note }
          : undefined;
      if (!entry) continue;
      entries.push(entry);
      const summary = counts.get(item.id) ?? { id: item.id, name: item.name, kind: item.kind, due: 0, done: 0, missed: 0, paused: 0, skipped: 0, upcoming: 0 };
      if (entry.status === "done" || entry.status === "missed" || entry.status === "open" || entry.status === "upcoming") total[entry.status] += 1;
      if (entry.status === "done") summary.done += 1;
      if (entry.status === "missed") summary.missed += 1;
      if (entry.status === "paused") summary.paused += 1;
      if (entry.status === "skipped") summary.skipped += 1;
      if (entry.status === "upcoming") summary.upcoming += 1;
      if (entry.status === "done" || entry.status === "missed" || entry.status === "open") summary.due += 1;
      counts.set(item.id, summary);
    }
    if (entries.length) days.push({ date, items: entries });
  }
  const summaries = sorted.flatMap((item): HistoryItemSummary[] => {
    const periods = item.kind === "habit" ? periodsOf(data, item, from, to) : undefined;
    const counted = counts.get(item.id);
    if (!counted && !periods?.length && !options.keepEmpty) return [];
    const summary = counted ?? { id: item.id, name: item.name, kind: item.kind, due: 0, done: 0, missed: 0, paused: 0, skipped: 0, upcoming: 0 };
    const lastDone = lastDoneOf(data, item, to);
    return [{ ...summary, ...(lastDone ? { lastDone } : {}), ...(periods ? { periods } : {}) }];
  });
  const size = days.reduce((total, day) => total + day.items.length, 0);
  // §72: an export needs every day, however many.
  return size > HISTORY_MAX_ENTRIES && !options.allDays
    ? { from, to, today, items: summaries, daily, daysOmitted: true }
    : { from, to, today, items: summaries, daily, days };
}
