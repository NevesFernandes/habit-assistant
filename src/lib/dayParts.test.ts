// §54 in Roadmap.md: lists read like a day — by part of the day, important first, then by
// name — and items from before §54 need no migration. Plain-assert style, run under tsx
// because it reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:dayParts
import assert from "node:assert/strict";
import { compareForDay, DAY_PARTS, dayPartLabel, groupByDayPart, isImportant } from "./dayParts.ts";
import { addHabit, addSingleTask, resolveHabits, updateHabit, updateSingleTask } from "./dataStore.ts";
import { getHabitsForDate } from "./recurrence.ts";
import { DEFAULT_CATEGORIES, type AppData, type DayPart, type Habit } from "../types/models.ts";

const TODAY = "2026-10-08";
const empty: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [] };

const habit = (name: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id: name,
  name,
  categoryId: "health",
  startDate: "2026-09-01",
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

assert.deepEqual(DAY_PARTS.map((part) => part.label), ["Wake-up", "Morning", "Work day", "Afternoon", "Evening", "Bedtime"]);
assert.equal(dayPartLabel("workDay"), "Work day");
assert.equal(dayPartLabel(undefined), "Not placed yet");

// Day order, then important first, then A–Z; unplaced items last.
{
  const habits = [
    habit("Read", { dayPart: "evening" }),
    habit("Old habit"),
    habit("Shower", { dayPart: "wakeUp" }),
    habit("Brush teeth", { dayPart: "wakeUp" }),
    habit("Floss", { dayPart: "bedtime" }),
    habit("Stretch", { dayPart: "wakeUp", important: true }),
    habit("Deep work", { dayPart: "workDay" }),
  ];
  const sorted = habits.slice().sort(compareForDay).map((h) => h.name);
  assert.deepEqual(sorted, ["Stretch", "Brush teeth", "Shower", "Deep work", "Read", "Floss", "Old habit"]);
  // The same order wherever items are listed for a date.
  assert.deepEqual(getHabitsForDate(habits, TODAY).map((h) => h.name), sorted);

  // Headings: only the parts that have something, and "Not placed yet" at the end.
  const groups = groupByDayPart(habits, (h) => h);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((h) => h.name)]), [
    ["Wake-up", ["Stretch", "Brush teeth", "Shower"]],
    ["Work day", ["Deep work"]],
    ["Evening", ["Read"]],
    ["Bedtime", ["Floss"]],
    ["Not placed yet", ["Old habit"]],
  ]);
  assert.deepEqual(groupByDayPart([], (h: Habit) => h), []);
}

// Before §54 an item only had a priority number: above the default it reads as important,
// with no migration, until the flag is set either way.
{
  assert.equal(isImportant(habit("a")), false);
  assert.equal(isImportant(habit("a", { priority: 1 })), false);
  assert.equal(isImportant(habit("a", { priority: 0 })), false);
  assert.equal(isImportant(habit("a", { priority: 3 })), true);
  assert.equal(isImportant(habit("a", { priority: 3, important: false })), false);
  assert.equal(isImportant(habit("a", { priority: 1, important: true })), true);
}

// The store: a new item keeps the part it was given and no priority number; a part the
// model got wrong is stored as none, not guessed.
{
  let d = addHabit(empty, { name: "Read", categoryId: "study", recurrence: { type: "daily" }, dayPart: "evening", important: true });
  assert.equal(d.habits[0].dayPart, "evening");
  assert.equal(d.habits[0].important, true);
  assert.ok(!("priority" in d.habits[0]));
  d = addSingleTask(d, { name: "Call the bank", dayPart: "lunchtime" as DayPart });
  assert.equal(d.singleTasks[0].dayPart, undefined);
  assert.ok(!("important" in d.singleTasks[0]));

  // Moving and flagging, as chat and the picker both do.
  d = updateHabit(d, d.habits[0].id, { newDayPart: "bedtime" });
  assert.equal(d.habits[0].dayPart, "bedtime");
  assert.equal(d.habits[0].important, true, "an unrelated edit leaves the flag alone");
  d = updateHabit(d, d.habits[0].id, { newImportant: false });
  assert.equal(d.habits[0].important, false);
  assert.equal(d.habits[0].dayPart, "bedtime");
  d = updateSingleTask(d, d.singleTasks[0].id, { newDayPart: "workDay" });
  assert.equal(d.singleTasks[0].dayPart, "workDay");
  d = updateSingleTask(d, d.singleTasks[0].id, { newDayPart: "sometime" as DayPart });
  assert.equal(d.singleTasks[0].dayPart, "workDay", "an unknown part changes nothing");

  // Delete filters.
  d = addHabit(d, { name: "Floss", categoryId: "health", recurrence: { type: "daily" }, dayPart: "bedtime", important: true });
  assert.deepEqual(resolveHabits(d, { dayPart: "bedtime" }).map((h) => h.name), ["Read", "Floss"]);
  assert.deepEqual(resolveHabits(d, { dayPart: "bedtime", important: true }).map((h) => h.name), ["Floss"]);
  assert.deepEqual(resolveHabits(d, { dayPart: "morning" }), []);
}

console.log("dayParts.test.ts: all passed");
