// §65: a period's summary (src/lib/historySummary.ts) and the app's wording of it.
// Run: npm run test:historySummary
import assert from "node:assert/strict";
import { getHistory } from "./history.ts";
import { summarizeHistory } from "./historySummary.ts";
import { describeHistory } from "./historyReply.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-09-23"; // Wednesday
const habit = (id: string): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning",
  startDate: "2026-09-01", recurrence: { type: "daily" }, completionType: "yesno",
});
const done = (id: string, days: number[]) => days.map((d) => ({ id: `${id}${d}`, itemId: id, date: `2026-09-${String(d).padStart(2, "0")}` }));
const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [habit("Floss"), habit("Read"), habit("Run")],
  recurringTasks: [],
  singleTasks: [],
  completionLog: [...done("Floss", [14, 15, 16, 17, 18, 19, 20, 21, 22, 23]), ...done("Read", [14, 21, 22, 23]), ...done("Run", [15, 16, 17, 18, 19, 20, 21])],
};

const history = getHistory(data, "2026-09-21", "2026-09-23", TODAY);
// Per-day totals, for a calendar or a chart: today's unfinished Run is open, not missed.
assert.deepEqual(history.daily.at(-1), { date: TODAY, done: 2, missed: 0, open: 1, upcoming: 0 });

const summary = summarizeHistory(data, history, 0);
assert.deepEqual(summary.period, { from: "2026-09-21", to: TODAY, done: 7, missed: 1, rate: 88 });
assert.deepEqual(summary.previous, { from: "2026-09-18", to: "2026-09-20", done: 6, missed: 3, rate: 67 });
assert.deepEqual(summary.weekly, [{ weekOf: "2026-09-20", done: 7, missed: 1 }]);
assert.deepEqual(summary.highlights, {
  longestStreak: { id: "Floss", name: "Floss", streak: 10, unit: "day" },
  mostMissed: { id: "Run", name: "Run", missed: 1 },
  mostImproved: { id: "Read", name: "Read", before: 0, now: 100 },
  perfect: [{ id: "Floss", name: "Floss" }, { id: "Read", name: "Read" }],
});

// The app's answer: the summary on top, then a line per item.
assert.equal(
  describeHistory(history, () => undefined, undefined, summary),
  [
    "Mon 21 Sep to Wed 23 Sep",
    "Done: 88% (7 of 8), up from 67% the 3 days before.",
    "Longest streak now: Floss, 10 days.",
    "Every due day done: Floss, Read.",
    "Most improved: Read, 0% → 100%.",
    "Most missed: Run (1).",
    "",
    "Floss: 3 of 3 done",
    "Read: 3 of 3 done",
    "Run: 1 of 2 done, missed Tue 22 Sep, today still to do",
  ].join("\n"),
);

// Nothing due yet (a future week): no summary lines.
const ahead = getHistory(data, "2026-09-28", "2026-10-04", TODAY);
assert.equal(describeHistory(ahead, () => undefined, undefined, summarizeHistory(data, ahead, 0)).split("\n")[1].startsWith("Floss:"), true);

console.log("historySummary: all assertions passed");
