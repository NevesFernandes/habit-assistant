// Plain assert-based regression check for recurrenceSpec.ts — this repo has
// no test framework, and this function is a pure string -> result mapping
// with zero async/env dependency, so a no-dependency script (run directly by
// Node's native TS support) is enough. Run: node src/server/recurrenceSpec.test.ts
import assert from "node:assert/strict";
import { parseCompactRecurrence, RECURRENCE_SPEC_GRAMMAR } from "./recurrenceSpec.ts";
import type { RecurrenceRule } from "../types/models.ts";

type OkCase = [raw: string, expected: RecurrenceRule];

const okCases: OkCase[] = [
  ["daily", { type: "daily" }],
  ["days:mon,wed,fri", { type: "daysOfWeek", days: [1, 3, 5] }],
  ["days:sat,sun", { type: "daysOfWeek", days: [6, 0] }],
  ["every:3", { type: "intervalDays", interval: 3 }],
  ["times:3/week", { type: "timesPerPeriod", period: "week", count: 3 }],
  ["times:2/month", { type: "timesPerPeriod", period: "month", count: 2 }],
  ["nth:third:mon", { type: "nthWeekdayOfMonth", nth: "third", weekday: 1 }],
  ["nth:last:fri", { type: "nthWeekdayOfMonth", nth: "last", weekday: 5 }],
  ["dates:03-15,12-25", { type: "specificDatesOfYear", dates: ["03-15", "12-25"] }],
  ["cycle:5on2off", { type: "onOffCycle", onDays: 5, offDays: 2 }],
  // whitespace/casing tolerance
  ["Days: Mon , Wed", { type: "daysOfWeek", days: [1, 3] }],
  ["  DAILY  ", { type: "daily" }],
];

const failCases: string[] = [
  "",
  "   ",
  "not-a-real-spec",
  "days:mon,xyz",
  "days:",
  "every:0",
  "every:-1",
  "every:abc",
  "times:0/week",
  "times:3/fortnight",
  "nth:third",
  "nth:zeroth:mon",
  "nth:third:zzz",
  "dates:02-30-2026",
  "dates:13-01",
  "dates:00-15",
  "cycle:5on",
  "cycle:0on2off",
  "cycle:5onoff",
];

let failures = 0;

for (const [raw, expected] of okCases) {
  const result = parseCompactRecurrence(raw);
  try {
    assert.equal(result.ok, true, `expected ok for "${raw}"`);
    assert.deepEqual(result.ok ? result.rule : undefined, expected);
    console.log(`ok   parse "${raw}"`);
  } catch (err) {
    failures++;
    console.error(`FAIL parse "${raw}"\n  ${err instanceof Error ? err.message : err}`);
  }
}

for (const raw of failCases) {
  const result = parseCompactRecurrence(raw);
  try {
    assert.equal(result.ok, false, `expected failure for "${raw}"`);
    assert.ok(!result.ok && result.error.length > 0, `expected non-empty error for "${raw}"`);
    console.log(`ok   reject "${raw}"`);
  } catch (err) {
    failures++;
    console.error(`FAIL reject "${raw}"\n  ${err instanceof Error ? err.message : err}`);
  }
}

// The grammar text is embedded verbatim in the tool schema/system prompt —
// just confirm it exists and mentions every tag the parser recognizes, so the
// two can't silently drift apart.
for (const tag of ["daily", "days:", "every:", "times:", "nth:", "dates:", "cycle:"]) {
  try {
    assert.ok(RECURRENCE_SPEC_GRAMMAR.includes(tag), `grammar text missing "${tag}"`);
    console.log(`ok   grammar mentions "${tag}"`);
  } catch (err) {
    failures++;
    console.error(`FAIL grammar\n  ${err instanceof Error ? err.message : err}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll cases passed.`);
