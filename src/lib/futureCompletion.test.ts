// §29 in Roadmap.md: completion status can't be changed for a day that hasn't happened
// yet. Same no-framework, plain-assert style as itemSelection.test.ts, but run under tsx
// rather than node: it reaches into dataStore.ts, whose imports have no file extensions.
// Run: npm run test:futureCompletion
import assert from "node:assert/strict";
import { isFutureDate } from "./recurrence.ts";
import { updateSingleTask } from "./dataStore.ts";
import { DEFAULT_CATEGORIES, type AppData, type SingleTask } from "../types/models.ts";

const TODAY = "2026-09-22";

// isFutureDate: today itself is not future — only days after it.
{
  assert.equal(isFutureDate("2026-09-23", TODAY), true);
  assert.equal(isFutureDate("2030-01-05", TODAY), true);
  assert.equal(isFutureDate(TODAY, TODAY), false, "today is not future");
  assert.equal(isFutureDate("2026-09-21", TODAY), false);
  // Crossing a month and a year boundary, since these are string comparisons.
  assert.equal(isFutureDate("2026-10-01", "2026-09-30"), true);
  assert.equal(isFutureDate("2026-09-30", "2026-10-01"), false);
  assert.equal(isFutureDate("2027-01-01", "2026-12-31"), true);
}

// Completing a future one-off task moves it to today, so its record says when it was
// really done — the whole point of the confirmation the user answers first.
{
  const task: SingleTask = {
    kind: "singleTask",
    id: "dentist",
    name: "Call the dentist",
    priority: 1,
    startDate: "2030-01-05",
    done: false,
    persistency: true,
  };
  const data: AppData = {
    categories: DEFAULT_CATEGORIES,
    habits: [],
    recurringTasks: [],
    singleTasks: [task],
    completionLog: [],
  };

  const next = updateSingleTask(data, "dentist", { newDone: true, newStartDate: todayForRun() });
  const updated = next.singleTasks[0];
  assert.equal(updated.done, true);
  assert.equal(updated.startDate, todayForRun(), "the task should move to today, not stay in the future");
  assert.equal(data.singleTasks[0].startDate, "2030-01-05", "the original data is left untouched");
}

/**
 * normalizeStartDate inside dataStore clamps anything earlier than the real today up to
 * today, so this test has to use the same clock rather than a frozen date.
 */
function todayForRun(): string {
  return new Date().toISOString().slice(0, 10);
}

console.log("futureCompletion.test.ts: all passed");
