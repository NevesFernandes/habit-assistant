// Pure functions over AppData. Kept as plain reducers (not a class or a
// state-management library) — the app is small enough that App.tsx owning
// the state and calling these directly is simpler than adding a dependency.
import type { AppData, CompletionLogEntry, Habit, RecurrenceRule, SingleTask } from "../types/models";
import { resolveWeekdayDate } from "./recurrence";

export interface CreateSingleTaskInput {
  name: string;
  description?: string;
  categoryId?: string;
  priority?: number;
}

export function addSingleTask(data: AppData, input: CreateSingleTaskInput): AppData {
  const task: SingleTask = {
    kind: "singleTask",
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    priority: input.priority ?? 0,
    startDate: new Date().toISOString().slice(0, 10),
    done: false,
  };
  return { ...data, singleTasks: [...data.singleTasks, task] };
}

export function toggleSingleTaskDone(data: AppData, taskId: string): AppData {
  return {
    ...data,
    singleTasks: data.singleTasks.map((task) =>
      task.id === taskId ? { ...task, done: !task.done } : task,
    ),
  };
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
  completionType?: Habit["completionType"];
  checklistItems?: string[];
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

function resolveStartDate(input: CreateHabitInput): string {
  if (input.startWeekday !== undefined) {
    return resolveWeekdayDate(today(), input.startWeekday, input.startWeekdayMode ?? "closest");
  }
  return normalizeStartDate(input.startDate);
}

function buildRecurrence(input: CreateHabitInput): RecurrenceRule {
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
