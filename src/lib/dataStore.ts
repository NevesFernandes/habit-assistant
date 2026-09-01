// Pure functions over AppData. Kept as plain reducers (not a class or a
// state-management library) — the app is small enough that App.tsx owning
// the state and calling these directly is simpler than adding a dependency.
import type {
  AppData,
  BaseItem,
  Category,
  ChecklistItem,
  CompletionLogEntry,
  CompletionType,
  Habit,
  RecurrenceRule,
  RecurringTask,
  SingleTask,
} from "../types/models";
import { resolveWeekdayDate } from "./recurrence";

export interface CreateSingleTaskInput {
  name: string;
  description?: string;
  categoryId?: string;
  priority?: number;
  startDate?: string;
  persistency?: boolean;
}

export function addSingleTask(data: AppData, input: CreateSingleTaskInput): AppData {
  const task: SingleTask = {
    kind: "singleTask",
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    priority: input.priority ?? 0,
    startDate: normalizeStartDate(input.startDate),
    done: false,
    persistency: input.persistency ?? true,
  };
  return { ...data, singleTasks: [...data.singleTasks, task] };
}

/** Whether a task should appear on a given date: only on its current startDate. Persistent incomplete tasks are moved forward to today by rolloverPersistentTasks, not by a range check here. */
export function isSingleTaskActiveOn(task: SingleTask, dateISO: string): boolean {
  return task.startDate === dateISO;
}

export function toggleSingleTaskDone(data: AppData, taskId: string): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((task) =>
      task.id === taskId ? { ...task, done: !task.done } : task,
    ),
  };
}

/** Bumps each persistent, incomplete, past-dated single task's startDate straight to today. Call once per app session after loading data, before render. Non-persistent tasks and already-done tasks are left untouched (the latter stays pinned to its original day, preserving history). Returns `data` unchanged (same reference) if nothing moved, so callers can skip a Drive write when there's nothing to roll. Tasks saved before `persistency` existed have it `undefined`; default that to `true`, matching the field's own creation-time default. */
export function rolloverPersistentTasks(data: AppData, todayISO: string): AppData {
  let changed = false;
  const singleTasks = data.singleTasks.map((task) => {
    if ((task.persistency ?? true) && !task.done && task.startDate < todayISO) {
      changed = true;
      return { ...task, startDate: todayISO };
    }
    return task;
  });
  return changed ? { ...data, singleTasks } : data;
}

export interface CreateHabitInput {
  name: string;
  description?: string;
  categoryId?: string;
  priority?: number;
  startDate?: string;
  // Preferred over startDate when the user named a start day by weekday
  // rather than an absolute date (e.g. "next Tuesday") — resolved
  // deterministically in code rather than trusted to the model's own
  // day-counting. 0 = Sunday .. 6 = Saturday, matching recurrenceDays.
  startWeekday?: number;
  startWeekdayMode?: "closest" | "next";
  endDate?: string;
  recurrenceType: RecurrenceRule["type"];
  recurrenceDays?: number[];
  recurrenceInterval?: number;
  recurrencePeriod?: "week" | "month";
  recurrenceCount?: number;
  recurrenceNth?: "first" | "second" | "third" | "fourth" | "fifth" | "last";
  recurrenceWeekday?: number;
  recurrenceDates?: string[]; // "MM-DD", no year
  recurrenceOnDays?: number;
  recurrenceOffDays?: number;
  completionType?: Habit["completionType"];
  checklistItems?: string[];
  target?: number; // meaningful when completionType is "value" or "timer"; timer's target is always minutes
  unit?: string; // meaningful when completionType is "value"
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Positive integer, defaulting to 1 (the lowest priority) — never 0 or negative. */
function normalizePriority(priority: number | undefined): number {
  if (priority === undefined || !Number.isFinite(priority) || priority < 1) return 1;
  return Math.round(priority);
}

/** Defaults to today; a past date is clamped forward rather than accepted as-is. */
function normalizeStartDate(startDate: string | undefined): string {
  const todayISO = today();
  if (!startDate || startDate < todayISO) return todayISO;
  return startDate;
}

type StartDateInput = Pick<CreateHabitInput, "startDate" | "startWeekday" | "startWeekdayMode">;

function resolveStartDate(input: StartDateInput): string {
  if (input.startWeekday !== undefined) {
    return resolveWeekdayDate(today(), input.startWeekday, input.startWeekdayMode ?? "closest");
  }
  return normalizeStartDate(input.startDate);
}

type RecurrenceInput = Pick<
  CreateHabitInput,
  | "recurrenceType"
  | "recurrenceDays"
  | "recurrenceInterval"
  | "recurrencePeriod"
  | "recurrenceCount"
  | "recurrenceNth"
  | "recurrenceWeekday"
  | "recurrenceDates"
  | "recurrenceOnDays"
  | "recurrenceOffDays"
>;

function buildRecurrence(input: RecurrenceInput): RecurrenceRule {
  switch (input.recurrenceType) {
    case "daysOfWeek":
      return { type: "daysOfWeek", days: input.recurrenceDays ?? [] };
    case "intervalDays":
      return { type: "intervalDays", interval: input.recurrenceInterval ?? 1 };
    case "timesPerPeriod":
      return {
        type: "timesPerPeriod",
        period: input.recurrencePeriod ?? "week",
        count: input.recurrenceCount ?? 1,
      };
    case "nthWeekdayOfMonth":
      return {
        type: "nthWeekdayOfMonth",
        nth: input.recurrenceNth ?? "first",
        weekday: input.recurrenceWeekday ?? 0,
      };
    case "specificDatesOfYear":
      return { type: "specificDatesOfYear", dates: input.recurrenceDates ?? [] };
    case "onOffCycle":
      return {
        type: "onOffCycle",
        onDays: input.recurrenceOnDays ?? 1,
        offDays: input.recurrenceOffDays ?? 0,
      };
    case "daily":
    default:
      return { type: "daily" };
  }
}

export function addHabit(data: AppData, input: CreateHabitInput): AppData {
  const categoryId =
    input.categoryId && data.categories.some((category) => category.id === input.categoryId)
      ? input.categoryId
      : "other";
  const completionType = input.completionType ?? "yesno";

  const habit: Habit = {
    kind: "habit",
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    categoryId,
    priority: normalizePriority(input.priority),
    startDate: resolveStartDate(input),
    endDate: input.endDate,
    recurrence: buildRecurrence(input),
    completionType,
    checklist:
      completionType === "checklist"
        ? (input.checklistItems ?? []).map((text) => ({
            id: crypto.randomUUID(),
            text,
            checked: false,
          }))
        : undefined,
    target: completionType === "value" || completionType === "timer" ? input.target : undefined,
    unit: completionType === "value" ? input.unit : undefined,
  };
  return { ...data, habits: [...data.habits, habit] };
}

export function toggleHabitCompletion(data: AppData, habitId: string, dateISO: string): AppData {
  const existing = data.completionLog.find(
    (entry) => entry.itemId === habitId && entry.date === dateISO,
  );
  if (existing) {
    return {
      ...data,
      completionLog: data.completionLog.filter((entry) => entry.id !== existing.id),
    };
  }
  const entry: CompletionLogEntry = {
    id: crypto.randomUUID(),
    itemId: habitId,
    date: dateISO,
  };
  return { ...data, completionLog: [...data.completionLog, entry] };
}

/** Upserts a numeric/timer habit's logged value for a date — used by logHabitProgress, not the yesno toggle above. */
export function setHabitValue(data: AppData, habitId: string, dateISO: string, value: number): AppData {
  const existing = data.completionLog.find((entry) => entry.itemId === habitId && entry.date === dateISO);
  if (existing) {
    return {
      ...data,
      completionLog: data.completionLog.map((entry) => (entry.id === existing.id ? { ...entry, value } : entry)),
    };
  }
  const entry: CompletionLogEntry = {
    id: crypto.randomUUID(),
    itemId: habitId,
    date: dateISO,
    value,
  };
  return { ...data, completionLog: [...data.completionLog, entry] };
}

export interface CreateRecurringTaskInput {
  name: string;
  description?: string;
  categoryId?: string;
  priority?: number;
  startDate?: string;
  startWeekday?: number;
  startWeekdayMode?: "closest" | "next";
  endDate?: string;
  recurrenceType: RecurrenceRule["type"];
  recurrenceDays?: number[];
  recurrenceInterval?: number;
  recurrencePeriod?: "week" | "month";
  recurrenceCount?: number;
  recurrenceNth?: "first" | "second" | "third" | "fourth" | "fifth" | "last";
  recurrenceWeekday?: number;
  recurrenceDates?: string[]; // "MM-DD", no year
  recurrenceOnDays?: number;
  recurrenceOffDays?: number;
}

export function addRecurringTask(data: AppData, input: CreateRecurringTaskInput): AppData {
  const task: RecurringTask = {
    kind: "recurringTask",
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    priority: normalizePriority(input.priority),
    startDate: resolveStartDate(input),
    endDate: input.endDate,
    recurrence: buildRecurrence(input),
  };
  return { ...data, recurringTasks: [...data.recurringTasks, task] };
}

export function toggleRecurringTaskCompletion(data: AppData, taskId: string, dateISO: string): AppData {
  const existing = data.completionLog.find(
    (entry) => entry.itemId === taskId && entry.date === dateISO,
  );
  if (existing) {
    return {
      ...data,
      completionLog: data.completionLog.filter((entry) => entry.id !== existing.id),
    };
  }
  const entry: CompletionLogEntry = {
    id: crypto.randomUUID(),
    itemId: taskId,
    date: dateISO,
  };
  return { ...data, completionLog: [...data.completionLog, entry] };
}

// All fields are optional and ANDed together (categoryIds ORs within
// itself). `all: true` bypasses every other field. Kept flat (no nested
// objects) to match the provider-adapter tool-schema contract — see
// providers/types.ts.
export interface DeleteCriteria {
  all?: boolean;
  name?: string; // case-insensitive substring match against item name
  categoryIds?: string[];
  startDateFrom?: string; // ISO date, inclusive lower bound on startDate
  startDateTo?: string; // ISO date, inclusive upper bound on startDate
  priorityMin?: number;
  priorityMax?: number;
  done?: boolean; // SingleTask only
  completionType?: CompletionType; // Habit only
  neverCompleted?: boolean; // Habit + RecurringTask: zero completionLog entries ever
  inactiveSince?: string; // Habit + RecurringTask: ISO date, no completions on/after this date
}

function matchesBaseCriteria(item: BaseItem, criteria: DeleteCriteria): boolean {
  if (criteria.name) {
    if (!item.name.toLowerCase().includes(criteria.name.trim().toLowerCase())) return false;
  }
  if (criteria.categoryIds && criteria.categoryIds.length > 0) {
    if (!item.categoryId || !criteria.categoryIds.includes(item.categoryId)) return false;
  }
  if (criteria.startDateFrom && item.startDate < criteria.startDateFrom) return false;
  if (criteria.startDateTo && item.startDate > criteria.startDateTo) return false;
  if (criteria.priorityMin !== undefined && item.priority < criteria.priorityMin) return false;
  if (criteria.priorityMax !== undefined && item.priority > criteria.priorityMax) return false;
  return true;
}

function matchesCompletionCriteria(
  itemId: string,
  completionLog: CompletionLogEntry[],
  criteria: DeleteCriteria,
): boolean {
  if (!criteria.neverCompleted && !criteria.inactiveSince) return true;
  const completions = completionLog.filter((entry) => entry.itemId === itemId);
  if (criteria.neverCompleted && completions.length > 0) return false;
  if (criteria.inactiveSince && completions.some((entry) => entry.date >= criteria.inactiveSince!)) return false;
  return true;
}

/** Defensive by design: a criteria object with no fields set (malformed/incomplete model output) matches nothing, never everything. */
function hasActiveFilter(criteria: DeleteCriteria): boolean {
  const { all: _all, ...rest } = criteria;
  return Object.values(rest).some((value) => value !== undefined);
}

export function resolveSingleTasks(data: AppData, criteria: DeleteCriteria): SingleTask[] {
  if (!criteria.all && !hasActiveFilter(criteria)) return [];
  return data.singleTasks.filter((task) => {
    if (criteria.all) return true;
    if (!matchesBaseCriteria(task, criteria)) return false;
    if (criteria.done !== undefined && task.done !== criteria.done) return false;
    return true;
  });
}

export function resolveHabits(data: AppData, criteria: DeleteCriteria): Habit[] {
  if (!criteria.all && !hasActiveFilter(criteria)) return [];
  return data.habits.filter((habit) => {
    if (criteria.all) return true;
    if (!matchesBaseCriteria(habit, criteria)) return false;
    if (criteria.completionType && habit.completionType !== criteria.completionType) return false;
    return matchesCompletionCriteria(habit.id, data.completionLog, criteria);
  });
}

export function resolveRecurringTasks(data: AppData, criteria: DeleteCriteria): RecurringTask[] {
  if (!criteria.all && !hasActiveFilter(criteria)) return [];
  return data.recurringTasks.filter((task) => {
    if (criteria.all) return true;
    if (!matchesBaseCriteria(task, criteria)) return false;
    return matchesCompletionCriteria(task.id, data.completionLog, criteria);
  });
}

export function deleteSingleTasks(data: AppData, ids: string[]): AppData {
  const idSet = new Set(ids);
  return { ...data, singleTasks: data.singleTasks.filter((task) => !idSet.has(task.id)) };
}

/** Cascade-deletes matching CompletionLogEntry rows too — the "tracked history" the confirmation warns about. */
export function deleteHabits(data: AppData, ids: string[]): AppData {
  const idSet = new Set(ids);
  return {
    ...data,
    habits: data.habits.filter((habit) => !idSet.has(habit.id)),
    completionLog: data.completionLog.filter((entry) => !idSet.has(entry.itemId)),
  };
}

/** Cascade-deletes matching CompletionLogEntry rows too, mirroring deleteHabits. */
export function deleteRecurringTasks(data: AppData, ids: string[]): AppData {
  const idSet = new Set(ids);
  return {
    ...data,
    recurringTasks: data.recurringTasks.filter((task) => !idSet.has(task.id)),
    completionLog: data.completionLog.filter((entry) => !idSet.has(entry.itemId)),
  };
}

// All fields optional; a field is only changed when its key is present with
// a non-undefined value — omitted means "leave as-is". "" clears an
// optional string field (description, endDate, and categoryId on
// SingleTask/RecurringTask only — Habit's categoryId is required). Shared
// across all three item kinds, mirroring DeleteCriteria's single-type shape
// rather than one interface per kind.
export interface UpdatePatch {
  newName?: string;
  newDescription?: string;
  newCategoryId?: string;
  newPriority?: number;
  newStartDate?: string;
  newEndDate?: string;
  newDone?: boolean; // SingleTask only
  newPersistency?: boolean; // SingleTask only
  newRecurrenceType?: RecurrenceRule["type"]; // Habit + RecurringTask
  newRecurrenceDays?: number[];
  newRecurrenceInterval?: number;
  newRecurrencePeriod?: "week" | "month";
  newRecurrenceCount?: number;
  newRecurrenceNth?: "first" | "second" | "third" | "fourth" | "fifth" | "last";
  newRecurrenceWeekday?: number;
  newRecurrenceDates?: string[]; // "MM-DD", no year — fully replaces the list, same as newChecklistItems
  newRecurrenceOnDays?: number;
  newRecurrenceOffDays?: number;
  newCompletionType?: CompletionType; // Habit only
  newChecklistItems?: string[]; // Habit only — full replace, fresh ids, unchecked
  newTarget?: number; // Habit only — meaningful when completionType is "value" or "timer"
  newUnit?: string; // Habit only — meaningful when completionType is "value"
}

function applyBaseItemPatch<T extends BaseItem>(item: T, patch: UpdatePatch): T {
  return {
    ...item,
    name: patch.newName?.trim() ? patch.newName.trim() : item.name,
    description: patch.newDescription !== undefined ? patch.newDescription || undefined : item.description,
    priority: patch.newPriority !== undefined ? normalizePriority(patch.newPriority) : item.priority,
    startDate: patch.newStartDate !== undefined ? normalizeStartDate(patch.newStartDate) : item.startDate,
    endDate: patch.newEndDate !== undefined ? patch.newEndDate || undefined : item.endDate,
  };
}

function resolveRecurrence(current: RecurrenceRule, patch: UpdatePatch): RecurrenceRule {
  if (patch.newRecurrenceType === undefined) return current;
  return buildRecurrence({
    recurrenceType: patch.newRecurrenceType,
    recurrenceDays: patch.newRecurrenceDays,
    recurrenceInterval: patch.newRecurrenceInterval,
    recurrencePeriod: patch.newRecurrencePeriod,
    recurrenceCount: patch.newRecurrenceCount,
    recurrenceNth: patch.newRecurrenceNth,
    recurrenceWeekday: patch.newRecurrenceWeekday,
    recurrenceDates: patch.newRecurrenceDates,
    recurrenceOnDays: patch.newRecurrenceOnDays,
    recurrenceOffDays: patch.newRecurrenceOffDays,
  });
}

export function updateSingleTask(data: AppData, id: string, patch: UpdatePatch): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((task) => {
      if (task.id !== id) return task;
      const base = applyBaseItemPatch(task, patch);
      return {
        ...base,
        categoryId: patch.newCategoryId !== undefined ? patch.newCategoryId || undefined : task.categoryId,
        done: patch.newDone !== undefined ? patch.newDone : task.done,
        persistency: patch.newPersistency !== undefined ? patch.newPersistency : task.persistency,
      };
    }),
  };
}

export function updateHabit(data: AppData, id: string, patch: UpdatePatch): AppData {
  return {
    ...data,
    habits: data.habits.map((habit) => {
      if (habit.id !== id) return habit;
      const base = applyBaseItemPatch(habit, patch);
      const categoryId =
        patch.newCategoryId !== undefined
          ? data.categories.some((category) => category.id === patch.newCategoryId)
            ? patch.newCategoryId
            : "other"
          : habit.categoryId;
      const completionType = patch.newCompletionType ?? habit.completionType;
      const checklist =
        completionType !== "checklist"
          ? undefined
          : patch.newChecklistItems !== undefined
            ? patch.newChecklistItems.map((text) => ({ id: crypto.randomUUID(), text, checked: false }))
            : (habit.checklist ?? []);
      const target =
        completionType === "value" || completionType === "timer"
          ? (patch.newTarget !== undefined ? patch.newTarget : habit.target)
          : undefined;
      const unit = completionType === "value" ? (patch.newUnit !== undefined ? patch.newUnit : habit.unit) : undefined;
      return {
        ...base,
        categoryId,
        recurrence: resolveRecurrence(habit.recurrence, patch),
        completionType,
        checklist,
        target,
        unit,
      };
    }),
  };
}

export function updateRecurringTask(data: AppData, id: string, patch: UpdatePatch): AppData {
  return {
    ...data,
    recurringTasks: data.recurringTasks.map((task) => {
      if (task.id !== id) return task;
      const base = applyBaseItemPatch(task, patch);
      return {
        ...base,
        categoryId: patch.newCategoryId !== undefined ? patch.newCategoryId || undefined : task.categoryId,
        recurrence: resolveRecurrence(task.recurrence, patch),
      };
    }),
  };
}

function toggleChecklistItemState(checklist: ChecklistItem[] | undefined, itemId: string): ChecklistItem[] {
  return (checklist ?? []).map((item) => (item.id === itemId ? { ...item, checked: !item.checked } : item));
}

function setChecklistItemCheckedState(
  checklist: ChecklistItem[] | undefined,
  itemId: string,
  checked: boolean,
): ChecklistItem[] {
  return (checklist ?? []).map((item) => (item.id === itemId ? { ...item, checked } : item));
}

function appendChecklistItemState(checklist: ChecklistItem[] | undefined, text: string): ChecklistItem[] {
  return [...(checklist ?? []), { id: crypto.randomUUID(), text, checked: false }];
}

// A Habit's checklist (unlike a Task's) resets per occurrence: `Habit.checklist` is
// just the template (item set/order), and live checked state lives per-date on
// `CompletionLogEntry.checklist`, seeded from the template the first time a date is
// touched. This mirrors setHabitValue's upsert-by-(habitId,date) shape for
// numeric/timer habits, just carrying a checklist snapshot instead of a number.
function withHabitChecklistEntry(
  data: AppData,
  habit: Habit,
  dateISO: string,
  update: (checklist: ChecklistItem[]) => ChecklistItem[],
): AppData {
  const existing = data.completionLog.find((entry) => entry.itemId === habit.id && entry.date === dateISO);
  const baseChecklist = existing?.checklist ?? (habit.checklist ?? []).map((item) => ({ ...item, checked: false }));
  const updatedChecklist = update(baseChecklist);
  if (existing) {
    return {
      ...data,
      completionLog: data.completionLog.map((entry) =>
        entry.id === existing.id ? { ...entry, checklist: updatedChecklist } : entry,
      ),
    };
  }
  const entry: CompletionLogEntry = {
    id: crypto.randomUUID(),
    itemId: habit.id,
    date: dateISO,
    checklist: updatedChecklist,
  };
  return { ...data, completionLog: [...data.completionLog, entry] };
}

// UI path (component already renders the item's current state, so a blind flip is
// safe) vs. chat path (setChecked — the agent can't see current state and must act
// on stated intent, "check off X" vs "uncheck X", not blindly flip it). Mirrors
// toggleHabitCompletion (UI) vs. setHabitValue (chat) for numeric/timer habits. Unlike
// toggleHabitCompletion, never deletes the entry on uncheck — completion here is judged
// by "all items checked" (see isHabitEntryComplete), not by entry presence, so a
// partially/fully-unchecked entry is still meaningful state worth keeping.
export function toggleHabitChecklistItem(data: AppData, habitId: string, itemId: string, dateISO: string): AppData {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return data;
  return withHabitChecklistEntry(data, habit, dateISO, (checklist) => toggleChecklistItemState(checklist, itemId));
}

export function toggleRecurringTaskChecklistItem(data: AppData, taskId: string, itemId: string): AppData {
  return {
    ...data,
    recurringTasks: data.recurringTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: toggleChecklistItemState(t.checklist, itemId) } : t,
    ),
  };
}

export function toggleSingleTaskChecklistItem(data: AppData, taskId: string, itemId: string): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: toggleChecklistItemState(t.checklist, itemId) } : t,
    ),
  };
}

export function setHabitChecklistItemChecked(
  data: AppData,
  habitId: string,
  itemId: string,
  checked: boolean,
  dateISO: string,
): AppData {
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return data;
  return withHabitChecklistEntry(data, habit, dateISO, (checklist) =>
    setChecklistItemCheckedState(checklist, itemId, checked),
  );
}

export function setRecurringTaskChecklistItemChecked(
  data: AppData,
  taskId: string,
  itemId: string,
  checked: boolean,
): AppData {
  return {
    ...data,
    recurringTasks: data.recurringTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: setChecklistItemCheckedState(t.checklist, itemId, checked) } : t,
    ),
  };
}

export function setSingleTaskChecklistItemChecked(
  data: AppData,
  taskId: string,
  itemId: string,
  checked: boolean,
): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: setChecklistItemCheckedState(t.checklist, itemId, checked) } : t,
    ),
  };
}

// Dual-use: called both from the UI's "+" button (already has the task id) and from
// the chat path (resolves the task by name first, then calls this same function). No
// Habit equivalent — a Habit's checklist is a fixed routine set at creation/update
// time (createHabit/updateHabit's checklistItems/newChecklistItems), not a growing list.
export function addRecurringTaskChecklistItem(data: AppData, taskId: string, text: string): AppData {
  return {
    ...data,
    recurringTasks: data.recurringTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: appendChecklistItemState(t.checklist, text) } : t,
    ),
  };
}

export function addSingleTaskChecklistItem(data: AppData, taskId: string, text: string): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((t) =>
      t.id === taskId ? { ...t, checklist: appendChecklistItemState(t.checklist, text) } : t,
    ),
  };
}

export interface CreateCategoryInput {
  name: string;
  icon: string;
}

export function addCategory(data: AppData, input: CreateCategoryInput): AppData {
  const category: Category = {
    id: crypto.randomUUID(),
    name: input.name,
    icon: input.icon,
    isDefault: false,
  };
  return { ...data, categories: [...data.categories, category] };
}

// A separate shape from UpdatePatch — Category doesn't extend BaseItem, so it
// shouldn't be force-fit into that item-shaped interface.
export interface UpdateCategoryPatch {
  newName?: string;
  newIcon?: string;
}

export function updateCategory(data: AppData, id: string, patch: UpdateCategoryPatch): AppData {
  return {
    ...data,
    categories: data.categories.map((category) =>
      category.id === id
        ? {
            ...category,
            name: patch.newName?.trim() ? patch.newName.trim() : category.name,
            icon: patch.newIcon !== undefined ? patch.newIcon : category.icon,
          }
        : category,
    ),
  };
}

/** True if any habit, recurring task, or single task (past or current — there's no
 * separate archive that removes old items from these arrays) still references this
 * categoryId. Callers must check this before calling deleteCategory and block the
 * delete in the UI if true — deleteCategory itself performs no guard, mirroring how
 * deleteSingleTasks/deleteHabits/deleteRecurringTasks take pre-resolved ids without
 * re-validating. */
export function isCategoryInUse(data: AppData, categoryId: string): boolean {
  return (
    data.habits.some((habit) => habit.categoryId === categoryId) ||
    data.recurringTasks.some((task) => task.categoryId === categoryId) ||
    data.singleTasks.some((task) => task.categoryId === categoryId)
  );
}

export function deleteCategory(data: AppData, id: string): AppData {
  return { ...data, categories: data.categories.filter((category) => category.id !== id) };
}
