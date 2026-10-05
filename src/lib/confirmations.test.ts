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
  const text = describeCreatedSingleTask(task, { name: "Buy milk" }, categories, TODAY);
  assert.match(text, /Date: today/);
  assert.doesNotMatch(text, /Category/);
  assert.match(text, /carries over/);
  assert.match(text, /Assumed: due today\./);
  assert.doesNotMatch(text, /Checklist/);
}

// §57: a day given by weekday is a given date, so nothing was assumed.
{
  const task: SingleTask = { kind: "singleTask", id: "s1", name: "Beacons", priority: 0, startDate: "2026-09-24", done: false, persistency: false };
  const text = describeCreatedSingleTask(task, { name: "Beacons", startWeekday: 4, startWeekdayMode: "next", persistency: false }, categories, TODAY);
  assert.match(text, /• Date: Thu 24 Sep/);
  assert.match(text, /dropped at the end of the day/);
  assert.doesNotMatch(text, /Assumed/);
}

// §53: a one-off task shows its category when it has one, first in the list.
{
  const task: SingleTask = { kind: "singleTask", id: "s1", name: "Run 5k", categoryId: "sports", priority: 0, startDate: TODAY, done: false, persistency: true };
  const text = describeCreatedSingleTask(task, { name: "Run 5k", categoryId: "sports" }, categories, TODAY);
  assert.match(text, /^Added task "Run 5k":\n• Category: Sports\n• Date: today/);
}

// §39: a task created with a checklist says so, empty or not.
{
  const base: SingleTask = { kind: "singleTask", id: "s1", name: "Go shopping", priority: 0, startDate: TODAY, done: false, persistency: true };
  assert.match(describeCreatedSingleTask({ ...base, checklist: [] }, { name: "Go shopping" }, categories, TODAY), /• Checklist: empty for now/);
  const withItems = { ...base, checklist: [{ id: "a", text: "milk", checked: false }, { id: "b", text: "eggs", checked: false }] };
  assert.match(describeCreatedSingleTask(withItems, { name: "Go shopping" }, categories, TODAY), /• Checklist: milk, eggs/);
}

// Updates list only changed fields.
{
  const before = habit({ name: "Gym", categoryId: "sports" });
  const after = habit({ name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [1] } });
  assert.equal(
    describeUpdate(before, after, categories, TODAY),
    `Updated "Gym":\n• Repeats: every day → every Mon\n• Next due: today (Fri 18 Sep) → Mon 21 Sep`,
  );
  assert.match(describeUpdate(before, before, categories, TODAY), /^Nothing changed/);
}

// §50: the reply names the first day the item is actually due, not the start date.
{
  const bins = (overrides: Partial<RecurringTask> = {}): RecurringTask => ({
    kind: "recurringTask",
    id: "r1",
    name: "Bins",
    priority: 1,
    startDate: TODAY,
    recurrence: { type: "daysOfWeek", days: [1] },
    ...overrides,
  });
  const created = (task: RecurringTask, userText = "take out the bins") =>
    describeCreatedRecurringTask(task, { name: task.name, recurrence: task.recurrence }, categories, userText, TODAY);

  // Every Monday, created on a Friday: first due Monday, and the hint says so too.
  const monday = created(bins());
  assert.match(monday, /• First due: Mon 21 Sep/);
  assert.doesNotMatch(monday, /Starts:/);
  assert.match(monday, /Assumed: no category, first due Mon 21 Sep\./);
  assert.doesNotMatch(monday, /starting today/);

  // The first due day is tomorrow.
  assert.match(created(bins({ recurrence: { type: "daysOfWeek", days: [6] } })), /• First due: tomorrow \(Sat 19 Sep\)/);

  // A rule that matches the start date keeps today's wording.
  const friday = created(bins({ recurrence: { type: "daysOfWeek", days: [5] } }));
  assert.match(friday, /• Starts: today \(Fri 18 Sep\)/);
  assert.match(friday, /starting today\./);
  assert.doesNotMatch(friday, /First due/);

  // Flexible, every-N-days and on/off rules are due on their start date.
  for (const recurrence of [
    { type: "timesPerPeriod", period: "week", count: 3 },
    { type: "intervalDays", interval: 3 },
    { type: "onOffCycle", onDays: 2, offDays: 5 },
  ] as const) {
    assert.match(created(bins({ recurrence })), /• Starts: today \(Fri 18 Sep\)/);
  }

  // Nth weekday of the month, and a yearly date in another year.
  assert.match(created(bins({ recurrence: { type: "nthWeekdayOfMonth", nth: "first", weekday: 1 } })), /• First due: Mon 5 Oct/);
  assert.match(created(bins({ recurrence: { type: "specificDatesOfYear", dates: ["03-15"] } })), /• First due: Mon 15 Mar 2027/);
  assert.match(created(bins({ recurrence: { type: "specificDatesOfYear", dates: ["02-29"] } })), /• First due: Tue 29 Feb 2028/);

  // A start date in the future that isn't a due day: first due is counted from it.
  const later = describeCreatedRecurringTask(
    bins({ startDate: "2026-09-23" }),
    { name: "Bins", recurrence: { type: "daysOfWeek", days: [1] }, startDate: "2026-09-23" },
    categories,
    "bins every monday from the 23rd",
    TODAY,
  );
  assert.match(later, /• First due: Mon 28 Sep/);
  assert.doesNotMatch(later, /first due|starting today/);

  // It ends before it is ever due.
  assert.match(created(bins({ endDate: "2026-09-20" })), /• First due: never, it ends before its first day/);

  // A habit gets the same line.
  const gym = describeCreatedHabit(
    habit({ name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [1, 3] } }),
    { name: "Gym", categoryId: "sports", recurrence: { type: "daysOfWeek", days: [1, 3] } },
    categories,
    "sports habit gym on mon and wed",
    TODAY,
  );
  assert.match(gym, /• First due: Mon 21 Sep/);
  assert.match(gym, /Assumed: yes\/no, first due Mon 21 Sep\./);

  // Edits: "Next due" only when the change moves it.
  assert.equal(
    describeUpdate(bins(), bins({ recurrence: { type: "daysOfWeek", days: [4] } }), categories, TODAY),
    `Updated "Bins":\n• Repeats: every Mon → every Thu\n• Next due: Mon 21 Sep → Thu 24 Sep`,
  );
  assert.equal(describeUpdate(bins(), bins({ name: "Rubbish" }), categories, TODAY), `Updated "Bins":\n• Name: "Bins" → "Rubbish"`);
  assert.equal(
    describeUpdate(bins(), bins({ endDate: "2026-12-31" }), categories, TODAY),
    `Updated "Bins":\n• Ends: none → Thu 31 Dec`,
  );
  // Counted from today, not from a start date in the past.
  assert.match(
    describeUpdate(bins({ startDate: "2026-09-01" }), bins({ startDate: "2026-09-01", recurrence: { type: "daysOfWeek", days: [2] } }), categories, TODAY),
    /• Next due: Mon 21 Sep → Tue 22 Sep$/,
  );
  // A new start date that is itself the next due day isn't repeated.
  const daily = habit();
  assert.equal(
    describeUpdate(daily, habit({ startDate: "2026-09-25" }), categories, TODAY),
    `Updated "Read":\n• Starts: today (Fri 18 Sep) → Fri 25 Sep`,
  );
  // An end date that leaves nothing due.
  assert.match(describeUpdate(bins(), bins({ endDate: "2026-09-19" }), categories, TODAY), /• Next due: Mon 21 Sep → none$/);
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
      "Which one did you mean? You can reply with its number, several numbers, or \"all\".",
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
