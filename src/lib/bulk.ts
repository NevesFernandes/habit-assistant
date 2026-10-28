// §75: one action on several items at once ("mark all my morning habits done", "pause
// everything in Sports for a week", "mark floss and water done"), for the app's chat and the
// Claude connector alike. Done / not done, skip, pause and resume; and (§78) one edit:
// part of the day, important, category or how often it repeats.
// Items the action doesn't fit are left out and named, never asked about; only "everything"
// with nothing to narrow it asks first. Pure: no Drive, no clock.
import type { AppData, Category, DayPart, Habit, PausePeriod, RecurrenceRule, RecurringTask, SingleTask } from "../types/models.ts";
import { describeRecurrence, isArchived, isPaused, isPausedOn, occursOn, upcomingPause } from "./recurrence.ts";
import { isHabitEntryComplete } from "./habitStats.ts";
import { pauseItem, resumeItem, setHabitDone, setRecurringTaskDone, updateHabit, updateRecurringTask, updateSingleTask, type UpdatePatch } from "./dataStore.ts";
import { skipDay, skipOn } from "./skip.ts";
import { compareForDay, dayPartLabel, isImportant } from "./dayParts.ts";
import { selectOne } from "./itemSelection.ts";
import { formatDate } from "./confirmations.ts";

export type BulkAction = "done" | "undone" | "skip" | "pause" | "resume";
type Item = Habit | RecurringTask | SingleTask;
type Recurring = Habit | RecurringTask;

export interface BulkFilter {
  /** Items named by the user ("floss and water"); each must match one item. */
  names?: string[];
  dayPart?: DayPart;
  categoryId?: string;
  kind?: Item["kind"];
}

export interface BulkRequest {
  action: BulkAction;
  filter: BulkFilter;
  /** done, undone, skip: the day (default today). */
  date?: string;
  /** pause: first paused day (default today) and first day back (absent = open-ended). */
  from?: string;
  resumeOn?: string;
}

export type BulkPlan =
  | { status: "rejected"; message: string }
  /** A name matching several items: say which. */
  | { status: "ambiguous"; name: string; candidates: Item[] }
  /** Nothing narrows it: every item; ask before acting. */
  | { status: "needs_confirm"; question: string; targets: Item[] }
  | { status: "ok"; targets: Item[]; leftOut: { name: string; reason: string }[]; apply: (data: AppData) => AppData; message: string };

const isEverything = (filter: BulkFilter) => !filter.names?.length && !filter.dayPart && !filter.categoryId && !filter.kind;

function pool(data: AppData, filter: BulkFilter): Item[] {
  const all: Item[] = [...data.habits, ...data.recurringTasks, ...data.singleTasks];
  return all.filter((item) => !filter.kind || item.kind === filter.kind);
}

function isDone(data: AppData, item: Item, date: string): boolean {
  if (item.kind === "singleTask") return item.done;
  const entry = data.completionLog.find((e) => e.itemId === item.id && e.date === date);
  return item.kind === "habit" ? isHabitEntryComplete(item, entry) : !!entry;
}

/** Why the action doesn't fit this item, or undefined when it does. */
function reasonLeftOut(data: AppData, item: Item, request: BulkRequest, date: string, today: string): string | undefined {
  const day = date === today ? "today" : formatDate(date, today);
  const recurringOnly = request.action === "skip" || request.action === "pause" || request.action === "resume";
  if (item.kind === "singleTask") {
    if (recurringOnly) return "a one-off task";
    if (date !== today) return "a one-off task, marked on its own day";
    if (item.startDate !== today) return `not due ${day}`;
  } else if (isArchived(item, today) && item.endDate! < date) {
    return "archived";
  }
  switch (request.action) {
    case "done":
      if (item.kind !== "singleTask" && !occursOn(item, date)) {
        if (skipOn(item, date)) return `skipped ${day}`;
        return isPausedOn(item, date) ? `paused ${day}` : `not due ${day}`;
      }
      return isDone(data, item, date) ? `already done ${day}` : undefined;
    case "undone":
      return isDone(data, item, date) ? undefined : `not done ${day}`;
    case "skip": {
      const recurring = item as Recurring;
      if (recurring.recurrence.type === "timesPerPeriod") return "no set day to skip";
      if (skipOn(recurring, date)) return `already skipped ${day}`;
      if (isPausedOn(recurring, date)) return `paused ${day}`;
      if (!occursOn(recurring, date)) return `not due ${day}`;
      return isDone(data, item, date) ? `already done ${day}` : undefined;
    }
    case "pause":
      return undefined;
    case "resume":
      return isPaused(item as Recurring, today) || upcomingPause(item as Recurring, today) ? undefined : "not paused";
  }
}

function applyOne(data: AppData, item: Item, request: BulkRequest, date: string, today: string, pause: PausePeriod): AppData {
  switch (request.action) {
    case "done":
    case "undone": {
      const done = request.action === "done";
      if (item.kind === "habit") return setHabitDone(data, item.id, date, done);
      if (item.kind === "recurringTask") return setRecurringTaskDone(data, item.id, date, done);
      return updateSingleTask(data, item.id, { newDone: done }, today);
    }
    case "skip": {
      const current = (item.kind === "habit" ? data.habits : data.recurringTasks).find((i) => i.id === item.id) as Recurring | undefined;
      return current ? skipDay(data, current, date) : data;
    }
    case "pause":
      return pauseItem(data, item.kind as Recurring["kind"], item.id, pause, today);
    case "resume":
      return resumeItem(data, item.kind as Recurring["kind"], item.id, today);
  }
}

function listNames(items: { name: string }[]): string {
  return items.map((item) => item.name).join(", ");
}

/** "my morning habits in Health" as words, for the replies. */
export function describeFilter(filter: BulkFilter, categories: Category[]): string {
  const kind = { habit: "habits", recurringTask: "recurring tasks", singleTask: "one-off tasks" }[filter.kind ?? "habit"];
  const parts = [filter.dayPart ? dayPartLabel(filter.dayPart) : "", filter.kind ? kind : "items"].filter(Boolean).join(" ");
  const category = categories.find((c) => c.id === filter.categoryId);
  return category ? `${parts} in ${category.name}` : parts;
}

function doneLine(request: BulkRequest, date: string, today: string, pause: PausePeriod): string {
  const day = date === today ? "today" : `on ${formatDate(date, today)}`;
  switch (request.action) {
    case "done":
      return `Marked done ${day}`;
    case "undone":
      return `Marked not done ${day}`;
    case "skip":
      return `Skipped ${day} (neither done nor missed)`;
    case "pause": {
      const from = pause.from === today ? "from today" : `from ${formatDate(pause.from, today)}`;
      return pause.resumeOn ? `Paused ${from}, back on ${formatDate(pause.resumeOn, today)}` : `Paused ${from}, until you resume them`;
    }
    case "resume":
      return "Resumed from today";
  }
}

type Chosen = { status: "rejected"; message: string } | { status: "ambiguous"; name: string; candidates: Item[] } | { status: "ok"; chosen: Item[]; named: boolean };

/**
 * The items a request means: each name the user said (each must match one item), or every
 * live item the filters catch (finished one-off tasks only when `doneTasksToo`).
 */
function chooseItems(data: AppData, filter: BulkFilter, today: string, doneTasksToo: boolean): Chosen {
  const candidates = pool(data, filter);
  let chosen: Item[];
  if (filter.names?.length) {
    chosen = [];
    for (const name of filter.names) {
      const selection = selectOne(candidates, { name });
      if (selection.kind === "none") return { status: "rejected", message: `I couldn't find anything called "${name}".` };
      if (selection.kind === "many") return { status: "ambiguous", name, candidates: selection.items };
      if (selection.kind === "one" && !chosen.includes(selection.item)) chosen.push(selection.item);
    }
  } else {
    chosen = candidates.filter(
      (item) =>
        (!filter.dayPart || item.dayPart === filter.dayPart) &&
        (!filter.categoryId || item.categoryId === filter.categoryId) &&
        (item.kind === "singleTask" ? !item.done || doneTasksToo : !isArchived(item, today) || item.endDate === today),
    );
  }
  return { status: "ok", chosen: chosen.sort(compareForDay), named: !!filter.names?.length };
}

/**
 * What one bulk request would do. Pass `data` as the app shows it (one-off tasks already
 * carried over to today); `confirmed` once the user said yes to doing everything.
 */
export function planBulk(data: AppData, request: BulkRequest, today: string, confirmed = false): BulkPlan {
  const date = request.date ?? today;
  const from = request.from ?? today;
  if ((request.action === "done" || request.action === "undone") && date > today) {
    return { status: "rejected", message: `${formatDate(date, today)} hasn't happened yet, so nothing can be marked on it.` };
  }
  if (request.action === "skip" && date < today) return { status: "rejected", message: `I can only skip today or a later day, not ${formatDate(date, today)}.` };
  if (request.action === "pause" && from < today) return { status: "rejected", message: `I can only pause from today onwards: ${formatDate(from, today)} has already happened.` };
  if (request.action === "pause" && request.resumeOn && request.resumeOn <= from) {
    return { status: "rejected", message: `That pause would end before it starts: ${formatDate(request.resumeOn, today)} isn't after ${formatDate(from, today)}.` };
  }
  const pause: PausePeriod = { from, ...(request.resumeOn ? { resumeOn: request.resumeOn } : {}) };
  const { filter } = request;
  const selected = chooseItems(data, filter, today, request.action === "undone");
  if (selected.status !== "ok") return selected;
  const { chosen, named } = selected;

  const targets: Item[] = [];
  const leftOut: { name: string; reason: string }[] = [];
  for (const item of chosen) {
    const reason = reasonLeftOut(data, item, request, date, today);
    if (!reason) targets.push(item);
    // A filter quietly passes over what it couldn't mean (a one-off task when pausing, an
    // item not due that day); a name the user said is always accounted for.
    else if (named || !/^(a one-off task|not due|archived|not done|not paused)/.test(reason)) leftOut.push({ name: item.name, reason });
  }

  if (isEverything(filter) && !confirmed && targets.length > 0) {
    const verb = { done: "mark them all done", undone: "mark them all not done", skip: "skip them all", pause: "pause them all", resume: "resume them all" }[request.action];
    return { status: "needs_confirm", question: `That's every item (${targets.length}): ${listNames(targets)}. Do you want to ${verb}?`, targets };
  }

  const lines: string[] = [];
  if (targets.length) lines.push(`${doneLine(request, date, today, pause)}: ${listNames(targets)}.`);
  else lines.push(named || leftOut.length ? "Nothing changed." : `Nothing to change: no ${describeFilter(filter, data.categories)} fit that.`);
  if (leftOut.length) lines.push(`Left out: ${leftOut.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}.`);
  return {
    status: "ok",
    targets,
    leftOut,
    message: lines.join("\n"),
    apply: (current) => targets.reduce((next, item) => applyOne(next, item, request, date, today, pause), current),
  };
}

// --- §78: one edit on several items ---------------------------------------------------------

/** The fields a bulk edit can change; goals, units, names and steps stay per item. */
export interface BulkEdit {
  dayPart?: DayPart;
  important?: boolean;
  categoryId?: string;
  recurrence?: RecurrenceRule;
}

function sameRule(a: RecurrenceRule, b: RecurrenceRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function editLine(edit: BulkEdit, categories: Category[]): string {
  const parts: string[] = [];
  if (edit.dayPart) parts.push(`moved to ${dayPartLabel(edit.dayPart)}`);
  if (edit.important !== undefined) parts.push(edit.important ? "marked important" : "no longer important");
  if (edit.categoryId) parts.push(`put in ${categories.find((c) => c.id === edit.categoryId)?.name ?? edit.categoryId}`);
  if (edit.recurrence) parts.push(`now ${describeRecurrence(edit.recurrence).toLowerCase()}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One edit on every item named or caught by the filters (live items only). Items it doesn't
 * fit are left out with a reason: a one-off task has no repeat rule, and an item already set
 * that way has nothing to change. Only "everything" with no filter asks first; "undo that"
 * (§70) takes back the rest.
 */
export function planBulkEdit(data: AppData, filter: BulkFilter, edit: BulkEdit, today: string, confirmed = false): BulkPlan {
  if (edit.dayPart === undefined && edit.important === undefined && edit.categoryId === undefined && edit.recurrence === undefined) {
    return { status: "rejected", message: "What should change on them? The part of the day, important or not, the category, or how often they repeat." };
  }
  if (edit.categoryId && !data.categories.some((c) => c.id === edit.categoryId)) {
    return { status: "rejected", message: "I couldn't find that category." };
  }
  const selected = chooseItems(data, filter, today, false);
  if (selected.status !== "ok") return selected;
  const { chosen, named } = selected;

  const targets: Item[] = [];
  const leftOut: { name: string; reason: string }[] = [];
  for (const item of chosen) {
    if (edit.recurrence && item.kind === "singleTask") {
      if (named || edit.dayPart || edit.important !== undefined || edit.categoryId) leftOut.push({ name: item.name, reason: "a one-off task doesn't repeat" });
      continue;
    }
    const unchanged =
      (edit.dayPart === undefined || item.dayPart === edit.dayPart) &&
      (edit.important === undefined || isImportant(item) === edit.important) &&
      (edit.categoryId === undefined || item.categoryId === edit.categoryId) &&
      (edit.recurrence === undefined || (item.kind !== "singleTask" && sameRule(item.recurrence, edit.recurrence)));
    if (unchanged) leftOut.push({ name: item.name, reason: "already like that" });
    else targets.push(item);
  }

  if (isEverything(filter) && !confirmed && targets.length > 0) {
    return { status: "needs_confirm", question: `That's every item (${targets.length}): ${listNames(targets)}. Do you want to change them all?`, targets };
  }

  const patch: UpdatePatch = {
    ...(edit.dayPart ? { newDayPart: edit.dayPart } : {}),
    ...(edit.important !== undefined ? { newImportant: edit.important } : {}),
    ...(edit.categoryId ? { newCategoryId: edit.categoryId } : {}),
  };
  const lines: string[] = [];
  if (targets.length) lines.push(`${editLine(edit, data.categories)}: ${listNames(targets)}.`);
  else lines.push(named || leftOut.length ? "Nothing changed." : `Nothing to change: no ${describeFilter(filter, data.categories)} fit that.`);
  if (leftOut.length) lines.push(`Left out: ${leftOut.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}.`);
  return {
    status: "ok",
    targets,
    leftOut,
    message: lines.join("\n"),
    apply: (current) =>
      targets.reduce((next, item) => {
        if (item.kind === "habit") return updateHabit(next, item.id, { ...patch, ...(edit.recurrence ? { newRecurrence: edit.recurrence } : {}) }, today);
        if (item.kind === "recurringTask") return updateRecurringTask(next, item.id, { ...patch, ...(edit.recurrence ? { newRecurrence: edit.recurrence } : {}) }, today);
        return updateSingleTask(next, item.id, patch, today);
      }, current),
  };
}
