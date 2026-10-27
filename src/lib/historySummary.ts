// §65: a dashboard-style summary of a period, for the app's chat and the Claude connector
// (get_history's result). The app's code does every sum, comparison and pick; a model only
// words it or draws it. Built on getHistory, so "done" and "missed" mean what they mean in
// history and stats.
import type { AppData, WeekStart } from "../types/models.ts";
import { addDays, startOfWeek } from "./recurrence.ts";
import { computeHabitStats } from "./habitStats.ts";
import { asTrackable } from "./taskStats.ts";
import { getHistory, historyRangeDays, type History, type HistoryItem, type HistoryItemSummary } from "./history.ts";

export interface PeriodRate {
  from: string;
  to: string;
  done: number;
  missed: number;
  /** done / (done + missed), past days and today only; undefined when nothing was due. */
  rate?: number;
}

export interface WeekTotal {
  weekOf: string; // the week's first day, by the user's week start
  done: number;
  missed: number;
}

export interface HistorySummary {
  period: PeriodRate;
  /** The same number of days just before. */
  previous: PeriodRate;
  weekly: WeekTotal[];
  highlights: {
    /** Longest current streak among the items (as of today). */
    longestStreak?: { id: string; name: string; streak: number; unit: "day" | "time" };
    /** Most missed days in the period. */
    mostMissed?: { id: string; name: string; missed: number };
    /** Biggest rise in done-rate against the previous period, 10 points or more. */
    mostImproved?: { id: string; name: string; before: number; now: number };
    /** Every due day done, at least two of them. */
    perfect: { id: string; name: string }[];
  };
}

const pct = (done: number, missed: number) => (done + missed === 0 ? undefined : Math.round((done / (done + missed)) * 100));

function periodRate(history: History): PeriodRate {
  const done = history.daily.reduce((sum, day) => sum + day.done, 0);
  const missed = history.daily.reduce((sum, day) => sum + day.missed, 0);
  return { from: history.from, to: history.to, done, missed, rate: pct(done, missed) };
}

const counted = (item: HistoryItemSummary) => item.done + item.missed;

export function summarizeHistory(
  data: AppData,
  history: History,
  weekStartsOn: WeekStart,
  items?: HistoryItem[],
): HistorySummary {
  const { from, to, today } = history;
  const length = historyRangeDays(from, to);
  const previousHistory = getHistory(data, addDays(from, -length), addDays(from, -1), today, items);

  const weeks = new Map<string, WeekTotal>();
  for (const day of history.daily) {
    if (day.date > today) continue;
    const weekOf = startOfWeek(day.date, weekStartsOn);
    const week = weeks.get(weekOf) ?? { weekOf, done: 0, missed: 0 };
    week.done += day.done;
    week.missed += day.missed;
    weeks.set(weekOf, week);
  }

  const all: HistoryItem[] = items ?? [...data.habits, ...data.recurringTasks, ...data.singleTasks];
  const inRange = new Set(history.items.map((item) => item.id));
  let longestStreak: HistorySummary["highlights"]["longestStreak"];
  for (const item of all) {
    if (item.kind === "singleTask" || !inRange.has(item.id)) continue;
    const habit = item.kind === "habit" ? item : asTrackable(item);
    const streak = computeHabitStats(habit, data.completionLog, today, weekStartsOn).currentStreak;
    if (streak > 0 && (!longestStreak || streak > longestStreak.streak)) {
      longestStreak = { id: item.id, name: item.name, streak, unit: habit.recurrence.type === "timesPerPeriod" ? "time" : "day" };
    }
  }

  const recurring = history.items.filter((item) => item.kind !== "singleTask");
  const missedMost = recurring.reduce<HistoryItemSummary | undefined>((top, item) => (item.missed > (top?.missed ?? 0) ? item : top), undefined);

  let mostImproved: HistorySummary["highlights"]["mostImproved"];
  for (const item of recurring) {
    const before = previousHistory.items.find((p) => p.id === item.id);
    const now = pct(item.done, item.missed);
    const then = before ? pct(before.done, before.missed) : undefined;
    if (now === undefined || then === undefined || now - then < 10) continue;
    if (!mostImproved || now - then > mostImproved.now - mostImproved.before) mostImproved = { id: item.id, name: item.name, before: then, now };
  }

  const perfect = recurring.filter((item) => item.missed === 0 && item.done >= 2 && counted(item) === item.done).map(({ id, name }) => ({ id, name }));

  return {
    period: periodRate(history),
    previous: periodRate(previousHistory),
    weekly: [...weeks.values()],
    highlights: {
      ...(longestStreak ? { longestStreak } : {}),
      ...(missedMost ? { mostMissed: { id: missedMost.id, name: missedMost.name, missed: missedMost.missed } } : {}),
      ...(mostImproved ? { mostImproved } : {}),
      perfect,
    },
  };
}
