// Recurrence evaluation for Habits (and, later, Recurring Tasks — same
// RecurrenceRule shape). Pure date-string arithmetic, no date library: the
// project has none, and ISO ("YYYY-MM-DD") strings compare/sort lexically
// so most of this doesn't need a Date object at all.
import type { CompletionLogEntry, Habit, RecurrenceRule } from "../types/models";

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

export function startOfYear(dateISO: string): string {
  return `${dateISO.slice(0, 4)}-01-01`;
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

const NTH_TO_COUNT: Record<"first" | "second" | "third" | "fourth" | "fifth", number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
};

/** nth = "first".."fifth" counts occurrences of `weekday` from day 1 of the
 * month containing `dateISO`; "last" finds the final matching weekday in
 * that month instead. Returns the resolved ISO date within that month, which
 * may or may not equal `dateISO` — occursOn compares the two. */
function nthWeekdayOfMonthDate(
  dateISO: string,
  nth: "first" | "second" | "third" | "fourth" | "fifth" | "last",
  weekday: number,
): string {
  const monthStart = startOfMonth(dateISO);
  if (nth === "last") {
    const nextMonthStart = addMonthsISO(monthStart, 1);
    let cursor = addDays(nextMonthStart, -1);
    while (dayOfWeek(cursor) !== weekday) cursor = addDays(cursor, -1);
    return cursor;
  }

  const targetCount = NTH_TO_COUNT[nth];
  let cursor = monthStart;
  let count = 0;
  while (true) {
    if (dayOfWeek(cursor) === weekday) {
      count += 1;
      if (count === targetCount) return cursor;
    }
    cursor = addDays(cursor, 1);
  }
}

function addMonthsISO(dateISO: string, months: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
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
    case "nthWeekdayOfMonth":
      // If the nth occurrence doesn't exist in a given month (e.g. a 5th
      // Monday), it simply doesn't occur that month — no fallback to the 4th.
      return nthWeekdayOfMonthDate(dateISO, habit.recurrence.nth, habit.recurrence.weekday) === dateISO;
    case "specificDatesOfYear":
      return habit.recurrence.dates.includes(dateISO.slice(5));
    case "onOffCycle": {
      const total = habit.recurrence.onDays + habit.recurrence.offDays;
      if (total <= 0) return true;
      const pos = ((daysBetween(habit.startDate, dateISO) % total) + total) % total;
      return pos < habit.recurrence.onDays;
    }
  }
}

export function getHabitsForDate(habits: Habit[], dateISO: string): Habit[] {
  return habits
    .filter((habit) => occursOn(habit, dateISO))
    .slice()
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isArchived(item: { endDate?: string }): boolean {
  return !!item.endDate && item.endDate <= todayISO();
}

const WEEKDAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function describeMonthDay(monthDay: string): string {
  const [month, day] = monthDay.split("-").map(Number);
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}`;
}

export function describeRecurrence(rule: RecurrenceRule): string {
  switch (rule.type) {
    case "daily":
      return "Every day";
    case "daysOfWeek":
      return rule.days.length === 0
        ? "No days selected"
        : `Every ${[...rule.days].sort((a, b) => a - b).map((d) => WEEKDAY_ABBREVIATIONS[d]).join(", ")}`;
    case "intervalDays":
      return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;
    case "timesPerPeriod":
      return `${rule.count}x per ${rule.period}`;
    case "nthWeekdayOfMonth":
      return `Every ${rule.nth} ${WEEKDAY_NAMES[rule.weekday]}`;
    case "specificDatesOfYear":
      return rule.dates.length === 0
        ? "No dates selected"
        : `Every ${[...rule.dates].sort().map(describeMonthDay).join(", ")}`;
    case "onOffCycle":
      return `${rule.onDays} day${rule.onDays === 1 ? "" : "s"} on, ${rule.offDays} day${rule.offDays === 1 ? "" : "s"} off`;
  }
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
