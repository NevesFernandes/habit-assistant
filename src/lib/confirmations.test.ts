// Plain assert-based check for confirmations.ts (§31) — same no-framework
// pattern as src/server/recurrenceSpec.test.ts. Run: node src/lib/confirmations.test.ts
import assert from "node:assert/strict";
import {
  describeArchive,
  describeCandidates,
  describeCreatedHabit,
  describeCreatedRecurringTask,
  describeCreatedSingleTask,
  describeDuplicateQuestion,
  describeUpdate,
  formatDate,
  itemDetails,
} from "./confirmations.ts";
import type { Category, Habit, RecurringTask, SingleTask } from "../types/models.ts";

const TODAY = "2026-09-18"; // a Friday
const categories: Category[] = [
  { id: "study", name: "Study", icon: "x", isDefault: true },
  { id: "sports", name: "Sports", icon: "x", isDefault: true },
  { id: "other", name: "Other", icon: "x", isDefault: true },
];

const habit = (overrides: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id: "h1",
  name: "Read",
  categoryId: "study",
  priority: 1,
  startDate: TODAY,
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...overrides,
});

// formatDate
assert.equal(formatDate(TODAY, TODAY), "today (Fri 18 Sep)");
assert.equal(formatDate("2026-09-19", TODAY), "tomorrow (Sat 19 Sep)");
assert.equal(formatDate("2026-09-22", TODAY), "Tue 22 Sep");
assert.equal(formatDate("2027-01-04", TODAY), "Mon 4 Jan 2027");

// Example 2 from the §31 report: a bare "add a habit to read" — every default flagged.
{
  const text = describeCreatedHabit(
    habit(),
    { name: "Read", categoryId: "study", recurrence: { type: "daily" } },
    categories,
    "add a habit to read",
    TODAY,
  );
  assert.match(text, /^Added habit "Read":/);
  assert.match(text, /Repeats: every day/);
  assert.match(text, /Category: Study/);
  assert.match(text, /Tracking: yes\/no/);
  assert.match(text, /Starts: today \(Fri 18 Sep\)/);
  assert.match(text, /\nAssumed: every day, Study, yes\/no, starting today\.\nNeed any changes\?$/);
}

// Example 1: explicit weekdays shown back verbatim, no recurrence/category hint when the user gave them.
{
  const text = describeCreatedHabit(
    habit({ name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [2, 4, 6, 0] } }),
    { name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [2, 4, 6, 0] }, completionType: "yesno", startDate: TODAY },
    categories,
    "add a sports habit gym on tue thu sat sun",
    TODAY,
  );
  assert.match(text, /Repeats: every Sun, Tue, Thu, Sat/);
  assert.doesNotMatch(text, /Assumed:/);
}

// "every night" counts as explicitly daily; a value habit shows its goal.
{
  const text = describeCreatedHabit(
    habit({ name: "Water", completionType: "value", target: 8, unit: "glasses" }),
    { name: "Water", categoryId: "study", recurrence: { type: "daily" }, completionType: "value", target: 8 },
    categories,
    "drink 8 glasses of water every night",
    TODAY,
  );
  assert.match(text, /Tracking: number — goal 8 glasses/);
  assert.match(text, /Assumed: Study, starting today\./);
  assert.doesNotMatch(text, /Assumed: every day/);
}

// Timer + end date + priority.
{
  const text = describeCreatedHabit(
    habit({ completionType: "timer", target: 90, endDate: "2026-12-31", priority: 3 }),
    { name: "Read", categoryId: "study", recurrence: { type: "daily" }, completionType: "timer", startDate: TODAY },
    categories,
    "study daily",
    TODAY,
  );
  assert.match(text, /Tracking: timer — goal 1 h 30 min/);
  assert.match(text, /Ends: Thu 31 Dec/);
  assert.match(text, /Priority: 3/);
}

// Recurring task with no category.
{
  const task: RecurringTask = {
    kind: "recurringTask",
    id: "r1",
    name: "Shopping",
    priority: 1,
    startDate: "2026-09-21",
    recurrence: { type: "timesPerPeriod", period: "week", count: 1 },
  };
  const text = describeCreatedRecurringTask(
    task,
    { name: "Shopping", recurrence: task.recurrence, startWeekday: 1 },
    categories,
    "weekly shopping starting monday",
    TODAY,
  );
  assert.match(text, /Category: none/);
  assert.match(text, /Starts: Mon 21 Sep/);
  assert.match(text, /Assumed: no category\.\nNeed any changes\?$/);
}

// Single task.
{
  const task: SingleTask = { kind: "singleTask", id: "s1", name: "Buy milk", priority: 0, startDate: TODAY, done: false, persistency: true };
  const text = describeCreatedSingleTask(task, { name: "Buy milk" }, TODAY);
  assert.match(text, /Date: today/);
  assert.match(text, /carries over/);
  assert.match(text, /Assumed: due today\./);
  assert.doesNotMatch(text, /Checklist/);
}

// §39: a task created with a checklist says so, empty or not.
{
  const base: SingleTask = { kind: "singleTask", id: "s1", name: "Go shopping", priority: 0, startDate: TODAY, done: false, persistency: true };
  assert.match(describeCreatedSingleTask({ ...base, checklist: [] }, { name: "Go shopping" }, TODAY), /• Checklist: empty for now/);
  const withItems = { ...base, checklist: [{ id: "a", text: "milk", checked: false }, { id: "b", text: "eggs", checked: false }] };
  assert.match(describeCreatedSingleTask(withItems, { name: "Go shopping" }, TODAY), /• Checklist: milk, eggs/);
}

// Updates list only changed fields.
{
  const before = habit({ name: "Gym", categoryId: "sports" });
  const after = habit({ name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [1] } });
  assert.equal(describeUpdate(before, after, categories, TODAY), `Updated "Gym":\n• Repeats: every day → every Mon`);
  assert.match(describeUpdate(before, before, categories, TODAY), /^Nothing changed/);
}

assert.match(describeArchive(habit()), /^Archived "Read"/);

// §32: numbered candidates with details, so identical names can be told apart.
{
  const nutrition = habit({ id: "n", name: "Drink water", categoryId: "other", completionType: "value", target: 8, unit: "glasses" });
  const sports = habit({ id: "s", name: "Drink water", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [1, 3] } });
  assert.equal(
    describeCandidates("habit", "Drink water", [nutrition, sports], categories, TODAY),
    `I found 2 habits matching "Drink water":\n` +
      `1. "Drink water" — Other · every day · number, goal 8 glasses\n` +
      `2. "Drink water" — Sports · every Mon, Wed · yes/no\n` +
      "Which one did you mean? You can reply with its number.",
  );
  assert.equal(
    describeDuplicateQuestion("habit", "Drink water", [sports], categories, TODAY),
    `You already have a habit called "Drink water" (Sports · every Mon, Wed · yes/no). Are you sure you want to create a new one with the same name?`,
  );
  assert.match(
    describeDuplicateQuestion("habit", "Drink water", [nutrition, sports], categories, TODAY),
    /^You already have 2 habits called "Drink water":\n1\. .*\n2\. .*\nAre you sure you want to create a new one with the same name\?$/,
  );
  const task: SingleTask = { kind: "singleTask", id: "s1", name: "Buy milk", priority: 0, startDate: TODAY, done: false, persistency: true };
  assert.equal(itemDetails(task, categories, TODAY), "today (Fri 18 Sep) · not done");
  assert.match(itemDetails(habit({ endDate: "2026-09-01" }), categories, TODAY), /· archived$/);
}

console.log("confirmations.test.ts: all passed");
