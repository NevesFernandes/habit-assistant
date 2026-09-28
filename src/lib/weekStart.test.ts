// §43 in Roadmap.md: the user's first day of the week (Sunday or Monday) — where weeks
// begin for "N times per week", the week stats and the heatmap's columns. Weekday numbers
// themselves stay 0 = Sunday. Plain-assert style, run under tsx.
// Run: npm run test:weekStart
import assert from "node:assert/strict";
import { completionsInPeriod, dayOfWeek, startOfWeek } from "./recurrence.ts";
import { computeHabitStats, heatmapRowLabels, heatmapWeeks } from "./habitStats.ts";
import { weekStartOf, type CompletionLogEntry, type Habit } from "../types/models.ts";

// Absent means Sunday, so existing Drive files keep today's behaviour.
assert.equal(weekStartOf({}), 0);
assert.equal(weekStartOf({ weekStartsOn: 1 }), 1);

// startOfWeek around the Sunday/Monday boundary.
assert.equal(dayOfWeek("2026-09-27"), 0, "fixture: 2026-09-27 is a Sunday");
assert.equal(startOfWeek("2026-09-27", 0), "2026-09-27");
assert.equal(startOfWeek("2026-09-27", 1), "2026-09-21", "Sunday is the last day of a Monday week");
assert.equal(startOfWeek("2026-09-28", 0), "2026-09-27");
assert.equal(startOfWeek("2026-09-28", 1), "2026-09-28");
assert.equal(startOfWeek("2026-10-03", 0), "2026-09-27");
assert.equal(startOfWeek("2026-10-03", 1), "2026-09-28");

// …and across a year boundary (2027-01-01 is a Friday).
assert.equal(dayOfWeek("2027-01-01"), 5);
assert.equal(startOfWeek("2027-01-01", 0), "2026-12-27");
assert.equal(startOfWeek("2027-01-01", 1), "2026-12-28");
assert.equal(startOfWeek("2027-01-03", 0), "2027-01-03");
assert.equal(startOfWeek("2027-01-03", 1), "2026-12-28");

// "This week" so far: a Sunday completion counts in a Sunday week, not in a Monday one.
{
  const log: CompletionLogEntry[] = [
    { id: "a", itemId: "h", date: "2026-09-27" },
    { id: "b", itemId: "h", date: "2026-09-28" },
  ];
  assert.equal(completionsInPeriod(log, "h", "2026-09-29", "week", 0), 2);
  assert.equal(completionsInPeriod(log, "h", "2026-09-29", "week", 1), 1);
  assert.equal(completionsInPeriod(log, "h", "2026-09-29", "month", 1), 2, "months don't depend on it");
}

// A 2×/week habit whose history re-buckets when the setting changes — the accepted
// trade-off noted next to the setting. Started Sunday 2026-09-06, looked at on Saturday
// 2026-09-19, done on two Sunday/Monday pairs.
{
  const habit: Habit = {
    kind: "habit",
    id: "run",
    name: "Run",
    categoryId: "sports",
    priority: 1,
    startDate: "2026-09-06",
    recurrence: { type: "timesPerPeriod", period: "week", count: 2 },
    completionType: "yesno",
  };
  const log: CompletionLogEntry[] = ["2026-09-06", "2026-09-07", "2026-09-13", "2026-09-14"].map((date, i) => ({
    id: `c${i}`,
    itemId: "run",
    date,
  }));
  const TODAY = "2026-09-19";

  // Sunday weeks: 6–12 Sep (6, 7) and 13–19 Sep (13, 14) are both met.
  const sunday = computeHabitStats(habit, log, TODAY, 0);
  assert.equal(sunday.currentStreak, 4);
  assert.equal(sunday.bestStreak, 4);
  assert.equal(sunday.completionPercentage, 100);
  assert.equal(sunday.completionsThisWeek, 2);

  // Monday weeks: 31 Aug–6 Sep (6) is missed, 7–13 Sep (7, 13) met, and the current
  // week 14–20 Sep (14) is still open, so it doesn't break the streak.
  const monday = computeHabitStats(habit, log, TODAY, 1);
  assert.equal(monday.currentStreak, 2);
  assert.equal(monday.bestStreak, 2);
  assert.equal(monday.completionPercentage, 33);
  assert.equal(monday.completionsThisWeek, 1);
  assert.equal(monday.completionsThisMonth, sunday.completionsThisMonth);
}

// Heatmap: columns start on the chosen day, and the row labels follow.
{
  const days = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"].map((date) => ({ date }));
  const dates = (weeks: ({ date: string } | undefined)[][]) => weeks.map((week) => Array.from(week, (day) => day?.date));

  // Sunday start: Saturday closes the first column, Sunday opens the second.
  assert.deepEqual(dates(heatmapWeeks(days, 0)), [
    [undefined, undefined, undefined, undefined, undefined, undefined, "2026-09-26"],
    ["2026-09-27", "2026-09-28", "2026-09-29"],
  ]);
  // Monday start: Saturday and Sunday are the bottom two rows, Monday opens the next column.
  assert.deepEqual(dates(heatmapWeeks(days, 1)), [
    [undefined, undefined, undefined, undefined, undefined, "2026-09-26", "2026-09-27"],
    ["2026-09-28", "2026-09-29"],
  ]);

  assert.deepEqual(heatmapRowLabels(0), ["S", "M", "T", "W", "T", "F", "S"]);
  assert.deepEqual(heatmapRowLabels(1), ["M", "T", "W", "T", "F", "S", "S"]);
}

console.log("weekStart.test.ts: all passed");
