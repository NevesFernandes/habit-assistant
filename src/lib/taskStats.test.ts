// §63: stats for recurring and one-off tasks (src/lib/taskStats.ts) and the app chat's
// stats replies (statsReply.ts). Run: npm run test:taskStats
import assert from "node:assert/strict";
import { aggregateRecurringTaskStats, asTrackable, computeRecurringTaskStats, computeSingleTaskStats, statsByKind } from "./taskStats.ts";
import { computeHabitStats } from "./habitStats.ts";
import { toggleSingleTaskDone, updateSingleTask } from "./dataStore.ts";
import { describeGroupStats, describeItemStats } from "./statsReply.ts";
import { DEFAULT_CATEGORIES, type AppData, type RecurringTask, type SingleTask } from "../types/models.ts";

const TODAY = "2026-09-23"; // Wednesday; weeks start Sunday the 20th
const bins: RecurringTask = { kind: "recurringTask", id: "bins", name: "Bins", startDate: "2026-09-01", recurrence: { type: "daily" } };
const log = [
  { id: "1", itemId: "bins", date: "2026-09-21" },
  { id: "2", itemId: "bins", date: "2026-09-22" },
  { id: "3", itemId: "bins", date: "2026-09-23" },
];

// A recurring task's stats are exactly a yes/no habit's.
const stats = computeRecurringTaskStats(bins, log, TODAY, 0);
assert.deepEqual(stats, computeHabitStats(asTrackable(bins), log, TODAY, 0));
assert.deepEqual([stats.currentStreak, stats.completionsThisWeek, stats.completionsAllTime], [3, 3, 3]);
assert.equal(aggregateRecurringTaskStats([bins], log, TODAY, 0).habitCount, 1);

// One-off tasks: done by doneOn; done before §63 (no doneOn) counts in all-time only.
const task = (id: string, fields: Partial<SingleTask>): SingleTask => ({ kind: "singleTask", id, name: id, startDate: TODAY, done: false, persistency: true, ...fields });
const tasks = [
  task("a", { done: true, doneOn: "2026-09-21" }),
  task("b", { done: true, doneOn: "2026-09-02" }),
  task("c", { done: true }), // before §63
  task("d", { originalStartDate: "2026-09-20" }), // carried 3 days
  task("e", { originalStartDate: "2026-09-22" }), // carried 1 day
  task("f", {}), // due today
  task("g", { startDate: "2026-09-30" }), // coming up
];
assert.deepEqual(computeSingleTaskStats(tasks, TODAY, 0), {
  taskCount: 7, doneThisWeek: 1, doneThisMonth: 2, doneThisYear: 2, doneAllTime: 3,
  open: 3, upcoming: 1, carriedOver: 2, averageDaysCarried: 2,
});

// doneOn is set when a task is marked done, either way, and dropped when it's undone.
const data: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [bins], singleTasks: [task("x", {})], completionLog: log };
const marked = toggleSingleTaskDone(data, "x", TODAY);
assert.equal(marked.singleTasks[0].doneOn, TODAY);
assert.equal("doneOn" in toggleSingleTaskDone(marked, "x", TODAY).singleTasks[0], false);
assert.equal(updateSingleTask(data, "x", { newDone: true }, TODAY).singleTasks[0].doneOn, TODAY);
assert.equal("doneOn" in updateSingleTask(marked, "x", { newDone: false }, TODAY).singleTasks[0], false);
assert.equal(updateSingleTask(marked, "x", { newName: "y" }, "2026-09-25").singleTasks[0].doneOn, TODAY); // untouched

// Separate sections: tasks never count towards the habit numbers.
const byKind = statsByKind({ ...data, singleTasks: tasks }, TODAY, 0);
assert.deepEqual([byKind.habits.habitCount, byKind.recurringTasks.habitCount, byKind.singleTasks.taskCount], [0, 1, 7]);

// The app chat's replies.
assert.equal(
  describeItemStats(data, bins, TODAY, 0),
  '"Bins": current streak 3 days (best 3 days), 13% done. This week 3, this month 3, this year 3, all time 3.',
);
assert.equal(describeItemStats(data, tasks[0], TODAY, 0), '"a" is done (Mon 21 Sep).');
assert.equal(describeItemStats(data, tasks[3], TODAY, 0), '"d" isn\'t done yet; it has carried over 3 days.');
assert.equal(
  describeGroupStats({ ...data, singleTasks: tasks }, TODAY, 0),
  "Recurring tasks (1): 13% done. This week 3, this month 3, this year 3, all time 3.\n" +
    "One-off tasks: 1 done this week, 2 this month, 3 all time; 3 open today (2 carried over, 2 days on average).",
);

console.log("taskStats: all assertions passed");
