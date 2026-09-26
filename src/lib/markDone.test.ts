// §41 in Roadmap.md: marking a habit or recurring task done / not done through chat —
// what gets stored, and that the reply spells it out. Plain-assert style, run under tsx
// because it reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:markDone
import assert from "node:assert/strict";
import { setHabitDone, setRecurringTaskDone } from "./dataStore.ts";
import { describeHabitMarkedDone, describeHabitMarkedNotDone, describeNotDue, describeRecurringTaskMarked } from "./confirmations.ts";
import { isHabitEntryComplete } from "./habitStats.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit, type RecurringTask } from "../types/models.ts";

const TODAY = "2026-09-26"; // a Saturday

const habit = (fields: Partial<Habit>): Habit => ({
  kind: "habit",
  id: "h",
  name: "Gym",
  categoryId: "sports",
  priority: 1,
  startDate: "2026-09-01",
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

const trash: RecurringTask = {
  kind: "recurringTask",
  id: "t",
  name: "Take out trash",
  priority: 1,
  startDate: "2026-09-01",
  recurrence: { type: "daysOfWeek", days: [1, 4] },
};

const data = (h: Habit, log: AppData["completionLog"] = []): AppData => ({
  categories: DEFAULT_CATEGORIES,
  habits: [h],
  recurringTasks: [trash],
  singleTasks: [],
  completionLog: log,
});

const entryFor = (d: AppData, id: string) => d.completionLog.find((e) => e.itemId === id && e.date === TODAY);

// Yes/No: set, not toggle — marking twice keeps it done; not done removes the entry.
{
  const gym = habit({});
  const once = setHabitDone(data(gym), "h", TODAY, true);
  const twice = setHabitDone(once, "h", TODAY, true);
  assert.equal(twice.completionLog.length, 1);
  assert.equal(setHabitDone(twice, "h", TODAY, false).completionLog.length, 0);
  assert.equal(describeHabitMarkedDone(gym, undefined, false, TODAY, TODAY, "3 days"), `Marked "Gym" complete for today (Sat 26 Sep).\nCurrent streak: 3 days.`);
  assert.equal(describeHabitMarkedNotDone(gym, entryFor(once, "h"), TODAY, TODAY), `Marked "Gym" not done for today (Sat 26 Sep).`);
  assert.match(describeHabitMarkedNotDone(gym, undefined, TODAY, TODAY), /wasn't marked complete .* so nothing changed/);
}

// Numeric: done logs the full goal; a partial log is topped up; a bigger one is kept.
{
  const water = habit({ id: "w", name: "Drink water", completionType: "value", target: 8, unit: "glasses" });
  const marked = setHabitDone(data(water), "w", TODAY, true);
  assert.equal(entryFor(marked, "w")?.value, 8);
  const partial = data(water, [{ id: "e", itemId: "w", date: TODAY, value: 5 }]);
  assert.equal(entryFor(setHabitDone(partial, "w", TODAY, true), "w")?.value, 8);
  const more = data(water, [{ id: "e", itemId: "w", date: TODAY, value: 10 }]);
  assert.equal(entryFor(setHabitDone(more, "w", TODAY, true), "w")?.value, 10);
  assert.equal(
    describeHabitMarkedDone(water, undefined, false, TODAY, TODAY, "1 day"),
    `Marked "Drink water" complete for today (Sat 26 Sep) with 8 glasses, its full goal.\nCurrent streak: 1 day.`,
  );
  assert.equal(
    describeHabitMarkedDone(water, entryFor(more, "w"), true, TODAY, TODAY, "1 day"),
    `"Drink water" was already complete for today (Sat 26 Sep): 10 glasses logged, goal 8 glasses. Nothing changed.`,
  );
  assert.equal(
    describeHabitMarkedNotDone(water, entryFor(partial, "w"), TODAY, TODAY),
    `Marked "Drink water" not done for today (Sat 26 Sep) by removing the 5 glasses logged.`,
  );
}

// Timer: the goal in minutes.
{
  const reading = habit({ id: "r", name: "Reading", completionType: "timer", target: 30 });
  assert.equal(entryFor(setHabitDone(data(reading), "r", TODAY, true), "r")?.value, 30);
  assert.match(describeHabitMarkedDone(reading, undefined, false, TODAY, TODAY, "1 day"), /with 30 min, its full goal\./);
}

// Checklist: done ticks every item for that day.
{
  const routine = habit({
    id: "c",
    name: "Morning routine",
    completionType: "checklist",
    checklist: [
      { id: "a", text: "stretch", checked: false },
      { id: "b", text: "journal", checked: false },
    ],
  });
  const marked = setHabitDone(data(routine), "c", TODAY, true);
  assert.ok(isHabitEntryComplete(routine, entryFor(marked, "c")));
  assert.equal(
    describeHabitMarkedDone(routine, undefined, false, TODAY, TODAY, "2 days"),
    `Marked "Morning routine" complete for today (Sat 26 Sep) by marking all checklist items done: stretch, journal.\nCurrent streak: 2 days.`,
  );
  assert.equal(
    describeHabitMarkedNotDone(routine, entryFor(marked, "c"), TODAY, TODAY),
    `Marked "Morning routine" not done for today (Sat 26 Sep) by unticking all its checklist items.`,
  );
}

// Recurring task: set, not toggle.
{
  const MONDAY = "2026-09-21";
  const once = setRecurringTaskDone(data(habit({})), "t", MONDAY, true);
  assert.equal(setRecurringTaskDone(once, "t", MONDAY, true).completionLog.length, 1);
  assert.equal(setRecurringTaskDone(once, "t", MONDAY, false).completionLog.length, 0);
  assert.equal(describeRecurringTaskMarked(trash, false, true, MONDAY, TODAY), `Marked "Take out trash" done for Mon 21 Sep.`);
  assert.match(describeRecurringTaskMarked(trash, true, true, MONDAY, TODAY), /already marked done/);
}

// Why a day can't be marked.
{
  assert.equal(describeNotDue(trash, TODAY, TODAY), `"Take out trash" isn't due today (Sat 26 Sep) — it repeats every Mon, Thu.`);
  assert.match(describeNotDue(habit({ startDate: "2026-09-28" }), TODAY, TODAY), /only starts on Mon 28 Sep/);
  assert.match(describeNotDue(habit({ endDate: "2026-09-20" }), TODAY, TODAY), /archived — its last day was Sun 20 Sep/);
  assert.match(describeNotDue(habit({ pauses: [{ from: "2026-09-25" }] }), TODAY, TODAY), /is paused today/);
}

console.log("markDone.test.ts: all passed");
