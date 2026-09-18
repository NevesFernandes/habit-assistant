// Small readable checks for scenario `data` expectations — each returns true
// or a description of what's wrong, which the runner prints on failure.
import type { AppData, Habit, RecurrenceRule } from "../../../src/types/models.ts";
import { resolveWeekdayDate } from "../../../src/lib/recurrence.ts";

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The date "next <weekday>" resolves to from the real today — same rule the app uses. */
export function nextWeekday(weekday: number): string {
  return resolveWeekdayDate(todayISO(), weekday, "next");
}

export function habitById(data: AppData, id: string): Habit | undefined {
  return data.habits.find((habit) => habit.id === id);
}

export function habitsNamed(data: AppData, name: string): Habit[] {
  return data.habits.filter((habit) => habit.name.toLowerCase() === name.toLowerCase());
}

export function describeRule(rule: RecurrenceRule): string {
  return JSON.stringify(rule);
}

export function isWeekdays(rule: RecurrenceRule, days: number[]): boolean {
  if (rule.type !== "daysOfWeek") return false;
  return [...rule.days].sort().join(",") === [...days].sort().join(",");
}

/** Runs every check in order and returns the first failure, or true. */
export function all(...checks: (true | string)[]): true | string {
  return checks.find((check) => check !== true) ?? true;
}

export function check(condition: boolean, failure: string): true | string {
  return condition ? true : failure;
}
