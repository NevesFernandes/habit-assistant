// §66: history over a date range (src/lib/history.ts), shared by the app's chat and the
// Claude connector. Run: npm run test:history
import assert from "node:assert/strict";
import { getHistory, HISTORY_MAX_ENTRIES, historyRangeDays } from "./history.ts";
import { describeHistory } from "./historyReply.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-09-23"; // a Wednesday
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id,
  name: id,
  categoryId: "health",
  dayPart: "morning",
  startDate: "2026-09-01",
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [
    habit("Floss"),
    habit("Water", { completionType: "value", target: 8, unit: "glasses" }),
    habit("Gym", { recurrence: { type: "timesPerPeriod", period: "week", count: 3 } }),
    habit("Yoga", { pauses: [{ from: "2026-09-21", resumeOn: "2026-09-23" }] }),
    habit("Mondays", { recurrence: { type: "daysOfWeek", days: [1] } }),
  ],
  recurringTasks: [{ kind: "recurringTask", id: "bins", name: "Bins", startDate: "2026-09-01", recurrence: { type: "daysOfWeek", days: [4] } }],
  singleTasks: [
    { kind: "singleTask", id: "dentist", name: "Dentist", startDate: "2026-09-02", done: true, persistency: true },
    { kind: "singleTask", id: "call", name: "Call mum", startDate: "2026-09-25", done: false, persistency: true },
  ],
  completionLog: [
    { id: "1", itemId: "Floss", date: "2026-09-21" },
    { id: "2", itemId: "Floss", date: "2026-09-23" },
    { id: "3", itemId: "Water", date: "2026-09-21", value: 8 },
    { id: "4", itemId: "Water", date: "2026-09-22", value: 5 },
    { id: "5", itemId: "Gym", date: "2026-09-21" },
    { id: "6", itemId: "Gym", date: "2026-09-22" },
    { id: "7", itemId: "Mondays", date: "2026-09-14" },
  ],
};

const status = (h: ReturnType<typeof getHistory>, date: string, id: string) =>
  h.days?.find((day) => day.date === date)?.items.find((item) => item.id === id)?.status;
const summary = (h: ReturnType<typeof getHistory>, id: string) => h.items.find((item) => item.id === id);

// One week, Monday to Sunday, seen from Wednesday.
{
  const week = getHistory(data, "2026-09-21", "2026-09-27", TODAY);
  // A daily habit: done, missed, done today, then upcoming.
  assert.deepEqual(
    ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map((d) => status(week, d, "Floss")),
    ["done", "missed", "done", "upcoming"],
  );
  assert.deepEqual(
    (({ due, done, missed, upcoming }) => ({ due, done, missed, upcoming }))(summary(week, "Floss")!),
    { due: 3, done: 2, missed: 1, upcoming: 4 },
  );
  // A partial amount is a miss, with what was logged.
  const water = week.days!.find((d) => d.date === "2026-09-22")!.items.find((i) => i.id === "Water")!;
  assert.deepEqual([water.status, water.value, water.target, water.unit], ["missed", 5, 8, "glasses"]);
  // Today, not done yet: open, not missed.
  assert.equal(status(week, TODAY, "Water"), "open");
  // "3 times a week": only done days are listed; the week's progress comes as a period.
  assert.equal(status(week, TODAY, "Gym"), undefined);
  // Weeks start on Sunday by default, so Sunday the 27th opens the next one.
  assert.deepEqual(summary(week, "Gym")!.periods, [{ start: "2026-09-20", done: 2, target: 3 }, { start: "2026-09-27", done: 0, target: 3 }]);
  assert.equal(summary(week, "Gym")!.missed, 0);
  // Paused days are paused, not missed; back on the resume day.
  assert.deepEqual([status(week, "2026-09-21", "Yoga"), status(week, "2026-09-22", "Yoga"), status(week, TODAY, "Yoga")], ["paused", "paused", "open"]);
  // A weekday rule appears on its own day only.
  assert.equal(status(week, "2026-09-21", "Mondays"), "missed");
  assert.equal(status(week, "2026-09-22", "Mondays"), undefined);
  // A recurring task due Thursday, still ahead.
  assert.equal(status(week, "2026-09-24", "bins"), "upcoming");
  // A one-off task on its day.
  assert.equal(status(week, "2026-09-25", "call"), "upcoming");
  // Items with nothing in the range are left out.
  assert.equal(summary(week, "dentist"), undefined);
}

// "When did I last…": lastDone reaches back before the range.
{
  const week = getHistory(data, "2026-09-21", "2026-09-27", TODAY, data.habits.filter((h) => h.id === "Mondays"));
  assert.equal(summary(week, "Mondays")!.lastDone, "2026-09-14");
  assert.equal(week.items.length, 1);
  const month = getHistory(data, "2026-09-01", "2026-09-30", TODAY, data.singleTasks);
  assert.deepEqual([status(month, "2026-09-02", "dentist"), summary(month, "dentist")!.lastDone], ["done", "2026-09-02"]);
}

// Nothing before an item's start date; a long range keeps the totals and drops the days.
{
  const before = getHistory(data, "2026-08-01", "2026-08-31", TODAY);
  assert.deepEqual([before.items.length, before.days], [0, []]);
  const many: AppData = { ...data, habits: Array.from({ length: 30 }, (_, i) => habit(`H${i}`)), recurringTasks: [], singleTasks: [] };
  const year = getHistory(many, "2026-01-01", "2026-12-31", TODAY);
  assert.ok(30 * 23 > HISTORY_MAX_ENTRIES);
  assert.deepEqual([year.daysOmitted, year.days, year.items.length], [true, undefined, 30]);
  assert.equal(year.items[0].due, 23); // 1 to 23 September
}

assert.equal(historyRangeDays("2026-09-01", "2026-09-30"), 30);
assert.equal(historyRangeDays("2026-09-02", "2026-09-01"), 0);

// The app's reply (historyReply.ts): one line per item, in the day's order.
{
  const flexibleOf = (id: string) => (id === "Gym" ? "week" : undefined);
  const week = getHistory(data, "2026-09-21", "2026-09-27", TODAY);
  const reply = describeHistory(week, flexibleOf);
  const lines = reply.split("\n");
  assert.equal(lines[0], "Mon 21 Sep to Sun 27 Sep");
  assert.ok(lines.includes("Floss: 2 of 3 done, missed Tue 22 Sep, due 4 more days"), reply);
  assert.ok(lines.includes("Water: 1 of 2 done, missed Tue 22 Sep, today still to do, due 4 more days"), reply);
  assert.ok(lines.includes("Gym: 2 of 3 in the week of 20 Sep, 0 of 3 in the week of 27 Sep"), reply);
  assert.ok(lines.includes("Yoga: today still to do, paused Mon 21 Sep, Tue 22 Sep, due 4 more days"), reply);
  assert.ok(lines.includes("Call mum: due Fri 25 Sep"), reply);
  // One item: when it was last done, even before the range.
  const mondays = getHistory(data, "2026-09-22", "2026-09-23", TODAY, data.habits.filter((h) => h.id === "Mondays"), { keepEmpty: true });
  assert.equal(describeHistory(mondays, flexibleOf, { name: "Mondays" }), '"Mondays" wasn\'t due between Tue 22 Sep and Wed 23 Sep. Last done Mon 14 Sep.');
  const floss = getHistory(data, "2026-09-21", "2026-09-22", TODAY, data.habits.filter((h) => h.id === "Floss"));
  assert.equal(describeHistory(floss, flexibleOf, { name: "Floss" }), "Mon 21 Sep to Tue 22 Sep\nFloss: 1 of 2 done, missed Tue 22 Sep\nLast done Mon 21 Sep.");
  assert.equal(describeHistory(getHistory(data, "2026-08-01", "2026-08-02", TODAY), flexibleOf), "Nothing was due between Sat 1 Aug and Sun 2 Aug.");
}

console.log("history: all assertions passed");
