import type { CompletionLogEntry, Habit } from "../types/models";
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

function isCompletedOn(completionLog: CompletionLogEntry[], habitId: string, dateISO: string): boolean {
  return completionLog.some((entry) => entry.itemId === habitId && entry.date === dateISO);
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
      if (isCompletedOn(completionLog, habit.id, cursor)) {
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
  let scheduled = 0;
  let completed = 0;
  let d = habit.startDate;
  while (d <= todayISO) {
    if (occursOn(habit, d)) {
      scheduled += 1;
      if (isCompletedOn(completionLog, habit.id, d)) {
        completed += 1;
        run += 1;
        bestStreak = Math.max(bestStreak, run);
      } else {
        run = 0;
      }
    }
    d = addDays(d, 1);
  }

  return {
    currentStreak,
    bestStreak,
    completionPercentage: scheduled === 0 ? 0 : Math.round((completed / scheduled) * 100),
  };
}

function addMonths(dateISO: string, months: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function completionsInFullPeriod(
  completionLog: CompletionLogEntry[],
  habitId: string,
  periodStartISO: string,
  period: "week" | "month",
): number {
  const periodEnd = period === "week" ? addDays(periodStartISO, 7) : addMonths(periodStartISO, 1);
  return completionLog.filter((e) => e.itemId === habitId && e.date >= periodStartISO && e.date < periodEnd)
    .length;
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
    const hits = completionsInFullPeriod(completionLog, habit.id, cursor, period);
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
    const hits = completionsInFullPeriod(completionLog, habit.id, p, period);
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
