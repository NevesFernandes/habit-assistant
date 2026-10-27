// §77: bringing an archived habit or recurring task back (unarchiveItem in dataStore.ts,
// archiveGap in recurrence.ts). Run: npm run test:unarchive
import assert from "node:assert/strict";
import { archiveGap, isArchived, isPausedOn, occursOn } from "./recurrence.ts";
import { computeHabitStats } from "./habitStats.ts";
import { unarchiveItem, updateHabit, updateRecurringTask } from "./dataStore.ts";
import { describeChanges, describeUnarchive } from "./confirmations.ts";
import { getHistory } from "./history.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit, type RecurringTask } from "../types/models.ts";

const TODAY = "2026-10-27"; // Tuesday
const gym: Habit = {
  kind: "habit", id: "gym", name: "Gym", categoryId: "sports", dayPart: "morning",
  startDate: "2026-09-20", endDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno",
};
const bins: RecurringTask = { kind: "recurringTask", id: "bins", name: "Bins", startDate: "2026-09-01", endDate: TODAY, recurrence: { type: "daily" } };
const base: AppData = {
  categories: DEFAULT_CATEGORIES, habits: [gym], recurringTasks: [bins], singleTasks: [],
  completionLog: ["2026-09-29", "2026-09-30", "2026-10-01"].map((date, i) => ({ id: `${i}`, itemId: "gym", date })),
};

// The archived days, 2 to 26 October, as a finished pause ending today.
assert.deepEqual(archiveGap(gym, undefined, TODAY), { from: "2026-10-02", resumeOn: TODAY });
const back = unarchiveItem(base, "habit", "gym", TODAY).habits[0];
assert.equal(back.endDate, undefined);
assert.equal(isArchived(back, TODAY), false);
assert.deepEqual(back.pauses, [{ from: "2026-10-02", resumeOn: TODAY }]);
assert.equal(occursOn(back, TODAY), true);
assert.equal(isPausedOn(back, "2026-10-15"), true);
// Neither done nor missed: the streak from before the archive carries on.
assert.equal(computeHabitStats(back, base.completionLog, TODAY, 0).currentStreak, 3);
const history = getHistory({ ...base, habits: [back] }, "2026-10-01", "2026-10-05", TODAY, [back]);
assert.deepEqual([history.items[0].missed, history.items[0].paused], [0, 4]);
assert.equal(
  describeUnarchive("Gym", archiveGap(gym, undefined, TODAY), TODAY),
  'Brought back "Gym" — it\'s due again from today. The days it was archived (Fri 2 Oct to Mon 26 Oct) count as paused, not missed.',
);

// Archived today (still due today) or yesterday: no gap to keep.
assert.equal(archiveGap(bins, undefined, TODAY), undefined);
assert.equal(archiveGap({ endDate: "2026-10-26" }, undefined, TODAY), undefined);
assert.equal(unarchiveItem(base, "recurringTask", "bins", TODAY).recurringTasks[0].pauses, undefined);
assert.equal(describeUnarchive("Bins", undefined, TODAY), 'Brought back "Bins" — it\'s due again from today.');
// Not archived: nothing.
assert.equal(archiveGap({ endDate: "2026-12-31" }, undefined, TODAY), undefined);
assert.equal(archiveGap({}, undefined, TODAY), undefined);

// The same through an edit: removing the end date, or moving it later.
{
  const removed = updateHabit(base, "gym", { newEndDate: "" }, TODAY).habits[0];
  assert.deepEqual([removed.endDate, removed.pauses], [undefined, [{ from: "2026-10-02", resumeOn: TODAY }]]);
  assert.ok(describeChanges(gym, removed, DEFAULT_CATEGORIES, TODAY).includes("Archived days (Fri 2 Oct to Mon 26 Oct): count as paused, not missed"));
  const later = updateHabit(base, "gym", { newEndDate: "2026-12-31" }, TODAY).habits[0];
  assert.deepEqual(later.pauses, [{ from: "2026-10-02", resumeOn: TODAY }]);
  // Moved later but still in the past: only the days up to the new end.
  const stillPast = updateHabit(base, "gym", { newEndDate: "2026-10-10" }, TODAY).habits[0];
  assert.deepEqual(stillPast.pauses, [{ from: "2026-10-02", resumeOn: "2026-10-11" }]);
  // Moved earlier, or other edits: no pause.
  assert.equal(updateHabit(base, "gym", { newEndDate: "2026-09-25" }, TODAY).habits[0].pauses, undefined);
  assert.equal(updateHabit(base, "gym", { newName: "Gym time" }, TODAY).habits[0].pauses, undefined);
  assert.equal(updateRecurringTask(base, "bins", { newEndDate: "" }, TODAY).recurringTasks[0].pauses, undefined);
}

console.log("unarchive: all assertions passed");
