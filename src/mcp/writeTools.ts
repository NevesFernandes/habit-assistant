// The write tools' decisions: which items a call means, and whether each change is allowed.
// The changes themselves are dataStore's own functions, and the rules are chatEngine.ts's
// (§29 future dates, §41 set-not-toggle), so the app and the connector can't disagree.
// Pure: no Drive, no clock; `todayISO` is always the user's, passed in.
import type { AppData, ChecklistMode, CompletionType, DayPart, Habit, RecurringTask, SingleTask } from "../types/models.ts";
import {
  addHabit,
  addRecurringTask,
  addSingleTask,
  resolveCategoryId,
  setHabitDone,
  setHabitValue,
  setRecurringTaskDone,
  updateHabit,
  updateKindsFor,
  updateRecurringTask,
  updateSingleTask,
  type CreateHabitInput,
  type CreateRecurringTaskInput,
  type CreateSingleTaskInput,
  type UpdatePatch,
} from "../lib/dataStore.ts";
import { currentPause, describeRecurrence, isArchived, isFutureDate, occursOn, upcomingPause } from "../lib/recurrence.ts";
import { currentHabitChecklist } from "../lib/habitChecklist.ts";
import {
  describeCreatedHabit,
  describeCreatedRecurringTask,
  describeCreatedSingleTask,
  describeDuplicateQuestion,
  describeFutureTaskQuestion,
  describeNotDue,
  describeUpdate,
  formatDate,
} from "../lib/confirmations.ts";
import { compareForDay, isImportant } from "../lib/dayParts.ts";
import { findSameName, selectOne } from "../lib/itemSelection.ts";
import { parseCompactRecurrence } from "../server/recurrenceSpec.ts";

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
  let selection = selectOne(pool, { name: input.name }, canTakeAction);
  // §32: Claude can't see the data, so the kind it guessed may be wrong; any kind that matches will do.
  if (selection.kind === "none" && input.type) selection = selectOne(itemsOf(data), { name: input.name }, canTakeAction);
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

export function summarize(data: AppData, item: AnyItem, todayISO: string): ItemSummary {
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

// --- create_item / update_item -----------------------------------------------------------

/** Not allowed as asked: `reason` is for the user. `need_info` means ask the user something first. */
export type Refusal = { status: "rejected" | "need_info" | "invalid_recurrence"; message: string };

export interface CreateItemInput {
  type: ItemKind;
  name: string;
  userMessage: string;
  description?: string;
  category?: string;
  dayPart: DayPart;
  important?: boolean;
  recurrence?: string;
  startDate?: string;
  startWeekday?: number;
  startWeekdayMode?: "closest" | "next";
  endDate?: string;
  completionType?: CompletionType;
  target?: number;
  unit?: string;
  checklistItems?: string[];
  withChecklist?: boolean;
  checklistMode?: ChecklistMode;
  carriesOver?: boolean;
  confirmDuplicate?: boolean;
}

export type CreatePlan =
  | Refusal
  | { status: "needs_confirm"; question: string }
  | { status: "ok"; add: (data: AppData) => AppData; describe: (saved: AppData) => { item: AnyItem; confirmation: string } };

const NOUNS: Record<ItemKind, string> = { habit: "habit", recurringTask: "recurring task", singleTask: "task" };

function steps(texts: string[] | undefined): string[] {
  return (texts ?? []).map((text) => text.trim()).filter((text) => text.length > 0);
}

/** The engine's create rules (§31/§32): a goal for number/timer habits, a step for checklist habits, a yes before reusing a name. */
export function planCreate(data: AppData, input: CreateItemInput, todayISO: string): CreatePlan {
  const name = input.name.trim();
  if (!name) return { status: "need_info", message: "Ask the user what to call it." };
  const base = {
    name,
    description: input.description?.trim() || undefined,
    dayPart: input.dayPart,
    important: input.important,
    startDate: input.startDate,
    startWeekday: input.startWeekday,
    startWeekdayMode: input.startWeekdayMode,
  };

  let recurrence;
  if (input.type !== "singleTask") {
    const parsed = parseCompactRecurrence(input.recurrence);
    if (!parsed.ok) return { status: "invalid_recurrence", message: `${parsed.error}. Use the recurrence format in this tool's description.` };
    recurrence = parsed.rule;
  } else if (input.recurrence) {
    return { status: "rejected", message: "A one-off task doesn't repeat. Use type recurringTask for something that repeats." };
  }

  const completionType = input.type === "habit" ? (input.completionType ?? "yesno") : undefined;
  if ((completionType === "value" || completionType === "timer") && !(input.target && input.target > 0)) {
    return { status: "need_info", message: "A number or timer habit needs a goal. Ask the user for the amount (and unit), then call again with `target`." };
  }
  if (completionType === "checklist" && steps(input.checklistItems).length === 0) {
    return { status: "need_info", message: "A checklist habit needs at least one step. Ask the user for the steps, then call again with `checklistItems`." };
  }

  if (!input.confirmDuplicate) {
    const existing = findSameName<AnyItem>(itemsOf(data, input.type), name, todayISO);
    if (existing.length > 0) {
      return { status: "needs_confirm", question: describeDuplicateQuestion(NOUNS[input.type], name, existing, data.categories, todayISO) };
    }
  }

  // Each add* appends, so the new item is the last of its list in the saved data.
  if (input.type === "habit") {
    const create: CreateHabitInput = {
      ...base,
      // addHabit takes only an exact id and falls back to Other; a name is resolved first.
      categoryId: resolveCategoryId(data, input.category),
      endDate: input.endDate,
      recurrence: recurrence!,
      completionType: input.completionType,
      checklistItems: completionType === "checklist" ? steps(input.checklistItems) : undefined,
      target: input.target,
      unit: input.unit,
    };
    return {
      status: "ok",
      add: (d) => addHabit(d, create, todayISO),
      describe: (saved) => {
        const item = saved.habits[saved.habits.length - 1];
        return { item, confirmation: describeCreatedHabit(item, create, saved.categories, input.userMessage, todayISO) };
      },
    };
  }
  if (input.type === "recurringTask") {
    const create: CreateRecurringTaskInput = {
      ...base,
      categoryId: input.category,
      endDate: input.endDate,
      recurrence: recurrence!,
      withChecklist: input.withChecklist,
      checklistItems: steps(input.checklistItems),
      checklistMode: input.checklistMode,
    };
    return {
      status: "ok",
      add: (d) => addRecurringTask(d, create, todayISO),
      describe: (saved) => {
        const item = saved.recurringTasks[saved.recurringTasks.length - 1];
        return { item, confirmation: describeCreatedRecurringTask(item, create, saved.categories, input.userMessage, todayISO) };
      },
    };
  }
  const create: CreateSingleTaskInput = {
    ...base,
    categoryId: input.category,
    persistency: input.carriesOver,
    withChecklist: input.withChecklist,
    checklistItems: steps(input.checklistItems),
  };
  return {
    status: "ok",
    add: (d) => addSingleTask(d, create, todayISO),
    describe: (saved) => {
      const item = saved.singleTasks[saved.singleTasks.length - 1];
      return { item, confirmation: describeCreatedSingleTask(item, create, saved.categories, input.userMessage, todayISO) };
    },
  };
}

export interface UpdateFields {
  newName?: string;
  newDescription?: string;
  newCategory?: string;
  newDayPart?: DayPart;
  newImportant?: boolean;
  newStartDate?: string;
  newStartWeekday?: number;
  newStartWeekdayMode?: "closest" | "next";
  newEndDate?: string;
  newRecurrence?: string;
  newCompletionType?: CompletionType;
  newTarget?: number;
  newUnit?: string;
  newChecklistItems?: string[];
  newChecklistItemsFrom?: string;
  newChecklistMode?: ChecklistMode;
  newCarriesOver?: boolean;
}

/** The patch dataStore takes, or why not. Category names resolve to ids here, as `newCategory` is the user's word. */
export function buildPatch(data: AppData, fields: UpdateFields): UpdatePatch | Refusal {
  const { newCategory, newRecurrence, newCarriesOver, ...rest } = fields;
  const patch: UpdatePatch = { ...rest, newPersistency: newCarriesOver };
  if (newRecurrence !== undefined) {
    const parsed = parseCompactRecurrence(newRecurrence);
    if (!parsed.ok) return { status: "invalid_recurrence", message: `${parsed.error}. Use the recurrence format in this tool's description.` };
    patch.newRecurrence = parsed.rule;
  }
  if (newCategory !== undefined) {
    // "" clears a task's category; anything else must name one that exists.
    const id = newCategory === "" ? "" : resolveCategoryId(data, newCategory);
    if (id === undefined) {
      return {
        status: "rejected",
        message: `There's no category called "${newCategory}". The categories are: ${data.categories.map((c) => c.name).join(", ")}.`,
      };
    }
    patch.newCategoryId = id;
  }
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as UpdatePatch;
  if (Object.keys(cleaned).length === 0) return { status: "need_info", message: "Nothing to change. Ask the user what to change." };
  return cleaned;
}

export const canTakePatch = (patch: UpdatePatch) => (item: AnyItem) => updateKindsFor(patch).includes(item.kind);

export type UpdatePlan =
  | Refusal
  | { status: "ok"; apply: (data: AppData) => AppData; describe: (saved: AppData) => { item: AnyItem; confirmation: string } | undefined };

function update(data: AppData, item: AnyItem, patch: UpdatePatch, todayISO: string): AppData {
  if (item.kind === "habit") return updateHabit(data, item.id, patch, todayISO);
  if (item.kind === "recurringTask") return updateRecurringTask(data, item.id, patch, todayISO);
  return updateSingleTask(data, item.id, patch, todayISO);
}

const findById = (data: AppData, id: string) => itemsOf(data).find((item) => item.id === id);

/** The engine's update rules (§56: steps never change from a future day) plus the create rules for what the habit ends up as. */
export function planUpdate(data: AppData, item: AnyItem, patch: UpdatePatch, todayISO: string): UpdatePlan {
  if (!updateKindsFor(patch).includes(item.kind)) {
    return { status: "rejected", message: `Those changes don't apply to a ${NOUNS[item.kind]} like "${item.name}".` };
  }
  const from = patch.newChecklistItemsFrom;
  if (from !== undefined && isFutureDate(from, todayISO)) {
    return {
      status: "rejected",
      message: `I can only change the steps of "${item.name}" from today or an earlier day, not from ${formatDate(from, todayISO)}.`,
    };
  }
  const preview = findById(update(data, item, patch, todayISO), item.id);
  if (preview?.kind === "habit") {
    if ((preview.completionType === "value" || preview.completionType === "timer") && !(preview.target && preview.target > 0)) {
      return { status: "need_info", message: "A number or timer habit needs a goal. Ask the user for the amount, then call again with `newTarget`." };
    }
    if (preview.completionType === "checklist" && currentHabitChecklist(preview).length === 0) {
      return { status: "need_info", message: "A checklist habit needs at least one step. Ask the user for the steps, then call again with `newChecklistItems`." };
    }
  }
  let before: AnyItem | undefined;
  return {
    status: "ok",
    apply: (d) => {
      before = findById(d, item.id);
      return update(d, item, patch, todayISO);
    },
    describe: (saved) => {
      const after = findById(saved, item.id);
      if (!before || !after) return undefined;
      const stepsText = (entry: AnyItem) => (entry.kind === "habit" ? currentHabitChecklist(entry).map((step) => step.text).join("\n") : "");
      const stepsNote =
        patch.newChecklistItems === undefined || stepsText(before) === stepsText(after)
          ? ""
          : from !== undefined && from < todayISO
            ? `\nThe new steps apply from ${formatDate(from, todayISO)} on. Days before that keep their steps.`
            : "\nThe new steps apply from today on. Earlier days keep their steps.";
      return { item: after, confirmation: describeUpdate(before, after, saved.categories, todayISO) + stepsNote };
    },
  };
}
