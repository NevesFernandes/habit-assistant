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
  const read = await call("get_stats", { scope: "item", name: "read" });
  const expected = computeHabitStats(fixture().habits[0], fixture().completionLog, TODAY, 0);
  assert.deepEqual([read.currentStreak, read.completionsAllTime, read.streakUnit], [expected.currentStreak, 3, "day"]);
  assert.equal(read.currentStreak, 3);
  assert.equal((await call("get_stats", { scope: "item", name: "gym" })).streakUnit, "week");
  // §63: a recurring task gets a yes/no habit's stats (no reconnect: the inputs froze at launch).
  const bins = await call("get_stats", { scope: "item", name: "bins" });
  assert.deepEqual([bins.status, bins.kind, bins.id, bins.streakUnit, bins.currentStreak, bins.completionsAllTime], ["ok", "recurringTask", "bins", "day", 0, 0]);
  // A one-off task: its own few facts.
  const milk = await call("get_stats", { scope: "item", name: "buy milk" });
  assert.deepEqual([milk.kind, milk.done, milk.due, milk.daysCarriedOver], ["singleTask", false, TODAY, undefined]);
  // `type` keeps one kind; tasks come in sections of their own.
  const oneOff = await call("get_stats", { scope: "overall", type: "singleTask" });
  assert.deepEqual([oneOff.status, oneOff.overall, oneOff.recurringTasks, oneOff.singleTasks.open, oneOff.singleTasks.taskCount], ["ok", undefined, undefined, 2, 2]);
  const habitOnly = await call("get_stats", { scope: "overall", type: "habit" });
  assert.deepEqual([habitOnly.recurringTasks, habitOnly.singleTasks], [undefined, undefined]);
  const health = await call("get_stats", { scope: "category", category: "health" });
  assert.deepEqual([health.category, health.habitCount, health.habits.length], ["Health", 2, 2]);
  assert.equal((await call("get_stats", { scope: "category", category: "Juggling" })).status, "rejected");
  const overall = await call("get_stats", { scope: "overall" });
  assert.equal(overall.overall.habitCount, 4);
  assert.deepEqual(overall.categories.map((c: { category: string }) => c.category), ["Health", "Study", "Sports"]);
  assert.deepEqual([overall.recurringTasks.taskCount, overall.singleTasks.taskCount], [1, 2]);
  assert.equal(overall.overall.habitCount, 4); // the tasks don't dilute the habit numbers
}

// --- reset_stats (§64) ---------------------------------------------------------------------

{
  const { store, call } = fresh();
  // Asks first, saying the best streak stays (from Claude it always does).
  const asked = await call("reset_stats", { scope: "item", name: "read" });
  assert.equal(asked.status, "needs_confirm");
  assert.match(asked.question, /^Start the stats over from today .* for "Read"\?.* The best streak \(3\) stays\. Resetting the best streak too can only be done in the Habit Assistant app\.$/);
  assert.equal(store.version(), 1); // nothing written before the yes
  const reset = await call("reset_stats", { scope: "item", name: "read", confirm: true });
  assert.equal(reset.status, "ok");
  const stats = await call("get_stats", { scope: "item", name: "read" });
  // Today counts (done today), the past doesn't; the best streak and the history stay.
  assert.deepEqual([stats.currentStreak, stats.bestStreak, stats.completionsAllTime], [1, 3, 1]);
  assert.equal(store.file().completionLog.filter((e) => e.itemId === "Read").length, 3);
  // A single one-off task has nothing to reset; their counts reset together.
  assert.match((await call("reset_stats", { scope: "item", name: "buy milk" })).message, /one-off task, which has no stats of its own/);
  const oneOff = await call("reset_stats", { scope: "all", type: "singleTask" });
  assert.match(oneOff.question, /for 2 one-off tasks\?/);
  assert.doesNotMatch(oneOff.question, /best streak/);
  // A category: every item in it at that moment.
  await call("reset_stats", { scope: "category", category: "health", confirm: true });
  assert.deepEqual(store.file().habits.filter((h) => h.statsFrom === TODAY).map((h) => h.id).sort(), ["Floss", "Read", "Routine"]);
  // Undo puts back the dates from before the last reset.
  const undone = await call("more_actions", { action: "undo_reset_stats", args: { name: "read" } });
  assert.equal(undone.status, "ok");
  assert.equal((await call("get_stats", { scope: "item", name: "read" })).completionsAllTime, 3);
  assert.equal((await call("more_actions", { action: "undo_reset_stats", args: { name: "read" } })).status, "rejected");
}

// --- more_actions ------------------------------------------------------------------------

{
  const { store, call } = fresh();
  const listing = await call("more_actions", {});
  assert.deepEqual(listing.actions.map((a: { action: string }) => a.action).sort(), ["add_category", "add_pack", "apply_to_many", "export", "list_categories", "missed", "set_note", "settings", "unarchive", "undo_reset_stats", "unskip"]);
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

// --- Notes (§67) ----------------------------------------------------------------------

{
  const { store, call } = fresh();
  // With a completion: saved in the same write, shown by get_day.
  const done = await call("set_done", { name: "floss", note: "used the new floss" });
  assert.equal(done.status, "ok");
  assert.equal(done.results[0].item.note, "used the new floss");
  assert.ok(store.file().completionLog.some((e) => e.itemId === "Floss" && e.date === TODAY));
  const day = await call("get_day", {});
  const floss = day.groups.flatMap((g: { items: { id: string; note?: string }[] }) => g.items).find((i: { id: string }) => i.id === "Floss");
  assert.equal(floss.note, "used the new floss");
  // Un-ticking keeps the note; a new one replaces it.
  await call("set_done", { name: "floss", done: false });
  assert.equal(store.file().notes?.find((n) => n.itemId === "Floss")?.text, "used the new floss");
  await call("set_done", { name: "read", note: "two chapters" });
  await call("set_done", { name: "read", note: "three chapters" });
  assert.deepEqual(store.file().notes?.filter((n) => n.itemId === "Read").map((n) => n.text), ["three chapters"]);
  // A note on an already-done day still saves.
  assert.equal(store.file().completionLog.filter((e) => e.itemId === "Read" && e.date === TODAY).length, 1);
  // On its own, through more_actions; on a missed day; removed with "".
  const yesterday = addDays(TODAY, -2);
  const noted = await call("more_actions", { action: "set_note", args: { name: "floss", date: yesterday, note: "gums sore" } });
  assert.equal(noted.status, "ok");
  const history = await call("get_history", { from: yesterday, to: yesterday, name: "floss" });
  assert.deepEqual([history.days[0].items[0].status, history.days[0].items[0].note], ["missed", "gums sore"]);
  assert.equal((await call("more_actions", { action: "set_note", args: { name: "floss", date: yesterday, note: "" } })).status, "ok");
  assert.equal(store.file().notes?.some((n) => n.date === yesterday), false);
  // A future day can have one: a note isn't a tick.
  assert.equal((await call("more_actions", { action: "set_note", args: { name: "floss", date: TOMORROW, note: "new brush" } })).status, "ok");
  // Deleting an item deletes its notes.
  await call("delete_items", { ids: ["Read"], confirm: true });
  assert.equal(store.file().notes?.some((n) => n.itemId === "Read"), false);
}

// --- Skip a day (§68) --------------------------------------------------------------------

{
  const { store, call } = fresh();
  // Today: neither done nor missed, and the streak doesn't look at it.
  const skipped = await call("schedule", { op: "skip", name: "floss" });
  assert.equal(skipped.status, "ok");
  assert.match(skipped.message, /^Skipped "Floss" today/);
  const floss = () => store.file().habits.find((h) => h.id === "Floss")!;
  assert.deepEqual(floss().pauses, [{ from: TODAY, resumeOn: TOMORROW, skip: true }]);
  const history = await call("get_history", { from: TODAY, to: TODAY, name: "floss" });
  assert.equal(history.days[0].items[0].status, "skipped");
  // Refused: twice, a past day, a done day, a one-off task, an "N times a week" habit.
  assert.match((await call("schedule", { op: "skip", name: "floss" })).message, /already skipped/);
  assert.match((await call("schedule", { op: "skip", name: "bins", date: addDays(TODAY, -1) })).message, /only skip today or a later day/);
  assert.match((await call("schedule", { op: "skip", name: "read" })).message, /already done .* Undo it first/);
  assert.equal((await call("schedule", { op: "skip", name: "buy milk" })).status, "rejected");
  assert.match((await call("schedule", { op: "skip", name: "gym" })).message, /3 times a week, with no set day to skip/);
  // A later day; pausing from next week and resuming keep it.
  assert.equal((await call("schedule", { op: "skip", name: "bins", date: TOMORROW })).status, "ok");
  await call("schedule", { op: "pause", name: "bins", from: addDays(TODAY, 7) });
  await call("schedule", { op: "resume", name: "bins" });
  assert.deepEqual(store.file().recurringTasks[0].pauses, [{ from: TOMORROW, resumeOn: addDays(TODAY, 2), skip: true }]);
  // A skip isn't a pause: "resume" with only a skip says it isn't paused.
  assert.equal((await call("schedule", { op: "resume", name: "floss" })).status, "rejected");
  // Undone through more_actions.
  assert.equal((await call("more_actions", { action: "unskip", args: { name: "floss" } })).status, "ok");
  assert.deepEqual(floss().pauses, []);
  assert.equal((await call("more_actions", { action: "unskip", args: { name: "floss" } })).status, "rejected");
  assert.equal((await call("schedule", { op: "skip", name: "gym", date: "soon" })).status, "invalid_date");
}

// --- Bringing an archived item back (§77) -------------------------------------------------

{
  const data = fixture();
  data.habits = data.habits.map((h) => (h.id === "Floss" ? { ...h, endDate: addDays(TODAY, -10) } : h));
  data.recurringTasks = data.recurringTasks.map((t) => ({ ...t, endDate: addDays(TODAY, -5) }));
  const store = memoryStore(data);
  const call = (tool: string, args: Record<string, unknown>) => callTool({ store }, tool, args).then((r) => r.body);
  // more_actions' unarchive: the archived days become a finished pause, not misses.
  const back = await call("more_actions", { action: "unarchive", args: { name: "floss" } });
  assert.equal(back.status, "ok");
  assert.match(back.message, /^Brought back "Floss" — it's due again from today\. The days it was archived \(.+\) count as paused, not missed\./);
  const floss = store.file().habits.find((h) => h.id === "Floss")!;
  assert.deepEqual([floss.endDate, floss.pauses], [undefined, [{ from: addDays(TODAY, -9), resumeOn: TODAY }]]);
  assert.equal(occursOn(floss, TODAY), true);
  // Not archived any more, or never: refused. One-off tasks have no archive.
  assert.equal((await call("more_actions", { action: "unarchive", args: { name: "floss" } })).status, "rejected");
  assert.match((await call("more_actions", { action: "unarchive", args: { name: "read" } })).message, /isn't archived/);
  assert.equal((await call("more_actions", { action: "unarchive", args: { name: "buy milk" } })).status, "rejected");
  // schedule's resume does the same.
  const resumed = await call("schedule", { op: "resume", name: "bins" });
  assert.match(resumed.message, /^Brought back "Bins"/);
  assert.deepEqual(store.file().recurringTasks[0].pauses, [{ from: addDays(TODAY, -4), resumeOn: TODAY }]);
  // An end date ahead isn't an archive: the message points to update_item.
  await call("update_item", { name: "read", newEndDate: addDays(TODAY, 30) });
  assert.match((await call("more_actions", { action: "unarchive", args: { name: "read" } })).message, /newEndDate ""/);
}

// --- Packs (§76) ---------------------------------------------------------------------------

{
  const { store, call } = fresh();
  const items = [
    { kind: "habit", name: "Drink water", category: "Nutrition", dayPart: "wakeUp", recurrence: "daily" },
    { kind: "habit", name: "Floss", dayPart: "bedtime", recurrence: "daily" }, // already there
    { kind: "recurringTask", name: "Water the plants", dayPart: "evening", recurrence: "days:sun,wed" },
  ];
  // The first call only shows the list.
  const before = store.version();
  const asked = await call("more_actions", { action: "add_pack", args: { name: "a fresh start", items } });
  assert.equal(asked.status, "needs_confirm");
  assert.match(asked.question, /^Here's a fresh start \(2 items\):\n1\. Drink water: habit, every day, Wake-up\n2\. Water the plants: recurring task, .*\nAlready have: Floss \(left out\)\./);
  assert.equal(store.version(), before);
  // With the yes, added; Claude drops what the user didn't want before calling.
  const added = await call("more_actions", { action: "add_pack", args: { name: "a fresh start", items: items.slice(0, 1), confirm: true } });
  assert.equal(added.status, "ok");
  assert.match(added.message, /^Added a fresh start: Drink water\./);
  assert.equal(store.file().habits.find((h) => h.name === "Drink water")?.categoryId, "nutrition");
  assert.equal((await call("more_actions", { action: "add_pack", args: { name: "x", items: [{ kind: "habit", name: "A", dayPart: "morning", recurrence: "sometimes" }] } })).status, "rejected");
}

// --- Export (§72) ---------------------------------------------------------------------------

{
  const { call } = fresh();
  const asked = await call("more_actions", { action: "export" });
  assert.equal(asked.status, "need_info");
  const week = await call("more_actions", { action: "export", args: { from: addDays(TODAY, -6), to: TOMORROW } });
  assert.equal(week.status, "ok");
  assert.equal(week.to, TODAY); // never a day to come
  assert.match(week.csv, /^date,item,kind,category,part of day,status,value,goal,unit,checklist,note\r\n/);
  assert.equal(week.csv.trim().split("\r\n").length - 1, week.rows);
  assert.equal(week.filename, `habit-assistant-${addDays(TODAY, -6)}-to-${TODAY}.csv`);
  assert.equal((await call("more_actions", { action: "export", args: { from: TOMORROW, to: TOMORROW } })).status, "rejected");
}

// --- Bulk actions (§75) --------------------------------------------------------------------

{
  const { store, call } = fresh();
  // Named items: Read is already done today, so it's left out and named.
  const named = await call("more_actions", { action: "apply_to_many", args: { action: "done", names: ["floss", "read"] } });
  assert.equal(named.status, "ok");
  assert.equal(named.message, "Marked done today: Floss.\nLeft out: Read (already done today).");
  assert.ok(store.file().completionLog.some((e) => e.itemId === "Floss" && e.date === TODAY));
  // A category, with a pause for a week.
  const sports = await call("more_actions", { action: "apply_to_many", args: { action: "pause", category: "Sports", resumeOn: addDays(TODAY, 7) } });
  assert.match(sports.message, /^Paused from today, back on .*: Gym\.$/);
  // Everything asks first, then goes with confirm.
  const asked = await call("more_actions", { action: "apply_to_many", args: { action: "skip" } });
  assert.equal(asked.status, "needs_confirm");
  assert.match(asked.question, /^That's every item/);
  const skipped = await call("more_actions", { action: "apply_to_many", args: { action: "skip", confirm: true } });
  assert.match(skipped.message, /^Skipped today/);
  // Refusals: no action, an unknown category, a future day to mark.
  assert.equal((await call("more_actions", { action: "apply_to_many", args: {} })).status, "need_info");
  assert.equal((await call("more_actions", { action: "apply_to_many", args: { action: "done", category: "Piano" } })).status, "rejected");
  assert.equal((await call("more_actions", { action: "apply_to_many", args: { action: "done", kind: "habit", date: TOMORROW } })).status, "rejected");
}

// --- What did I miss (§73) -----------------------------------------------------------------

{
  const { call } = fresh();
  // No period named: this week up to yesterday (or last week), and `period` says so.
  const week = await call("more_actions", { action: "missed" });
  assert.equal(week.status, "ok");
  assert.match(week.period, /You didn't name a period/);
  assert.ok(week.to < TODAY);
  // Floss was done only yesterday; the 20 days before it are misses, with a suggestion.
  const month = await call("more_actions", { action: "missed", args: { from: addDays(TODAY, -20), to: TODAY } });
  assert.equal(month.to, addDays(TODAY, -1)); // today isn't over
  assert.equal(month.period.includes("You didn't"), false);
  const floss = month.items.find((item: { id: string }) => item.id === "Floss");
  assert.deepEqual([floss.missed, floss.due], [19, 20]);
  // Two suggestions at most, for the most missed (never done in 20 days).
  assert.equal(month.suggestions.length, 2);
  assert.match(month.suggestions[0], /was missed 20 of 20 times\. Want to change its days, or pause it for a while\?/);
  assert.equal((await call("more_actions", { action: "missed", args: { from: TODAY } })).status, "rejected");
}

// --- Settings (§69) -----------------------------------------------------------------------

{
  const { store, call } = fresh();
  const shown = await call("more_actions", { action: "settings" });
  assert.deepEqual(shown, { status: "ok", firstDayOfWeek: "Sunday", readRepliesAloud: "off", note: "API keys, the chat provider and voice transcription are changed in Settings (⚙), not by chat." });
  const monday = await call("more_actions", { action: "settings", args: { weekStartsOn: "monday" } });
  assert.equal(monday.status, "ok");
  assert.match(monday.message, /^Weeks now start on Monday\./);
  assert.equal(store.file().weekStartsOn, 1);
  assert.equal((await call("more_actions", { action: "settings", args: { weekStartsOn: "friday" } })).status, "rejected");
}
{
  // Read-aloud: no device of its own, so every device, and any added later.
  const store = memoryStore({ ...fixture(), ttsEnabledByDevice: { phone: true, laptop: false } });
  const call = (tool: string, args: Record<string, unknown>) => callTool({ store }, tool, args).then((r) => r.body);
  assert.equal((await call("more_actions", { action: "settings" })).readRepliesAloud, "on on some devices, off on others");
  const off = await call("more_actions", { action: "settings", args: { readAloud: false } });
  assert.match(off.message, /^Read-aloud is now off in the Habit Assistant app on every device/);
  assert.deepEqual([store.file().ttsEnabledByDevice, store.file().ttsEnabledDefault], [{ phone: false, laptop: false }, false]);
}

// --- get_history (§66) ----------------------------------------------------------------------

{
  const { store, call } = fresh();
  const version = store.version();
  const week = await call("get_history", { from: addDays(TODAY, -2), to: TOMORROW });
  assert.equal(week.status, "ok");
  const read = week.items.find((i: { id: string }) => i.id === "Read");
  assert.deepEqual([read.done, read.missed, read.upcoming], [3, 0, 1]);
  const floss = week.items.find((i: { id: string }) => i.id === "Floss");
  assert.deepEqual([floss.done, floss.missed, floss.lastDone], [1, 1, addDays(TODAY, -1)]); // today is still open
  assert.equal(week.days.at(-1).date, TOMORROW);
  // §65: per-day totals and a summary worked out by the app.
  assert.equal(week.daily.length, 4);
  assert.equal(typeof week.summary.period.done, "number");
  assert.ok(Array.isArray(week.summary.highlights.perfect));
  assert.match(week.fields, /Use these numbers as they are/);
  // One item by name; "when did I last…" reaches before the range.
  const one = await call("get_history", { from: TODAY, to: TODAY, name: "floss" });
  assert.deepEqual([one.items.length, one.items[0].lastDone], [1, addDays(TODAY, -1)]);
  assert.equal((await call("get_history", { from: TODAY, to: TODAY, type: "recurringTask" })).items[0].id, "bins");
  assert.equal((await call("get_history", { from: TODAY, to: TODAY, name: "juggling" })).status, "not_found");
  assert.equal((await call("get_history", { from: "last week", to: TODAY })).status, "invalid_date");
  assert.equal((await call("get_history", { from: TODAY, to: addDays(TODAY, -1) })).status, "invalid_date");
  assert.equal((await call("get_history", { from: addDays(TODAY, -400), to: TODAY })).status, "rejected");
  assert.equal(store.version(), version); // read-only
}

console.log("mcp manage tools: all assertions passed");
