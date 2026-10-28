// §75: one action on several items (src/lib/bulk.ts), and the app's chat through the engine.
// Run: npm run test:bulk
import assert from "node:assert/strict";
import { planBulk, planBulkEdit, type BulkRequest } from "./bulk.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { skipOn } from "./skip.ts";
import { isPaused as pausedNow } from "./recurrence.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-10-27"; // Tuesday
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning",
  startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno", ...fields,
});
const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [
    habit("Floss", { dayPart: "bedtime" }),
    habit("Water", { completionType: "value", target: 8, unit: "glasses" }),
    habit("Stretch"),
    habit("Mondays", { recurrence: { type: "daysOfWeek", days: [1] } }),
    habit("Gym", { categoryId: "sports", recurrence: { type: "timesPerPeriod", period: "week", count: 3 } }),
    habit("Run", { categoryId: "sports" }),
    habit("Old", { endDate: "2026-10-10" }),
  ],
  recurringTasks: [{ kind: "recurringTask", id: "bins", name: "Bins", dayPart: "morning", startDate: "2026-10-01", recurrence: { type: "daily" } }],
  singleTasks: [{ kind: "singleTask", id: "bank", name: "Call the bank", dayPart: "morning", startDate: TODAY, done: false, persistency: true }],
  completionLog: [{ id: "s", itemId: "Stretch", date: TODAY }],
};
const plan = (request: BulkRequest, confirmed = false) => planBulk(data, request, TODAY, confirmed);
const ok = (p: ReturnType<typeof plan>) => {
  assert.equal(p.status, "ok");
  return p as Extract<ReturnType<typeof plan>, { status: "ok" }>;
};
const doneToday = (d: AppData, id: string) => d.completionLog.some((e) => e.itemId === id && e.date === TODAY);

// "Mark all my morning items done": what's due; already done is named; not due and archived pass quietly.
{
  const morning = ok(plan({ action: "done", filter: { dayPart: "morning" } }));
  assert.deepEqual(morning.targets.map((i) => i.name).sort(), ["Bins", "Call the bank", "Gym", "Run", "Water"].sort());
  assert.deepEqual(morning.leftOut, [{ name: "Stretch", reason: "already done today" }]);
  const after = morning.apply(data);
  assert.ok(doneToday(after, "Water") && doneToday(after, "bins"));
  assert.equal(after.completionLog.find((e) => e.itemId === "Water")?.value, 8); // the full goal
  assert.equal(after.singleTasks[0].done, true);
  assert.match(morning.message, /^Marked done today: .*\nLeft out: Stretch \(already done today\)\.$/);
}

// Named items: every name accounted for, also when it doesn't fit.
{
  const named = ok(plan({ action: "done", filter: { names: ["floss", "mondays"] } }));
  assert.deepEqual(named.targets.map((i) => i.name), ["Floss"]);
  assert.deepEqual(named.leftOut, [{ name: "Mondays", reason: "not due today" }]);
  assert.equal(plan({ action: "done", filter: { names: ["floss", "piano"] } }).status, "rejected");
  const twins = planBulk({ ...data, habits: [...data.habits, habit("Water plants")] }, { action: "done", filter: { names: ["water"] } }, TODAY);
  // An exact name wins, so "water" is Water; "wat" matches both.
  assert.equal(twins.status, "ok");
  assert.equal(planBulk({ ...data, habits: [...data.habits, habit("Water plants")] }, { action: "done", filter: { names: ["wat"] } }, TODAY).status, "ambiguous");
}

// Skip in a category: "3 times a week" has no set day, named as left out.
{
  const sports = ok(plan({ action: "skip", filter: { categoryId: "sports" } }));
  assert.deepEqual(sports.targets.map((i) => i.name), ["Run"]);
  assert.deepEqual(sports.leftOut, [{ name: "Gym", reason: "no set day to skip" }]);
  assert.ok(skipOn(sports.apply(data).habits.find((h) => h.id === "Run")!, TODAY));
  assert.equal(plan({ action: "skip", filter: { categoryId: "sports" }, date: "2026-10-26" }).status, "rejected");
}

// Pause and resume: habits and recurring tasks only; never from a past day.
{
  const week = ok(plan({ action: "pause", filter: { categoryId: "sports" }, resumeOn: "2026-11-03" }));
  assert.match(week.message, /^Paused from today, back on .*: Gym, Run\.$/);
  const paused = week.apply(data);
  assert.ok(pausedNow(paused.habits.find((h) => h.id === "Run")!, TODAY));
  const back = ok(planBulk(paused, { action: "resume", filter: { categoryId: "sports" } }, TODAY));
  assert.deepEqual(back.targets.map((i) => i.name), ["Gym", "Run"]);
  assert.equal(plan({ action: "pause", filter: { kind: "habit" }, from: "2026-10-20" }).status, "rejected");
  assert.equal(ok(plan({ action: "resume", filter: { kind: "habit" } })).targets.length, 0); // nothing paused
}

// Everything, nothing to narrow it: asked first; with the yes, done.
{
  const asked = plan({ action: "done", filter: {} });
  assert.equal(asked.status, "needs_confirm");
  assert.match((asked as { question: string }).question, /^That's every item \(\d+\): .* Do you want to mark them all done\?$/);
  assert.equal(plan({ action: "done", filter: {} }, true).status, "ok");
  assert.equal(plan({ action: "done", filter: {}, date: "2026-10-28" }).status, "rejected"); // a future day
}

// Through the engine: the question, then "yes".
{
  let saved = data;
  let call: Record<string, unknown> = { action: "skip" };
  const session = new ChatSession({
    getData: () => saved,
    persist: async (mutate) => {
      saved = mutate(saved);
      return true;
    },
    // While a question is open the model only gets confirmPendingAction.
    callAgent: async (_messages, _categories, pending) => ({
      toolCall: (pending ? { id: "c", name: "confirmPendingAction", input: { confirmed: true } } : { id: "t", name: "applyToMany", input: call }) as AgentToolCall & { id: string },
    }),
    todayISO: () => TODAY,
  });
  const last = () => {
    const message = session.messages.filter((m) => m.role === "assistant").pop();
    return message && "content" in message ? (message.content as string) : "";
  };
  await session.send("skip everything today");
  assert.match(last(), /^That's every item/);
  await session.send("yes");
  assert.match(last(), /^Skipped today \(neither done nor missed\): /);
  assert.ok(skipOn(saved.habits.find((h) => h.id === "Floss")!, TODAY));
  call = { action: "done", names: ["floss"] };
  await session.send("mark floss done");
  assert.equal(last(), "Nothing changed.\nLeft out: Floss (skipped today).");
}

// §78: one edit on several items.
{
  const edited = ok(planBulkEdit(data, { categoryId: "sports" }, { dayPart: "evening" }, TODAY));
  assert.equal(edited.message, "Moved to Evening: Gym, Run.");
  const after = edited.apply(data);
  assert.deepEqual(after.habits.filter((h) => h.categoryId === "sports").map((h) => h.dayPart), ["evening", "evening"]);
  // Several fields at once; an item already like that is named; archived items aren't caught.
  const both = ok(planBulkEdit(after, { dayPart: "evening" }, { dayPart: "evening", important: true }, TODAY));
  assert.deepEqual(both.targets.map((i) => i.name), ["Gym", "Run"]);
  const again = ok(planBulkEdit(both.apply(after), { names: ["gym", "run"] }, { important: true }, TODAY));
  assert.equal(again.message, "Nothing changed.\nLeft out: Gym (already like that), Run (already like that).");
  // How often: one-off tasks don't repeat; a filter passes over them quietly, a name doesn't.
  const weekly = ok(planBulkEdit(data, { dayPart: "morning" }, { recurrence: { type: "daysOfWeek", days: [1, 3, 5] } }, TODAY));
  assert.equal(weekly.targets.some((i) => i.kind === "singleTask"), false);
  assert.equal(weekly.leftOut.length, 0);
  assert.match(weekly.message, /^Now every mon, wed, fri: /i);
  assert.equal(weekly.apply(data).recurringTasks[0].recurrence.type, "daysOfWeek");
  const named = ok(planBulkEdit(data, { names: ["bank", "bins"] }, { recurrence: { type: "daily" } }, TODAY));
  assert.deepEqual(named.leftOut, [
    { name: "Bins", reason: "already like that" }, // already daily
    { name: "Call the bank", reason: "a one-off task doesn't repeat" },
  ]);
  // Category: moved, and a habit keeps one; refusals; everything asks first.
  assert.equal(ok(planBulkEdit(data, { names: ["floss"] }, { categoryId: "sports" }, TODAY)).apply(data).habits[0].categoryId, "sports");
  assert.equal(planBulkEdit(data, { names: ["floss"] }, { categoryId: "nope" }, TODAY).status, "rejected");
  assert.equal(planBulkEdit(data, { names: ["floss"] }, {}, TODAY).status, "rejected");
  assert.equal(planBulkEdit(data, {}, { important: true }, TODAY).status, "needs_confirm");
}

// §78 through the engine, and undo (§70) takes it back.
{
  let saved = data;
  let call: Record<string, unknown> = { name: "editMany", input: { categoryId: "sports", newDayPart: "evening" } };
  const session = new ChatSession({
    getData: () => saved,
    persist: async (mutate) => {
      saved = mutate(saved);
      return true;
    },
    callAgent: async () => ({ toolCall: { id: String(Math.random()), ...call } as AgentToolCall & { id: string } }),
    todayISO: () => TODAY,
  });
  const last = () => {
    const message = session.messages.filter((m) => m.role === "assistant").pop();
    return message && "content" in message ? (message.content as string) : "";
  };
  await session.send("move all my sports habits to the evening");
  assert.equal(last(), "Moved to Evening: Gym, Run.");
  call = { name: "undoLastChange", input: {} };
  await session.send("undo that");
  assert.equal(last(), 'Undone: I put "Gym" and "Run" back as they were.');
  assert.deepEqual(saved.habits.filter((h) => h.categoryId === "sports").map((h) => h.dayPart), ["morning", "morning"]);
}

console.log("bulk: all assertions passed");
