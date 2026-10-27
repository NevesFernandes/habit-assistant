// §73: "what did I miss?": only the misses of a period, read from §66's history, for the
// app's chat and the Claude connector alike. Read-only by design (users never manage the
// past): what it offers instead is a look forward, a nudge to change or pause an item missed
// a lot, or to re-date a task carried over for a week or more. Pure: no Drive, no clock.
import type { AppData, WeekStart } from "../types/models.ts";
import { addDays, daysBetween, startOfMonth, startOfWeek } from "./recurrence.ts";
import { getHistory, type HistoryPeriod } from "./history.ts";
import { shortDate } from "./historyReply.ts";

/** A habit or task missed at least this many times, and on at least half its due days, gets a nudge. */
export const NUDGE_MIN_MISSED = 3;
/** A one-off task carried over this many days or more gets a nudge. */
export const NUDGE_CARRIED_DAYS = 7;

export interface MissedItem {
  id: string;
  name: string;
  kind: "habit" | "recurringTask" | "singleTask";
  missed: number;
  /** Due days that are over (done + missed). */
  due: number;
  /** The missed days, oldest first; empty when the history left the days out (a long period). */
  dates: string[];
  /** "N times a week/month" habits: each finished period short of its target. */
  periods?: (HistoryPeriod & { period: "week" | "month" })[];
}

export interface CarriedTask {
  id: string;
  name: string;
  /** The day it was first due. */
  since: string;
  days: number;
}

export type Nudge = { kind: "missedOften"; id: string; name: string; missed: number; due: number } | { kind: "carriedLong"; id: string; name: string; days: number };

export interface Missed {
  from: string;
  to: string;
  /** Set when the user named no period: which one was used. */
  assumed?: "thisWeek" | "lastWeek";
  /** Missed days plus short periods, across every item. */
  total: number;
  items: MissedItem[];
  /** One-off tasks still not done that were first due on or before the period's end. */
  carried: CarriedTask[];
  nudges: Nudge[];
}

/**
 * The period when none is named: this week so far, up to yesterday (today isn't over, so
 * nothing in it is missed yet). On the week's first day that's empty, so last week.
 */
export function defaultMissedPeriod(today: string, weekStartsOn: WeekStart): { from: string; to: string; assumed: "thisWeek" | "lastWeek" } {
  const weekStart = startOfWeek(today, weekStartsOn);
  const yesterday = addDays(today, -1);
  if (weekStart <= yesterday) return { from: weekStart, to: yesterday, assumed: "thisWeek" };
  return { from: addDays(weekStart, -7), to: yesterday, assumed: "lastWeek" };
}

function periodEnd(start: string, period: "week" | "month"): string {
  return period === "week" ? addDays(start, 6) : addDays(startOfMonth(addDays(start, 31)), -1);
}

/**
 * The misses from `from` to `to` (the caller keeps `to` before today). Pass `data` as the
 * app shows it, unfinished one-off tasks already carried over to today.
 */
export function getMissed(data: AppData, from: string, to: string, today: string, assumed?: Missed["assumed"]): Missed {
  const history = getHistory(data, from, to, today);
  const items = history.items.flatMap((summary): MissedItem[] => {
    const habit = summary.kind === "habit" ? data.habits.find((h) => h.id === summary.id) : undefined;
    if (habit?.recurrence.type === "timesPerPeriod") {
      const period = habit.recurrence.period;
      // Only a period that's over can fall short; this week's is still going.
      const short = (summary.periods ?? []).filter((p) => periodEnd(p.start, period) < today && p.done < p.target).map((p) => ({ ...p, period }));
      return short.length ? [{ id: summary.id, name: summary.name, kind: summary.kind, missed: short.length, due: summary.periods?.length ?? 0, dates: [], periods: short }] : [];
    }
    if (summary.missed === 0) return [];
    const dates = (history.days ?? []).flatMap((day) => (day.items.some((item) => item.id === summary.id && item.status === "missed") ? [day.date] : []));
    return [{ id: summary.id, name: summary.name, kind: summary.kind, missed: summary.missed, due: summary.done + summary.missed, dates }];
  });
  // Most missed first; equal ones keep the day's order (history's).
  items.sort((a, b) => b.missed - a.missed);

  const carried = data.singleTasks
    .filter((task) => !task.done && (task.originalStartDate ?? task.startDate) < today && (task.originalStartDate ?? task.startDate) <= to)
    .map((task) => {
      const since = task.originalStartDate ?? task.startDate;
      return { id: task.id, name: task.name, since, days: daysBetween(since, today) };
    })
    .sort((a, b) => b.days - a.days);

  const nudges: Nudge[] = [
    ...items
      .filter((item) => !item.periods && item.missed >= NUDGE_MIN_MISSED && item.missed * 2 >= item.due)
      .map((item) => ({ kind: "missedOften" as const, id: item.id, name: item.name, missed: item.missed, due: item.due })),
    ...carried.filter((task) => task.days >= NUDGE_CARRIED_DAYS).map((task) => ({ kind: "carriedLong" as const, id: task.id, name: task.name, days: task.days })),
  ].slice(0, 2);

  return { from, to, ...(assumed ? { assumed } : {}), total: items.reduce((sum, item) => sum + item.missed, 0), items, carried, nudges };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function rangeOf(from: string, to: string, today: string): string {
  return from === to ? shortDate(from, today) : `${shortDate(from, today)} to ${shortDate(to, today)}`;
}

/** The period line, saying so when it was assumed. */
export function describeMissedPeriod(missed: Pick<Missed, "from" | "to" | "assumed">, today: string): string {
  const range = rangeOf(missed.from, missed.to, today);
  if (missed.assumed === "thisWeek") return `This week so far (${range}). You didn't name a period, so I used this week up to yesterday; today isn't over yet.`;
  if (missed.assumed === "lastWeek") return `Last week (${range}). You didn't name a period, and this week only started today, so I used last week.`;
  return range;
}

function itemLine(item: MissedItem, today: string): string {
  if (item.periods) {
    return `• ${item.name}: ${item.periods
      .map((p) => `${p.done} of ${p.target} ${p.period === "week" ? `in the week of ${shortDate(p.start, today).slice(4)}` : `in ${shortDate(p.start, today).slice(-3)}`}`)
      .join(", ")}`;
  }
  const when = item.dates.length && item.dates.length <= 4 ? item.dates.map((date) => shortDate(date, today)).join(", ") : plural(item.missed, "day");
  return `• ${item.name}: missed ${when} (${item.missed} of ${item.due})`;
}

/** A nudge as a question, for the app's reply and the connector's result. */
export function describeNudge(nudge: Nudge): string {
  return nudge.kind === "missedOften"
    ? `"${nudge.name}" was missed ${nudge.missed} of ${nudge.due} times. Want to change its days, or pause it for a while?`
    : `"${nudge.name}" has been carried over for ${nudge.days} days. Want to give it a new date, or drop it?`;
}

/** The app's reply. */
export function describeMissed(missed: Missed, today: string): string {
  const lines = [describeMissedPeriod(missed, today)];
  const count = missed.items.length;
  lines.push(count === 0 ? "Nothing missed." : `${missed.total} ${missed.total === 1 ? "miss" : "misses"} across ${plural(count, "item")}:`);
  lines.push(...missed.items.map((item) => itemLine(item, today)));
  if (missed.carried.length) {
    lines.push("Carried over, still not done:");
    lines.push(...missed.carried.map((task) => `• ${task.name}: first due ${shortDate(task.since, today)}, carried ${plural(task.days, "day")}`));
  }
  if (missed.nudges.length) lines.push("", ...missed.nudges.map(describeNudge));
  return lines.join("\n");
}
