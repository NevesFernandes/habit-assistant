// Recurrence evaluation for Habits (and, later, Recurring Tasks — same
// RecurrenceRule shape). Pure date-string arithmetic, no date library: the
// project has none, and ISO ("YYYY-MM-DD") strings compare/sort lexically
// so most of this doesn't need a Date object at all.
import type { CompletionLogEntry, Habit } from "../types/models";

function parseISODate(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateISO: string, days: number): string {
  const date = parseISODate(dateISO);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

function daysBetween(fromISO: string, toISO: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / msPerDay);
}

/** 0 = Sunday .. 6 = Saturday, matching RecurrenceRule's daysOfWeek convention. */
export function dayOfWeek(dateISO: string): number {
  return parseISODate(dateISO).getUTCDay();
}

export function startOfWeek(dateISO: string): string {
  return addDays(dateISO, -dayOfWeek(dateISO));
}

export function startOfMonth(dateISO: string): string {
  const [year, month] = dateISO.split("-");
  return `${year}-${month}-01`;
}

/**
 * Resolves "(next) <weekday>" phrasing to an exact date, deterministically —
 * small free LLM tiers are unreliable at this specific kind of day-counting
 * arithmetic even when given today's date, so this is done in code instead
 * of trusted to the model (see handleAgentRequest.ts's system prompt).
 *
 * "closest": nearest occurrence of `weekday` on or after `todayISO` (today
 * counts if it matches). "next": strictly after today, skipping today even
 * if it matches — so "next Tuesday" said on a Tuesday is 7 days out.
 */
export function resolveWeekdayDate(
  todayISO: string,
  weekday: number,
  mode: "closest" | "next" = "closest",
): string {
  const todayWeekday = dayOfWeek(todayISO);
  const offset =
    mode === "next"
      ? ((weekday - todayWeekday - 1 + 7) % 7) + 1 // 1..7, always strictly after today
      : (weekday - todayWeekday + 7) % 7; // 0..6, today counts if it matches
  return addDays(todayISO, offset);
}

export function occursOn(habit: Habit, dateISO: string): boolean {
  if (dateISO < habit.startDate) return false;
  if (habit.endDate && dateISO > habit.endDate) return false;

  switch (habit.recurrence.type) {
    case "daily":
      return true;
    case "daysOfWeek":
      return habit.recurrence.days.includes(dayOfWeek(dateISO));
    case "intervalDays":
      return daysBetween(habit.startDate, dateISO) % habit.recurrence.interval === 0;
    case "timesPerPeriod":
      // Flexible/unpinned to specific days — eligible every day in bounds;
      // progress toward the period's target is tracked via completionsInPeriod.
      return true;
  }
}

export function getHabitsForDate(habits: Habit[], dateISO: string): Habit[] {
  return habits
    .filter((habit) => occursOn(habit, dateISO))
    .slice()
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function completionsInPeriod(
  completionLog: CompletionLogEntry[],
  itemId: string,
  dateISO: string,
  period: "week" | "month",
): number {
  const periodStart = period === "week" ? startOfWeek(dateISO) : startOfMonth(dateISO);
  return completionLog.filter(
    (entry) => entry.itemId === itemId && entry.date >= periodStart && entry.date <= dateISO,
  ).length;
}
