// §28 in Roadmap.md: pausing a Habit or Recurring Task. Plain-assert style, run under tsx
// because it reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:pause
import assert from "node:assert/strict";
import { addDays, currentPause, isPaused, isPausedOn, occursOn, upcomingPause } from "./recurrence.ts";
import { pauseItem, resumeItem } from "./dataStore.ts";
import { computeHabitStats } from "./habitStats.ts";
import { DEFAULT_CATEGORIES, type AppData, type CompletionLogEntry, type Habit } from "../types/models.ts";

const TODAY = "2026-09-22";

const daily = (pauses: Habit["pauses"], startDate = "2026-09-01"): Habit => ({
  kind: "habit",
  id: "gym",
  name: "Gym",
  categoryId: "sports",
  priority: 1,
  startDate,
  recurrence: { type: "daily" },
  completionType: "yesno",
  pauses,
});

// A pause window: from is the first paused day, resumeOn the first day back (exclusive).
{
  const habit = daily([{ from: "2026-09-23", resumeOn: "2026-10-01" }]);
  assert.equal(occursOn(habit, "2026-09-22"), true, "the day before the pause is still due");
  assert.equal(occursOn(habit, "2026-09-23"), false, "from is the first paused day");
  assert.equal(occursOn(habit, "2026-09-30"), false, "the day before resumeOn is still paused");
  assert.equal(occursOn(habit, "2026-10-01"), true, "resumeOn is the first day back");
  assert.equal(isPausedOn(habit, "2026-09-25"), true);
  assert.equal(isPaused(habit, TODAY), false, "not paused yet today");
  assert.equal(upcomingPause(habit, TODAY)?.from, "2026-09-23");
}

// An open-ended pause never lets a day through again on its own.
{
  const habit = daily([{ from: "2026-09-22" }]);
  assert.equal(occursOn(habit, TODAY), false);
  assert.equal(occursOn(habit, "2027-06-01"), false);
  assert.equal(currentPause(habit, TODAY)?.resumeOn, undefined);
}

// A habit with no pauses at all behaves exactly as before (old Drive files have no field).
{
  const habit = daily(undefined);
  assert.equal(occursOn(habit, TODAY), true);
  assert.equal(isPaused(habit, TODAY), false);
}

// The decision this feature turns on (user, 2026-09-22): 10 days, a 14-day pause, then
// 5 more days reads as a 15-day streak at 100% — paused days are neither done nor missed.
{
  // 15 completed days that would be 29 days of history without the pause.
  const start = addDays(TODAY, -28);
  const pauseFrom = addDays(start, 10);
  const backOn = addDays(pauseFrom, 14);
  const habit = daily([{ from: pauseFrom, resumeOn: backOn }], start);

  const completionLog: CompletionLogEntry[] = [];
  for (let i = 0; i < 29; i++) {
    const date = addDays(start, i);
    if (occursOn(habit, date) && date <= TODAY) {
      completionLog.push({ id: `c${i}`, itemId: habit.id, date });
    }
  }
  assert.equal(completionLog.length, 15, "10 before the pause + 5 after");

  const stats = computeHabitStats(habit, completionLog, TODAY);
  assert.equal(stats.currentStreak, 15, "the streak reads straight through the pause");
  assert.equal(stats.bestStreak, 15);
  assert.equal(stats.completionPercentage, 100, "paused days aren't counted as scheduled");
}

// A finished pause keeps excluding its days — clearing it would turn them back into
// misses and silently undo the streak the pause protected.
{
  const start = addDays(TODAY, -10);
  const habit = daily([{ from: addDays(TODAY, -6), resumeOn: addDays(TODAY, -3) }], start);
  const completionLog: CompletionLogEntry[] = [];
  for (let i = 0; i <= 10; i++) {
    const date = addDays(start, i);
    if (occursOn(habit, date)) completionLog.push({ id: `c${i}`, itemId: habit.id, date });
  }
  const stats = computeHabitStats(habit, completionLog, TODAY);
  assert.equal(stats.completionPercentage, 100);
  assert.equal(stats.currentStreak, completionLog.length, "no break where the pause was");
}

// The mutators.
const dataWith = (habit: Habit): AppData => ({
  categories: DEFAULT_CATEGORIES,
  habits: [habit],
  recurringTasks: [],
  singleTasks: [],
  completionLog: [],
});

{
  // Pausing replaces an active pause instead of stacking a second one...
  const data = dataWith(daily([{ from: "2026-09-20" }]));
  const next = pauseItem(data, "habit", "gym", { from: TODAY, resumeOn: "2026-10-01" }, TODAY);
  assert.deepEqual(next.habits[0].pauses, [{ from: TODAY, resumeOn: "2026-10-01" }]);

  // ...but keeps one that's already over.
  const withHistory = dataWith(daily([{ from: "2026-08-01", resumeOn: "2026-08-10" }, { from: "2026-09-20" }]));
  const replaced = pauseItem(withHistory, "habit", "gym", { from: TODAY }, TODAY);
  assert.deepEqual(replaced.habits[0].pauses, [{ from: "2026-08-01", resumeOn: "2026-08-10" }, { from: TODAY }]);
  assert.equal(withHistory.habits[0].pauses?.length, 2, "the original data is untouched");
}

{
  // Resuming an in-progress pause ends it today, keeping the days it covered.
  const data = dataWith(daily([{ from: "2026-09-20" }]));
  const resumed = resumeItem(data, "habit", "gym", TODAY);
  assert.deepEqual(resumed.habits[0].pauses, [{ from: "2026-09-20", resumeOn: TODAY }]);
  assert.equal(occursOn(resumed.habits[0], TODAY), true, "due again today");
  assert.equal(occursOn(resumed.habits[0], "2026-09-21"), false, "the days it covered stay excluded");
}

{
  // A pause that hasn't started is dropped outright — it protected nothing.
  const data = dataWith(daily([{ from: "2026-10-05", resumeOn: "2026-10-12" }]));
  assert.deepEqual(resumeItem(data, "habit", "gym", TODAY).habits[0].pauses, []);

  // One starting today covers nothing once resumed today, so it goes too.
  const startingToday = dataWith(daily([{ from: TODAY }]));
  assert.deepEqual(resumeItem(startingToday, "habit", "gym", TODAY).habits[0].pauses, []);
}

console.log("pause.test.ts: all passed");
