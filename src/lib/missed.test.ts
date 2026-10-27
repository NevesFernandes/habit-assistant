// §73: what did I miss (src/lib/missed.ts), and the app's chat answer through the engine.
// Run: npm run test:missed
import assert from "node:assert/strict";
import { defaultMissedPeriod, describeMissed, getMissed } from "./missed.ts";
import { rolloverPersistentTasks } from "./dataStore.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-10-27"; // Tuesday
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning",
  startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno", ...fields,
});
const done = (itemId: string, ...dates: string[]) => dates.map((date) => ({ id: `${itemId}-${date}`, itemId, date }));

const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [
    habit("Floss"),
    habit("Gym", { recurrence: { type: "timesPerPeriod", period: "week", count: 3 } }),
    habit("Yoga", { pauses: [{ from: "2026-10-19", resumeOn: "2026-10-22" }] }),
    habit("Water", { completionType: "value", target: 8, unit: "glasses" }),
  ],
  recurringTasks: [],
  singleTasks: [
    { kind: "singleTask", id: "bank", name: "Call the bank", startDate: "2026-10-15", originalStartDate: "2026-10-15", done: false, persistency: true },
    { kind: "singleTask", id: "mail", name: "Post a letter", startDate: "2026-10-24", originalStartDate: "2026-10-24", done: false, persistency: true },
  ],
  completionLog: [
    ...done("Floss", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-25", "2026-10-26"),
    ...done("Gym", "2026-10-20"),
    ...done("Yoga", "2026-10-25", "2026-10-26"),
    { id: "w", itemId: "Water", date: "2026-10-25", value: 5 },
  ],
};
const shown = rolloverPersistentTasks(data, TODAY);

// The default period: this week up to yesterday; on the week's first day, last week.
assert.deepEqual(defaultMissedPeriod(TODAY, 0), { from: "2026-10-25", to: "2026-10-26", assumed: "thisWeek" });
assert.deepEqual(defaultMissedPeriod("2026-10-25", 0), { from: "2026-10-18", to: "2026-10-24", assumed: "lastWeek" });
assert.deepEqual(defaultMissedPeriod(TODAY, 1), { from: "2026-10-26", to: "2026-10-26", assumed: "thisWeek" });

// Last week, Sunday 18 to Saturday 24.
{
  const week = getMissed(shown, "2026-10-18", "2026-10-24", TODAY);
  const byId = Object.fromEntries(week.items.map((item) => [item.id, item]));
  assert.deepEqual([byId.Floss.missed, byId.Floss.due, byId.Floss.dates], [2, 7, ["2026-10-18", "2026-10-24"]]);
  // Paused days aren't misses.
  assert.deepEqual([byId.Yoga.missed, byId.Yoga.dates], [4, ["2026-10-18", "2026-10-22", "2026-10-23", "2026-10-24"]]);
  // A partial amount is a miss.
  assert.equal(byId.Water.missed, 7);
  // "3 times a week": the finished week, short of its target.
  assert.deepEqual(byId.Gym.periods, [{ start: "2026-10-18", done: 1, target: 3, period: "week" }]);
  // Most missed first.
  assert.deepEqual(week.items.map((item) => item.id), ["Water", "Yoga", "Floss", "Gym"]);
  // Carried over, longest first; first due on or before the period's end.
  assert.deepEqual(week.carried.map((task) => [task.name, task.days]), [["Call the bank", 12], ["Post a letter", 3]]);
  // Nudges: missed often (3+, at least half), carried a week or more; two at most.
  assert.deepEqual(week.nudges.map((n) => [n.kind, n.name]), [["missedOften", "Water"], ["missedOften", "Yoga"]]);
}

// This week so far: Gym's week isn't over, so it isn't a miss yet; the reply says which period.
{
  const week = getMissed(shown, "2026-10-25", "2026-10-26", TODAY, "thisWeek");
  assert.deepEqual(week.items.map((item) => item.id), ["Water"]);
  assert.deepEqual(week.carried.map((task) => task.name), ["Call the bank", "Post a letter"]);
  assert.equal(
    describeMissed(week, TODAY),
    [
      "This week so far (Sun 25 Oct to Mon 26 Oct). You didn't name a period, so I used this week up to yesterday; today isn't over yet.",
      "2 misses across 1 item:",
      "• Water: missed Sun 25 Oct, Mon 26 Oct (2 of 2)",
      "Carried over, still not done:",
      "• Call the bank: first due Thu 15 Oct, carried 12 days",
      "• Post a letter: first due Sat 24 Oct, carried 3 days",
      "",
      '"Call the bank" has been carried over for 12 days. Want to give it a new date, or drop it?',
    ].join("\n"),
  );
  const clean: AppData = { ...data, habits: [habit("Floss")], singleTasks: [] };
  assert.equal(describeMissed(getMissed(clean, "2026-10-25", "2026-10-26", TODAY), TODAY), "Sun 25 Oct to Mon 26 Oct\nNothing missed.");
}

// Through the engine: no dates means this week so far; a period reaching today stops at yesterday.
async function reply(input: Record<string, unknown>) {
  const session = new ChatSession({
    getData: () => data,
    persist: async () => true,
    callAgent: async () => ({ toolCall: { id: "1", name: "getMissed", input } as AgentToolCall & { id: string } }),
    todayISO: () => TODAY,
  });
  await session.send("what did I miss?");
  const last = session.messages.filter((message) => message.role === "assistant").pop();
  return last && "content" in last ? (last.content as string) : "";
}
assert.match(await reply({}), /^This week so far \(Sun 25 Oct to Mon 26 Oct\)\. You didn't name a period/);
assert.match(await reply({ from: "2026-10-25", to: TODAY }), /^Sun 25 Oct to Mon 26 Oct\n/);
assert.match(await reply({ from: TODAY, to: TODAY }), /until the day is over/);

console.log("missed: all assertions passed");
