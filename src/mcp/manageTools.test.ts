// MCP agent, Phase 4: checklist, schedule, delete_items, get_stats and more_actions, through
// the MCP protocol against an in-memory file. The chat scenarios they share with the app
// are in scenarios.test.ts; this covers the rest: refusals, stats, archive and the
// growable more_actions tool. Run: npm run test:mcp
import assert from "node:assert/strict";
import { todayIn } from "../lib/today.ts";
import { addDays, occursOn } from "../lib/recurrence.ts";
import { computeHabitStats } from "../lib/habitStats.ts";
import { callTool, memoryStore } from "./testing/fakes.ts";
import type { McpDeps } from "./server.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const ZONE = "Europe/Lisbon";
const TODAY = todayIn(ZONE);
const TOMORROW = addDays(TODAY, 1);
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id,
  name: id,
  categoryId: "health",
  dayPart: "morning",
  startDate: addDays(TODAY, -20),
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

const fixture = (): AppData => ({
  timeZone: ZONE,
  categories: DEFAULT_CATEGORIES,
  habits: [
    habit("Read", { categoryId: "study" }),
    habit("Floss"),
    habit("Gym", { categoryId: "sports", recurrence: { type: "timesPerPeriod", period: "week", count: 3 } }),
    habit("Routine", { completionType: "checklist", checklist: [{ id: "s1", text: "Stretch", checked: false }, { id: "s2", text: "Journal", checked: false }] }),
  ],
  recurringTasks: [{ kind: "recurringTask", id: "bins", name: "Bins", startDate: addDays(TODAY, -20), recurrence: { type: "daily" } }],
  singleTasks: [
    { kind: "singleTask", id: "milk", name: "Buy milk", startDate: TODAY, done: false, persistency: true },
    {
      kind: "singleTask", id: "shop", name: "Shopping", startDate: TODAY, done: false, persistency: true,
      checklist: [{ id: "a", text: "oat milk", checked: false }, { id: "b", text: "soy milk", checked: false }, { id: "c", text: "bread", checked: false }],
    },
  ],
  completionLog: [
    { id: "l1", itemId: "Read", date: TODAY },
    { id: "l2", itemId: "Read", date: addDays(TODAY, -1) },
    { id: "l3", itemId: "Read", date: addDays(TODAY, -2) },
    { id: "l4", itemId: "Floss", date: addDays(TODAY, -1) },
  ],
});

const fresh = () => {
  const store = memoryStore(fixture());
  const deps: McpDeps = { store };
  return { store, call: (tool: string, args: Record<string, unknown>) => callTool(deps, tool, args).then((r) => r.body) };
};

// --- checklist ---------------------------------------------------------------------------

{
  const { store, call } = fresh();
  // A habit's steps go through update_item, not "add".
  const add = await call("checklist", { op: "add", name: "Routine", items: ["Floss"] });
  assert.equal(add.status, "rejected");
  assert.match(add.message, /update_item/);
  // A plain one-off task gets its first list from "add".
  const first = await call("checklist", { op: "add", name: "buy milk", items: ["semi-skimmed"] });
  assert.equal(first.status, "ok");
  assert.deepEqual(first.item.checklist.items.map((i: { text: string }) => i.text), ["semi-skimmed"]);
  // Ticking on a list without one: refused, not created.
  assert.equal((await call("checklist", { op: "tick", name: "Bins", items: ["x"] })).status, "rejected");
  // Two "milk"s: the found ones act, the unclear one is asked about.
  const tick = await call("checklist", { op: "tick", name: "Shopping", items: ["milk", "bread"] });
  assert.equal(tick.status, "ok");
  assert.match(tick.message, /Checked off "bread"/);
  assert.match(tick.message, /More than one item on "Shopping" matches "milk"/);
  assert.deepEqual(tick.item.checklist.checked, 1);
  // A habit's ticks are that day's completion: no future days (§29).
  assert.equal((await call("checklist", { op: "tick", name: "Routine", items: ["stretch"], date: TOMORROW })).status, "rejected");
  const ticked = await call("checklist", { op: "tick", name: "Routine", items: ["stretch", "journal"] });
  assert.equal(ticked.item.done, true);
  assert.equal((await call("checklist", { op: "untick", name: "Routine", items: ["journal"] })).item.done, false);
  // A checklist habit keeps at least one step; its checklist can't be removed on its own.
  assert.equal((await call("checklist", { op: "remove", name: "Routine", items: ["stretch", "journal"] })).status, "rejected");
  assert.equal((await call("checklist", { op: "remove_all", name: "Routine" })).status, "rejected");
  assert.equal(store.file().habits.find((h) => h.id === "Routine")?.checklist?.length, 2);
  assert.equal((await call("checklist", { op: "add", name: "Shopping" })).status, "need_info");
}

// --- schedule ----------------------------------------------------------------------------

{
  const { store, call } = fresh();
  const task = await call("schedule", { op: "pause", name: "buy milk" });
  assert.equal(task.status, "rejected");
  assert.match(task.message, /one-off task/);
  assert.equal((await call("schedule", { op: "resume", name: "Floss" })).status, "rejected"); // not paused
  assert.equal((await call("schedule", { op: "pause", name: "Floss", from: TOMORROW, resumeOn: TOMORROW })).status, "rejected");
  // An upcoming pause, then cancelled.
  assert.equal((await call("schedule", { op: "pause", name: "Floss", from: TOMORROW })).status, "ok");
  const cancelled = await call("schedule", { op: "resume", name: "Floss" });
  assert.match(cancelled.message, /Cancelled the upcoming pause/);
  assert.deepEqual(store.file().habits.find((h) => h.id === "Floss")?.pauses, []);
  // Archive: last day today, history kept.
  const archived = await call("schedule", { op: "archive", name: "Read" });
  assert.equal(archived.status, "ok");
  assert.match(archived.message, /^Archived "Read"/);
  const read = store.file().habits.find((h) => h.id === "Read")!;
  assert.equal(read.endDate, TODAY);
  assert.equal(occursOn(read, TOMORROW), false);
  assert.equal(store.file().completionLog.filter((e) => e.itemId === "Read").length, 3);
}

// --- delete_items --------------------------------------------------------------------------

{
  const { store, call } = fresh();
  // One one-off task named by the user: no question, as in the app.
  assert.equal((await call("delete_items", { name: "buy milk" })).status, "ok");
  assert.equal(store.file().singleTasks.some((t) => t.id === "milk"), false);
  // A habit always asks, and says its history goes too; nothing changes before the yes.
  const asked = await call("delete_items", { name: "floss" });
  assert.equal(asked.status, "needs_confirm");
  assert.match(asked.question, /Are you sure you want to delete the habit "Floss"\? This will also permanently delete its tracked completion history\./);
  assert.ok(store.file().habits.some((h) => h.id === "Floss"));
  // Mixed kinds by id: one question for all, then gone with their history.
  const mixed = await call("delete_items", { ids: ["Floss", "bins"] });
  assert.match(mixed.question, /these 2 items/);
  assert.equal((await call("delete_items", { ids: ["Floss", "bins"], confirm: true })).status, "ok");
  const file = store.file();
  assert.equal(file.habits.some((h) => h.id === "Floss") || file.recurringTasks.some((t) => t.id === "bins"), false);
  assert.equal(file.completionLog.some((e) => e.itemId === "Floss"), false);
}

// --- get_stats -----------------------------------------------------------------------------

{
  const { call } = fresh();
  const read = await call("get_stats", { scope: "habit", name: "read" });
  const expected = computeHabitStats(fixture().habits[0], fixture().completionLog, TODAY, 0);
  assert.deepEqual([read.currentStreak, read.completionsAllTime, read.streakUnit], [expected.currentStreak, 3, "day"]);
  assert.equal(read.currentStreak, 3);
  assert.equal((await call("get_stats", { scope: "habit", name: "gym" })).streakUnit, "week");
  assert.equal((await call("get_stats", { scope: "habit", name: "bins" })).status, "rejected"); // tasks have no stats
  const health = await call("get_stats", { scope: "category", category: "health" });
  assert.deepEqual([health.category, health.habitCount, health.habits.length], ["Health", 2, 2]);
  assert.equal((await call("get_stats", { scope: "category", category: "Juggling" })).status, "rejected");
  const overall = await call("get_stats", { scope: "overall" });
  assert.equal(overall.overall.habitCount, 4);
  assert.deepEqual(overall.categories.map((c: { category: string }) => c.category), ["Health", "Study", "Sports"]);
}

// --- more_actions ------------------------------------------------------------------------

{
  const { store, call } = fresh();
  const listing = await call("more_actions", {});
  assert.deepEqual(listing.actions.map((a: { action: string }) => a.action).sort(), ["add_category", "list_categories"]);
  const unknown = await call("more_actions", { action: "launch_rocket" });
  assert.equal(unknown.status, "invalid_action");
  assert.ok(Array.isArray(unknown.actions)); // the list comes back, so Claude can recover
  const added = await call("more_actions", { action: "add_category", args: { name: "Self-care" } });
  assert.deepEqual([added.status, added.message], ["ok", 'Added the category "Self-care".']);
  assert.ok(store.file().categories.some((c) => c.name === "Self-care" && !c.isDefault && c.icon === "square"));
  assert.equal((await call("more_actions", { action: "add_category", args: { name: "self care" } })).status, "rejected");
  assert.equal((await call("more_actions", { action: "add_category", args: {} })).status, "need_info");
  const categories = (await call("more_actions", { action: "list_categories" })).categories;
  assert.deepEqual(categories.find((c: { name: string }) => c.name === "Health"), { name: "Health", custom: false, items: 2 });
  // Reading needs no time zone; a change does.
  const noZone = memoryStore({ ...fixture(), timeZone: undefined });
  assert.equal((await callTool({ store: noZone }, "more_actions", { action: "list_categories" })).body.status, "ok");
  assert.equal((await callTool({ store: noZone }, "more_actions", { action: "add_category", args: { name: "X" } })).body.status, "need_timezone");
}

console.log("mcp manage tools: all assertions passed");
