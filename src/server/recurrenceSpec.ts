// Compact wire format for RecurrenceRule, used by createHabit/createRecurringTask's
// `recurrence` field and updateHabit/updateRecurringTask's `newRecurrence` field.
// Replaces what used to be ~8 separate top-level tool parameters (repeated across
// 4 tools) with one string, to shrink the agent's tool-schema payload — see the
// "Cost model / provider strategy" section of CLAUDE.md for why payload size
// matters here. RECURRENCE_SPEC_GRAMMAR is the single source of truth for the
// model-facing description, embedded into both the tool schema and the system
// prompt, and reused by this file's own test as living documentation.
import type { RecurrenceRule } from "../types/models.ts";

export type RecurrenceSpecResult = { ok: true; rule: RecurrenceRule } | { ok: false; error: string };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "last"] as const;

export const RECURRENCE_SPEC_GRAMMAR = `How often this repeats, as a single compact string:
- "daily" — ONLY when the user says "every day"/"daily" and names no specific weekdays. If the user lists two or more specific weekdays (e.g. "Tuesday, Thursday, Saturday and Sunday"), that is ALWAYS "days:<list>", never "daily" — even when the list covers most or all of the week. Never collapse or round a named list of weekdays to "daily".
- "days:<list>" — specific weekdays, comma-separated from sun,mon,tue,wed,thu,fri,sat, one entry per weekday the user named, in any order (e.g. "days:mon,wed,fri"; "days:sat,sun" for weekends; "days:tue,thu,sat,sun" for "Tuesday, Thursday, Saturday and Sunday")
- "every:<N>" — every N days (e.g. "every:3")
- "times:<N>/<period>" — N times per week or month, not pinned to specific days; period is "week" or "month" (e.g. "times:3/week")
- "nth:<ordinal>:<weekday>" — the ordinal occurrence of a weekday each month; ordinal is first, second, third, fourth, fifth, or last (e.g. "nth:third:mon", "nth:last:fri")
- "dates:<list>" — annual dates, comma-separated "MM-DD" (no year), for things like a birthday or anniversary (e.g. "dates:03-15,12-25")
- "cycle:<N>on<M>off" — N consecutive days on, then M consecutive days off, repeating (e.g. "cycle:5on2off")`;

function weekdayIndex(token: string): number | undefined {
  const index = (WEEKDAYS as readonly string[]).indexOf(token);
  return index === -1 ? undefined : index;
}

// Tolerates stray whitespace/casing the model might add — this is exactly the
// kind of formatting slop a one-field-per-concept JSON Schema didn't have to
// worry about, since those fields had enums to nudge exact values.
export function parseCompactRecurrence(raw: string | undefined): RecurrenceSpecResult {
  if (!raw || !raw.trim()) return { ok: false, error: "missing recurrence spec" };
  const spec = raw.trim().toLowerCase().replace(/\s+/g, "");

  if (spec === "daily") return { ok: true, rule: { type: "daily" } };

  const days = spec.match(/^days:([a-z,]+)$/);
  if (days) {
    const tokens = days[1].split(",").filter(Boolean);
    const indices = tokens.map(weekdayIndex);
    if (tokens.length === 0 || indices.some((day) => day === undefined)) {
      return { ok: false, error: `invalid weekday in "${raw}"` };
    }
    return { ok: true, rule: { type: "daysOfWeek", days: [...new Set(indices as number[])] } };
  }

  const every = spec.match(/^every:(\d+)$/);
  if (every) {
    const interval = Number(every[1]);
    if (interval < 1) return { ok: false, error: `interval must be >= 1 in "${raw}"` };
    return { ok: true, rule: { type: "intervalDays", interval } };
  }

  const times = spec.match(/^times:(\d+)\/(week|month)$/);
  if (times) {
    const count = Number(times[1]);
    if (count < 1) return { ok: false, error: `count must be >= 1 in "${raw}"` };
    return { ok: true, rule: { type: "timesPerPeriod", period: times[2] as "week" | "month", count } };
  }

  const nth = spec.match(/^nth:([a-z]+):([a-z]{3})$/);
  if (nth) {
    const weekday = weekdayIndex(nth[2]);
    if (!(ORDINALS as readonly string[]).includes(nth[1]) || weekday === undefined) {
      return { ok: false, error: `invalid ordinal/weekday in "${raw}"` };
    }
    return { ok: true, rule: { type: "nthWeekdayOfMonth", nth: nth[1] as (typeof ORDINALS)[number], weekday } };
  }

  const dates = spec.match(/^dates:([\d,-]+)$/);
  if (dates) {
    const list = dates[1].split(",").filter(Boolean);
    const validFormat = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (list.length === 0 || list.some((date) => !validFormat.test(date))) {
      return { ok: false, error: `invalid date(s) in "${raw}", expected MM-DD` };
    }
    return { ok: true, rule: { type: "specificDatesOfYear", dates: list } };
  }

  const cycle = spec.match(/^cycle:(\d+)on(\d+)off$/);
  if (cycle) {
    const onDays = Number(cycle[1]);
    const offDays = Number(cycle[2]);
    if (onDays < 1 || offDays < 0) return { ok: false, error: `invalid on/off days in "${raw}"` };
    return { ok: true, rule: { type: "onOffCycle", onDays, offDays } };
  }

  return { ok: false, error: `unrecognized recurrence spec "${raw}"` };
}
