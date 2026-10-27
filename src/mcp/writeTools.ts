// The write tools' decisions: which items a call means, and whether each change is allowed.
// The changes themselves are dataStore's own functions, and the rules are chatEngine.ts's
// (§29 future dates, §41 set-not-toggle), so the app and the connector can't disagree.
// Pure: no Drive, no clock; `todayISO` is always the user's, passed in.
import type { AppData, DayPart, Habit, RecurringTask, SingleTask } from "../types/models.ts";
import { setHabitDone, setHabitValue, setRecurringTaskDone, updateSingleTask } from "../lib/dataStore.ts";
import { currentPause, describeRecurrence, isArchived, isFutureDate, occursOn, upcomingPause } from "../lib/recurrence.ts";
import { currentHabitChecklist } from "../lib/habitChecklist.ts";
import { describeFutureTaskQuestion, describeNotDue, formatDate } from "../lib/confirmations.ts";
import { compareForDay, isImportant } from "../lib/dayParts.ts";
import { selectOne } from "../lib/itemSelection.ts";

export type ItemKind = "habit" | "recurringTask" | "singleTask";
export type AnyItem = Habit | RecurringTask | SingleTask;

export function itemsOf(data: AppData, type?: ItemKind): AnyItem[] {
  return [
    ...(!type || type === "habit" ? data.habits : []),
    ...(!type || type === "recurringTask" ? data.recurringTasks : []),
    ...(!type || type === "singleTask" ? data.singleTasks : []),
  ];
}

export interface Candidate {
  id: string;
  name: string;
  type: ItemKind;
  dayPart: DayPart | null;
  startDate: string;
  done?: boolean; // one-off tasks
}

export function candidate(item: AnyItem): Candidate {
  return {
    id: item.id,
    name: item.name,
    type: item.kind,
    dayPart: item.dayPart ?? null,
    startDate: item.startDate,
    ...(item.kind === "singleTask" ? { done: item.done } : {}),
  };
}

export interface TargetInput {
  ids?: string[];
  name?: string;
  type?: ItemKind;
}

export type Resolved =
  | { status: "ok"; items: AnyItem[] }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "not_found"; message: string }
  // Name matched, but only items this tool can't act on; the caller says why.
  | { status: "ineligible"; items: AnyItem[] };

/**
 * Ids win (they come from get_day or find_items, so they're exact). A name goes through
 * the app's own matcher (itemSelection.ts): an exact name wins, then word forms; several
 * matches are returned for the user to pick, never guessed between.
 */
export function resolveTargets(data: AppData, input: TargetInput, canTakeAction?: (item: AnyItem) => boolean): Resolved {
  const pool = itemsOf(data, input.type);
  if (input.ids && input.ids.length > 0) {
    const ids = [...new Set(input.ids)];
    const found = ids.map((id) => pool.find((item) => item.id === id));
    const missing = ids.filter((_, i) => !found[i]);
    if (missing.length > 0) {
      return { status: "not_found", message: `No item with id ${missing.map((id) => `"${id}"`).join(", ")}. Use find_items or get_day to look ids up.` };
    }
    return { status: "ok", items: found as AnyItem[] };
  }
  if (!input.name?.trim()) return { status: "not_found", message: "Pass `ids` or `name`." };
  const selection = selectOne(pool, { name: input.name }, canTakeAction);
  switch (selection.kind) {
    case "one":
      return { status: "ok", items: [selection.item] };
    case "many":
      return { status: "ambiguous", candidates: selection.items.map(candidate) };
    case "ineligible":
      return { status: "ineligible", items: selection.items };
    case "none":
      return { status: "not_found", message: `Nothing is called "${input.name}". Use find_items to search.` };
  }
}

export type Decision =
  | { status: "ok"; item: AnyItem; changed: boolean; mutate?: (data: AppData) => AppData }
  | { status: "rejected"; item: AnyItem; reason: string }
  | { status: "needs_confirm"; item: AnyItem; question: string };

const entryOn = (data: AppData, itemId: string, dateISO: string) =>
  data.completionLog.find((entry) => entry.itemId === itemId && entry.date === dateISO);

/**
 * §41: sets rather than toggles. A one-off task ignores the date: it has one day, and
 * finishing it early (§29) needs a yes first and moves it to today.
 */
export function decideSetDone(
  data: AppData,
  item: AnyItem,
  dateISO: string,
  todayISO: string,
  done: boolean,
  moveToToday: boolean,
): Decision {
  if (item.kind === "singleTask") {
    if (item.done === done) return { status: "ok", item, changed: false };
    const early = done && isFutureDate(item.startDate, todayISO);
    if (early && !moveToToday) {
      return { status: "needs_confirm", item, question: describeFutureTaskQuestion(item.name, item.startDate, todayISO) };
    }
    const patch = { newDone: done, ...(early ? { newStartDate: todayISO } : {}) };
    return { status: "ok", item, changed: true, mutate: (d) => updateSingleTask(d, item.id, patch, todayISO) };
  }

  // §29: a day that hasn't happened yet can't be done or missed.
  if (isFutureDate(dateISO, todayISO)) {
    return { status: "rejected", item, reason: `I can't change "${item.name}" for ${formatDate(dateISO, todayISO)}: that day hasn't happened yet.` };
  }
  if (!occursOn(item, dateISO)) return { status: "rejected", item, reason: describeNotDue(item, dateISO, todayISO) };

  const before = entryOn(data, item.id, dateISO);
  if (item.kind === "recurringTask") {
    return {
      status: "ok",
      item,
      changed: !!before !== done,
      mutate: (d) => setRecurringTaskDone(d, item.id, dateISO, done),
    };
  }

  if (done && (item.completionType === "value" || item.completionType === "timer") && !(item.target && item.target > 0)) {
    return { status: "rejected", item, reason: `"${item.name}" has no goal set, so "done" has no amount. Use log_progress with the amount instead.` };
  }
  if (done && item.completionType === "checklist" && currentHabitChecklist(item).length === 0) {
    return { status: "rejected", item, reason: `"${item.name}" has no checklist items yet, so there's nothing to mark done.` };
  }
  const after = setHabitDone(data, item.id, dateISO, done);
  return {
    status: "ok",
    item,
    changed: JSON.stringify(entryOn(after, item.id, dateISO)) !== JSON.stringify(before),
    mutate: (d) => setHabitDone(d, item.id, dateISO, done),
  };
}

export const loggable = (item: AnyItem): item is Habit =>
  item.kind === "habit" && (item.completionType === "value" || item.completionType === "timer");

/** A number or timer habit's amount for a day: `value` replaces it, `add` adds to what's logged then (re-read on a conflict replay, §21). */
export function decideLogProgress(
  item: Habit,
  dateISO: string,
  todayISO: string,
  amount: { value?: number; add?: number },
): Decision {
  if (isFutureDate(dateISO, todayISO)) {
    return { status: "rejected", item, reason: `I can't log progress for "${item.name}" on ${formatDate(dateISO, todayISO)}: that day hasn't happened yet.` };
  }
  return {
    status: "ok",
    item,
    changed: true,
    mutate: (d) => {
      const current = entryOn(d, item.id, dateISO)?.value ?? 0;
      return setHabitValue(d, item.id, dateISO, amount.value !== undefined ? amount.value : current + (amount.add ?? 0));
    },
  };
}

export interface ItemSummary extends Candidate {
  important: boolean;
  category?: string;
  description?: string;
  schedule?: string; // habits and recurring tasks
  endDate?: string;
  archived?: boolean;
  paused?: { from: string; resumeOn?: string };
  completionType?: Habit["completionType"];
  target?: number;
  unit?: string;
  checklist?: string[]; // a habit's current steps, or a one-off task's items
}

function summarize(data: AppData, item: AnyItem, todayISO: string): ItemSummary {
  const summary: ItemSummary = {
    ...candidate(item),
    important: isImportant(item),
    category: data.categories.find((category) => category.id === item.categoryId)?.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
  };
  if (item.kind === "singleTask") {
    if (item.checklist) summary.checklist = item.checklist.map((entry) => entry.text);
    return summary;
  }
  summary.schedule = describeRecurrence(item.recurrence);
  if (isArchived(item, todayISO)) summary.archived = true;
  const pause = currentPause(item, todayISO) ?? upcomingPause(item, todayISO);
  if (pause) summary.paused = { from: pause.from, ...(pause.resumeOn ? { resumeOn: pause.resumeOn } : {}) };
  if (item.kind === "habit") {
    summary.completionType = item.completionType;
    if (item.completionType === "value" || item.completionType === "timer") {
      summary.target = item.target;
      summary.unit = item.completionType === "timer" ? "minutes" : item.unit;
    }
    if (item.completionType === "checklist") summary.checklist = currentHabitChecklist(item).map((entry) => entry.text);
  }
  return summary;
}

/**
 * find_items: with a query, the app's name matcher (closest first); without one, every
 * item in the app's one sort order. Archived items and finished one-off tasks only when
 * asked for, or when they're what the query names.
 */
export function findItems(
  data: AppData,
  todayISO: string,
  query: { query?: string; type?: ItemKind; includeInactive?: boolean },
): ItemSummary[] {
  const pool = itemsOf(data, query.type);
  const active = (item: AnyItem) =>
    item.kind === "singleTask" ? !item.done : !isArchived(item, todayISO);
  let items: AnyItem[];
  if (query.query?.trim()) {
    const selection = selectOne(pool, { name: query.query });
    items = selection.kind === "one" ? [selection.item] : selection.kind === "many" ? selection.items : [];
    if (!query.includeInactive && items.some(active)) items = items.filter(active);
  } else {
    items = pool.filter((item) => query.includeInactive || active(item)).sort(compareForDay);
  }
  return items.map((item) => summarize(data, item, todayISO));
}
