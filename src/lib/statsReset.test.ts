// §64: start the stats over (src/lib/statsReset.ts and the count-from date in habitStats.ts).
// Run: npm run test:statsReset
import assert from "node:assert/strict";
import { countingSince, describeResetQuestion, resetRefusal, resetStats, resetTargets, undoable, undoReset } from "./statsReset.ts";
import { aggregateCategoryStats, computeHabitStats, statsCountFrom } from "./habitStats.ts";
import { computeSingleTaskStats } from "./taskStats.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-09-23";
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning",
  startDate: "2026-09-01", recurrence: { type: "daily" }, completionType: "yesno", ...fields,
});
// Gym: done 1–10 (best streak 10), missed 11–20, done 21–23 (current streak 3).
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-09-${String(from + i).padStart(2, "0")}`);
const log = [...days(1, 10), ...days(21, 23)].map((date, i) => ({ id: `g${i}`, itemId: "gym", date }));
const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [habit("gym"), habit("read", { categoryId: "study" })],
  recurringTasks: [],
  singleTasks: [
    { kind: "singleTask", id: "t1", name: "t1", startDate: "2026-09-02", done: true, doneOn: "2026-09-02", persistency: true },
    { kind: "singleTask", id: "t2", name: "t2", startDate: "2026-09-23", done: true, doneOn: TODAY, persistency: true },
  ],
  completionLog: log,
};
const gymStats = (d: AppData) => computeHabitStats(d.habits[0], d.completionLog, TODAY, 0);

const before = gymStats(data);
assert.deepEqual([before.currentStreak, before.bestStreak, before.completionsAllTime, before.completionPercentage], [3, 10, 13, 57]);

// Reset from today: today counts; the best streak stays; the log is untouched.
const reset = resetStats(data, new Set(["gym"]), TODAY, false);
const after = gymStats(reset);
assert.deepEqual([after.currentStreak, after.bestStreak, after.completionsAllTime, after.completionPercentage, after.completionsThisMonth], [1, 10, 1, 100, 1]);
assert.equal(reset.completionLog.length, data.completionLog.length);
assert.equal(statsCountFrom(reset.habits[0]), TODAY);
// Including the best streak: only when asked.
assert.equal(gymStats(resetStats(data, new Set(["gym"]), TODAY, true)).bestStreak, 1);
// The category numbers follow.
assert.equal(aggregateCategoryStats(reset.habits.filter((h) => h.id === "gym"), reset.completionLog, TODAY, 0).completionsAllTime, 1);

// Undo puts the dates back, even after a second reset the same day.
const twice = resetStats(reset, new Set(["gym"]), TODAY, true);
assert.equal(undoable(twice.habits).length, 1);
const undone = undoReset(twice, new Set(["gym"]));
assert.deepEqual([undone.habits[0].statsFrom, undone.habits[0].bestStreakFrom, undone.habits[0].statsUndo], [undefined, undefined, undefined]);
assert.deepEqual(gymStats(undone), before);

// One-off tasks: done counts restart; a single one is refused.
const tasksReset = resetStats(data, new Set(["t1", "t2"]), TODAY, false);
assert.equal(computeSingleTaskStats(tasksReset.singleTasks, TODAY, 0).doneAllTime, 1);
assert.match(resetRefusal({ kind: "item", item: data.singleTasks[0] }, [data.singleTasks[0]])!, /no stats of its own/);

// Scope: a category, a kind.
assert.deepEqual(resetTargets(data, { kind: "category", categoryId: "health" }).map((i) => i.id), ["gym"]);
assert.deepEqual(resetTargets(data, { kind: "all" }, "singleTask").map((i) => i.id), ["t1", "t2"]);

// The question.
assert.equal(
  describeResetQuestion(data, { kind: "item", item: data.habits[0] }, [data.habits[0]], TODAY, 0, { includeBestStreak: false, bestStreakNote: "Say so." }),
  'Start the stats over from today (Wed 23 Sep) for "gym"? Streaks, completion % and counts begin again from today (Wed 23 Sep); the history and heatmap stay. The best streak (10) stays. Say so.',
);

// "Counting since": the start date until a reset, then the reset day.
assert.equal(countingSince(data.habits), "2026-09-01");
assert.equal(countingSince(reset.habits.filter((h) => h.id === "gym")), TODAY);

console.log("statsReset: all assertions passed");
