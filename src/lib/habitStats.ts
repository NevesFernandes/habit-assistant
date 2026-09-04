import type { ChecklistItem, CompletionLogEntry, Habit } from "../types/models";
import { addDays, completionsInPeriod, occursOn, startOfMonth, startOfWeek, startOfYear } from "./recurrence";

export interface HabitStats {
  currentStreak: number;
  bestStreak: number;
  completionPercentage: number; // 0-100, rounded
  completionsThisWeek: number;
  completionsThisMonth: number;
  completionsThisYear: number;
  completionsAllTime: number;
}

// A logged entry alone means "complete" for yesno habits. A value/timer habit only counts
// once its logged value meets its target — a partial log (e.g. 6 of 8 glasses) is progress,
// not completion, and a habit with no target set (see §25 in Roadmap.md — target is mandatory
// for value/timer habits going forward) can never read as complete. Checklist habits follow
// the same target-style logic: complete only once every item in that date's snapshot is
// checked — a partial checklist is progress (see checklistProgress), not completion, same as
// an under-target numeric log.
export function isHabitEntryComplete(habit: Habit, entry: CompletionLogEntry | undefined): boolean {
  if (!entry) return false;
  if (habit.completionType === "value" || habit.completionType === "timer") {
    return habit.target !== undefined && (entry.value ?? 0) >= habit.target;
  }
  if (habit.completionType === "checklist") {
    const items = entry.checklist ?? [];
    return items.length > 0 && items.every((item) => item.checked);
  }
  return true;
}

// "N of M items checked" for a checklist habit's given date. Falls back to the habit's
// template item set (all unchecked) when that date has no logged entry yet, so a
// never-touched occurrence reads as "0/<item count>" rather than "0/0".
export function checklistProgress(habit: Habit, entry: CompletionLogEntry | undefined): { checked: number; total: number } {
  const items = entry?.checklist ?? habit.checklist ?? [];
  return { checked: items.filter((item) => item.checked).length, total: items.length };
}

// The full per-item state to render for a checklist habit on a given date: the logged
// entry's snapshot if one exists, else the template mapped to all-unchecked (matching
// what a freshly created entry for that date would contain).
export function checklistItemsForEntry(habit: Habit, entry: CompletionLogEntry | undefined): ChecklistItem[] {
  return entry?.checklist ?? (habit.checklist ?? []).map((item) => ({ ...item, checked: false }));
}

function isCompletedOn(habit: Habit, completionLog: CompletionLogEntry[], dateISO: string): boolean {
  const entry = completionLog.find((e) => e.itemId === habit.id && e.date === dateISO);
  return isHabitEntryComplete(habit, entry);
}

// daily / daysOfWeek / intervalDays: only the habit's own scheduled days can break or
// extend the streak (1 scheduled+completed day = 1 completion, so day count == completion
// count for these types). "Today" gets a one-time grace if due but not yet completed, so an
// unfinished today doesn't look like a broken streak before the day is even over.
function dayBasedStats(habit: Habit, completionLog: CompletionLogEntry[], todayISO: string) {
  let currentStreak = 0;
  let cursor = todayISO;
  let gaveGrace = false;
  while (cursor >= habit.startDate) {
    if (occursOn(habit, cursor)) {
      if (isCompletedOn(habit, completionLog, cursor)) {
        currentStreak += 1;
      } else if (cursor === todayISO && !gaveGrace) {
        gaveGrace = true;
      } else {
        break;
      }
    }
    cursor = addDays(cursor, -1);
  }

  let bestStreak = 0;
  let run = 0;
  let d = habit.startDate;
  while (d <= todayISO) {
    if (occursOn(habit, d)) {
      if (isCompletedOn(habit, completionLog, d)) {
        run += 1;
        bestStreak = Math.max(bestStreak, run);
      } else {
        run = 0;
      }
    }
    d = addDays(d, 1);
  }

  const { launched, completed } = dayOccurrenceCounts(habit, completionLog, todayISO);
  return {
    currentStreak,
    bestStreak,
    completionPercentage: launched === 0 ? 0 : Math.round((completed / launched) * 100),
  };
}

// Raw scheduled/completed day counts for daily/daysOfWeek/intervalDays habits — the same
// counting dayBasedStats uses for its own completionPercentage, exposed separately so
// category-level aggregation (aggregateCategoryStats) can sum raw counts across habits of
// different recurrence types before computing one overall percentage.
function dayOccurrenceCounts(
  habit: Habit,
  completionLog: CompletionLogEntry[],
  todayISO: string,
): { launched: number; completed: number } {
  let launched = 0;
  let completed = 0;
  let d = habit.startDate;
  while (d <= todayISO) {
    if (occursOn(habit, d)) {
      launched += 1;
      if (isCompletedOn(habit, completionLog, d)) completed += 1;
    }
    d = addDays(d, 1);
  }
  return { launched, completed };
}

function addMonths(dateISO: string, months: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function completionsInFullPeriod(
  habit: Habit,
  completionLog: CompletionLogEntry[],
  periodStartISO: string,
  period: "week" | "month",
): number {
  const periodEnd = period === "week" ? addDays(periodStartISO, 7) : addMonths(periodStartISO, 1);
  return completionLog.filter(
    (e) => e.itemId === habit.id && e.date >= periodStartISO && e.date < periodEnd && isHabitEntryComplete(habit, e),
  ).length;
}

// timesPerPeriod: no single day is "the due day", so the streak only breaks when a full
// period elapses without meeting its target — skipping days within an already-met period
// doesn't break it. Streak counts total completions across consecutive met periods, not
// the number of periods, since streak counts completions, not periods.
function periodBasedStats(
  habit: Habit & { recurrence: Extract<Habit["recurrence"], { type: "timesPerPeriod" }> },
  completionLog: CompletionLogEntry[],
  todayISO: string,
) {
  const { period, count: target } = habit.recurrence;
  const step = (p: string, n: number) => (period === "week" ? addDays(p, 7 * n) : addMonths(p, n));
  const periodStart = (dateISO: string) => (period === "week" ? startOfWeek(dateISO) : startOfMonth(dateISO));
  const startPeriod = periodStart(habit.startDate);
  const currentPeriod = periodStart(todayISO);

  let currentStreak = 0;
  let cursor = currentPeriod;
  let gaveGrace = false;
  while (cursor >= startPeriod) {
    const hits = completionsInFullPeriod(habit, completionLog, cursor, period);
    if (hits >= target) {
      currentStreak += hits;
    } else if (cursor === currentPeriod && !gaveGrace) {
      gaveGrace = true;
    } else {
      break;
    }
    cursor = step(cursor, -1);
  }

  let bestStreak = 0;
  let run = 0;
  let totalPeriods = 0;
  let hitPeriods = 0;
  let p = startPeriod;
  while (p <= currentPeriod) {
    const hits = completionsInFullPeriod(habit, completionLog, p, period);
    totalPeriods += 1;
    if (hits >= target) {
      run += hits;
      hitPeriods += 1;
      bestStreak = Math.max(bestStreak, run);
    } else {
      run = 0;
    }
    p = step(p, 1);
  }

  return {
    currentStreak,
    bestStreak,
    completionPercentage: totalPeriods === 0 ? 0 : Math.round((hitPeriods / totalPeriods) * 100),
  };
}

export function computeHabitStats(habit: Habit, completionLog: CompletionLogEntry[], todayISO: string): HabitStats {
  const core =
    habit.recurrence.type === "timesPerPeriod"
      ? periodBasedStats(
          habit as Habit & { recurrence: Extract<Habit["recurrence"], { type: "timesPerPeriod" }> },
          completionLog,
          todayISO,
        )
      : dayBasedStats(habit, completionLog, todayISO);

  const habitCompletions = completionLog.filter((e) => e.itemId === habit.id);
  return {
    ...core,
    completionsThisWeek: completionsInPeriod(completionLog, habit.id, todayISO, "week"),
    completionsThisMonth: completionsInPeriod(completionLog, habit.id, todayISO, "month"),
    completionsThisYear: habitCompletions.filter((e) => e.date >= startOfYear(todayISO)).length,
    completionsAllTime: habitCompletions.length,
  };
}

// timesPerPeriod has no single due day (every day is eligible), so unlike day-based habits
// there's no natural "scheduled day" to count. For category-level aggregation, each elapsed
// period "launches" `count` occurrences (target x periods elapsed) — a separate calculation
// from periodBasedStats's own period-hit-rate completionPercentage above, which is untouched.
function periodOccurrenceCounts(
  habit: Habit & { recurrence: Extract<Habit["recurrence"], { type: "timesPerPeriod" }> },
  completionLog: CompletionLogEntry[],
  todayISO: string,
): { launched: number; completed: number } {
  const { period, count: target } = habit.recurrence;
  const periodStart = (dateISO: string) => (period === "week" ? startOfWeek(dateISO) : startOfMonth(dateISO));
  const step = (p: string) => (period === "week" ? addDays(p, 7) : addMonths(p, 1));
  const startPeriod = periodStart(habit.startDate);
  const currentPeriod = periodStart(todayISO);

  let periodsElapsed = 0;
  for (let p = startPeriod; p <= currentPeriod; p = step(p)) periodsElapsed += 1;

  const completed = completionLog.filter(
    (e) => e.itemId === habit.id && e.date >= startPeriod && e.date <= todayISO && isHabitEntryComplete(habit, e),
  ).length;

  return { launched: periodsElapsed * target, completed };
}

function habitOccurrenceCounts(
  habit: Habit,
  completionLog: CompletionLogEntry[],
  todayISO: string,
): { launched: number; completed: number } {
  return habit.recurrence.type === "timesPerPeriod"
    ? periodOccurrenceCounts(
        habit as Habit & { recurrence: Extract<Habit["recurrence"], { type: "timesPerPeriod" }> },
        completionLog,
        todayISO,
      )
    : dayOccurrenceCounts(habit, completionLog, todayISO);
}

export interface CategoryStats {
  completionPercentage: number; // sum(completed) / sum(launched) across the habits; 0 if no habits or nothing launched
  completionsThisWeek: number;
  completionsThisMonth: number;
  completionsThisYear: number;
  completionsAllTime: number;
  habitCount: number;
}

export function aggregateCategoryStats(
  habits: Habit[],
  completionLog: CompletionLogEntry[],
  todayISO: string,
): CategoryStats {
  if (habits.length === 0) {
    return {
      completionPercentage: 0,
      completionsThisWeek: 0,
      completionsThisMonth: 0,
      completionsThisYear: 0,
      completionsAllTime: 0,
      habitCount: 0,
    };
  }

  let totalLaunched = 0;
  let totalCompleted = 0;
  for (const habit of habits) {
    const { launched, completed } = habitOccurrenceCounts(habit, completionLog, todayISO);
    totalLaunched += launched;
    totalCompleted += completed;
  }

  const perHabitWindowCounts = habits.map((habit) => computeHabitStats(habit, completionLog, todayISO));
  return {
    completionPercentage: totalLaunched === 0 ? 0 : Math.round((totalCompleted / totalLaunched) * 100),
    completionsThisWeek: perHabitWindowCounts.reduce((sum, s) => sum + s.completionsThisWeek, 0),
    completionsThisMonth: perHabitWindowCounts.reduce((sum, s) => sum + s.completionsThisMonth, 0),
    completionsThisYear: perHabitWindowCounts.reduce((sum, s) => sum + s.completionsThisYear, 0),
    completionsAllTime: perHabitWindowCounts.reduce((sum, s) => sum + s.completionsAllTime, 0),
    habitCount: habits.length,
  };
}
