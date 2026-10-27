// §68: skip one day of a habit or recurring task (src/lib/skip.ts). Run: npm run test:skip
import assert from "node:assert/strict";
import { describeSkip, skipDay, skipOn, skipRefusal, unskipDay } from "./skip.ts";
import { currentPause, isPaused, occursOn } from "./recurrence.ts";
import { computeHabitStats } from "./habitStats.ts";
import { pauseItem, resumeItem } from "./dataStore.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-09-23"; // Wednesday
const gym: Habit = {
  kind: "habit", id: "gym", name: "Gym", categoryId: "sports", dayPart: "morning",
  startDate: "2026-09-01", recurrence: { type: "daily" }, completionType: "yesno",
};
const base: AppData = {
  categories: DEFAULT_CATEGORIES, habits: [gym], recurringTasks: [], singleTasks: [],
  completionLog: [{ id: "1", itemId: "gym", date: "2026-09-21" }, { id: "2", itemId: "gym", date: "2026-09-22" }],
};

// Skipping today: not due, neither done nor missed, so the streak carries on.
const skipped = skipDay(base, gym, TODAY);
const habit = skipped.habits[0];
assert.equal(occursOn(habit, TODAY), false);
assert.ok(skipOn(habit, TODAY));
assert.equal(computeHabitStats(habit, skipped.completionLog, TODAY, 0).currentStreak, 2);
// It isn't a pause for labels and "resume".
assert.equal(isPaused(habit, TODAY), false);
assert.equal(currentPause(habit, TODAY), undefined);
// Undo.
assert.equal(occursOn(unskipDay(skipped, habit, TODAY).habits[0], TODAY), true);

// Refusals: the past, already skipped, already done, flexible habits.
assert.match(skipRefusal(base, gym, "2026-09-22", TODAY)!, /only skip today or a later day/);
assert.match(skipRefusal(skipped, habit, TODAY, TODAY)!, /already skipped/);
const doneToday = { ...base, completionLog: [...base.completionLog, { id: "3", itemId: "gym", date: TODAY }] };
assert.match(skipRefusal(doneToday, gym, TODAY, TODAY)!, /already done/);
const flexible: Habit = { ...gym, recurrence: { type: "timesPerPeriod", period: "week", count: 3 } };
assert.match(skipRefusal(base, flexible, TODAY, TODAY)!, /3 times a week, with no set day to skip/);
const weekly: Habit = { ...gym, recurrence: { type: "daysOfWeek", days: [1] } };
assert.match(skipRefusal(base, weekly, TODAY, TODAY)!, /isn't due/);
assert.equal(skipRefusal(base, gym, "2026-09-25", TODAY), undefined);

// A pause starting later keeps a skip before it; one covering it takes it in.
const tomorrowSkip = skipDay(base, gym, "2026-09-24");
const later = pauseItem(tomorrowSkip, "habit", "gym", { from: "2026-10-01" }, TODAY).habits[0].pauses;
assert.equal(later?.filter((p) => p.skip).length, 1);
const covering = pauseItem(tomorrowSkip, "habit", "gym", { from: TODAY }, TODAY).habits[0].pauses;
assert.equal(covering?.filter((p) => p.skip).length, 0);
// Resume keeps a skip ahead.
assert.equal(resumeItem(tomorrowSkip, "habit", "gym", TODAY).habits[0].pauses?.length, 1);

assert.equal(describeSkip(gym, TODAY, TODAY), 'Skipped "Gym" today (Wed 23 Sep). It counts as neither done nor missed, so your streak is safe.');
assert.match(describeSkip(gym, "2026-09-25", TODAY), /^Skipped "Gym" on Fri 25 Sep\./);

console.log("skip: all assertions passed");
