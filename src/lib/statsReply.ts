// §63: the app chat's answer to a stats question ("what's my gym streak?", "how am I doing
// this month?"), worded here from the shared stats, the way historyReply.ts words history.
// The Claude connector's get_stats returns the same numbers for Claude to word.
import type { AppData, Habit, RecurringTask, SingleTask, WeekStart } from "../types/models.ts";
import type { CategoryStats, HabitStats } from "./habitStats.ts";
import { computeHabitStats } from "./habitStats.ts";
import { computeRecurringTaskStats, statsByKind, type SingleTaskStats } from "./taskStats.ts";
import { daysBetween } from "./recurrence.ts";
import { shortDate } from "./historyReply.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function counts(s: { completionsThisWeek: number; completionsThisMonth: number; completionsThisYear: number; completionsAllTime: number }): string {
  return `This week ${s.completionsThisWeek}, this month ${s.completionsThisMonth}, this year ${s.completionsThisYear}, all time ${s.completionsAllTime}.`;
}

function streakLine(name: string, stats: HabitStats, unit: string): string {
  return `"${name}": current streak ${plural(stats.currentStreak, unit)} (best ${plural(stats.bestStreak, unit)}), ${stats.completionPercentage}% done. ${counts(stats)}`;
}

export function describeItemStats(data: AppData, item: Habit | RecurringTask | SingleTask, todayISO: string, weekStartsOn: WeekStart): string {
  if (item.kind === "singleTask") {
    if (item.done) return `"${item.name}" is done${item.doneOn ? ` (${shortDate(item.doneOn, todayISO)})` : ""}.`;
    const first = item.originalStartDate ?? item.startDate;
    if (item.startDate > todayISO) return `"${item.name}" is due ${shortDate(item.startDate, todayISO)}, not done yet.`;
    return first < todayISO
      ? `"${item.name}" isn't done yet; it has carried over ${plural(daysBetween(first, todayISO), "day")}.`
      : `"${item.name}" is due today, not done yet.`;
  }
  const unit = item.recurrence.type === "timesPerPeriod" ? "time" : "day";
  const stats =
    item.kind === "habit"
      ? computeHabitStats(item, data.completionLog, todayISO, weekStartsOn)
      : computeRecurringTaskStats(item, data.completionLog, todayISO, weekStartsOn);
  return streakLine(item.name, stats, unit);
}

function groupLine(label: string, stats: CategoryStats): string {
  return `${label} (${stats.habitCount}): ${stats.completionPercentage}% done. ${counts(stats)}`;
}

function singleLine(stats: SingleTaskStats): string {
  const carried = stats.carriedOver > 0 ? ` (${stats.carriedOver} carried over, ${stats.averageDaysCarried} days on average)` : "";
  return `One-off tasks: ${stats.doneThisWeek} done this week, ${stats.doneThisMonth} this month, ${stats.doneAllTime} all time; ${stats.open} open today${carried}.`;
}

/** Everything, or one category: one line per kind that has items. Pass data with one-off tasks carried over (rolloverPersistentTasks). */
export function describeGroupStats(data: AppData, todayISO: string, weekStartsOn: WeekStart, category?: { id: string; name: string }): string {
  const { habits, recurringTasks, singleTasks } = statsByKind(data, todayISO, weekStartsOn, category?.id);
  const lines = [
    ...(habits.habitCount > 0 ? [groupLine("Habits", habits)] : []),
    ...(recurringTasks.habitCount > 0 ? [groupLine("Recurring tasks", recurringTasks)] : []),
    ...(singleTasks.taskCount > 0 ? [singleLine(singleTasks)] : []),
  ];
  if (lines.length === 0) return category ? `Nothing is in ${category.name} yet.` : "There's nothing to count yet.";
  return [...(category ? [category.name] : []), ...lines].join("\n");
}
