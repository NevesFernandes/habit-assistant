// §63: stats for recurring and one-off tasks, beside habitStats.ts and shared by the app and
// the Claude connector.
// - A recurring task gets exactly a habit's stats (streak, best streak, completion %, counts,
//   heatmap): it's tracked done/not-done per occurrence like a yes/no habit, so it goes
//   through the same code as one (asTrackable) and the two can never disagree.
// - A one-off task has one occurrence, so its stats only make sense across many: how many
//   were done in each period (by doneOn), how many are open, and how long open ones have
//   been carried over.
import type { AppData, CompletionLogEntry, Habit, RecurringTask, SingleTask, WeekStart } from "../types/models.ts";
import { aggregateCategoryStats, computeHabitStats, type CategoryStats, type HabitStats } from "./habitStats.ts";
import { daysBetween, startOfMonth, startOfWeek, startOfYear } from "./recurrence.ts";

/** A recurring task seen as a yes/no habit: any log entry is a completion. Read-only use. */
export function asTrackable(task: RecurringTask): Habit {
  return { ...task, kind: "habit", categoryId: task.categoryId ?? "", completionType: "yesno" };
}

export function computeRecurringTaskStats(task: RecurringTask, log: CompletionLogEntry[], todayISO: string, weekStartsOn: WeekStart): HabitStats {
  return computeHabitStats(asTrackable(task), log, todayISO, weekStartsOn);
}

/** Same shape as a category's habit stats; `habitCount` is the number of tasks. */
export function aggregateRecurringTaskStats(tasks: RecurringTask[], log: CompletionLogEntry[], todayISO: string, weekStartsOn: WeekStart): CategoryStats {
  return aggregateCategoryStats(tasks.map(asTrackable), log, todayISO, weekStartsOn);
}

export interface SingleTaskStats {
  taskCount: number;
  doneThisWeek: number;
  doneThisMonth: number;
  doneThisYear: number;
  /** Includes tasks done before §63, which have no done day. */
  doneAllTime: number;
  /** Not done, due today (carried over ones included). */
  open: number;
  /** Not done, on a later day. */
  upcoming: number;
  /** Open tasks first due before today. */
  carriedOver: number;
  /** How many days, on average, the carried-over ones have been carried; 0 when none. */
  averageDaysCarried: number;
}

/**
 * Pass tasks as the app shows them, unfinished ones already carried over to today
 * (rolloverPersistentTasks), so "open" matches the Today tab.
 */
export function computeSingleTaskStats(tasks: SingleTask[], todayISO: string, weekStartsOn: WeekStart): SingleTaskStats {
  const doneSince = (start: string) => tasks.filter((task) => task.done && task.doneOn !== undefined && task.doneOn >= start).length;
  const open = tasks.filter((task) => !task.done && task.startDate <= todayISO);
  const carried = open.filter((task) => (task.originalStartDate ?? task.startDate) < todayISO);
  const totalCarried = carried.reduce((sum, task) => sum + daysBetween(task.originalStartDate ?? task.startDate, todayISO), 0);
  return {
    taskCount: tasks.length,
    doneThisWeek: doneSince(startOfWeek(todayISO, weekStartsOn)),
    doneThisMonth: doneSince(startOfMonth(todayISO)),
    doneThisYear: doneSince(startOfYear(todayISO)),
    doneAllTime: tasks.filter((task) => task.done).length,
    open: open.length,
    upcoming: tasks.filter((task) => !task.done && task.startDate > todayISO).length,
    carriedOver: carried.length,
    averageDaysCarried: carried.length === 0 ? 0 : Math.round((totalCarried / carried.length) * 10) / 10,
  };
}

/** Everything the stats tab and get_stats show, per kind; tasks never dilute the habit numbers. */
export function statsByKind(data: AppData, todayISO: string, weekStartsOn: WeekStart, categoryId?: string) {
  const inCategory = <T extends { categoryId?: string }>(items: T[]) =>
    categoryId === undefined ? items : items.filter((item) => item.categoryId === categoryId);
  return {
    habits: aggregateCategoryStats(inCategory(data.habits), data.completionLog, todayISO, weekStartsOn),
    recurringTasks: aggregateRecurringTaskStats(inCategory(data.recurringTasks), data.completionLog, todayISO, weekStartsOn),
    singleTasks: computeSingleTaskStats(inCategory(data.singleTasks), todayISO, weekStartsOn),
  };
}
