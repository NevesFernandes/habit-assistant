// MCP agent, Phase 3: the write tools (set_done, log_progress) and find_items, end to end
// through the MCP protocol against an in-memory Drive file: same rules as the chat engine
// (§29, §41), saves replayed on a conflict (§21), and the user's today, not the Worker's.
// Run: npm run test:mcp
import assert from "node:assert/strict";
import { todayIn } from "../lib/today.ts";
import { addDays } from "../lib/recurrence.ts";
import { addHabit, updateSingleTask } from "../lib/dataStore.ts";
import type { McpDeps } from "./server.ts";
import { callTool, memoryStore, type MemoryStore } from "./testing/fakes.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit, type SingleTask } from "../types/models.ts";

const ZONE = "Europe/Lisbon";
const TODAY = todayIn(ZONE);
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const LONG_AGO = addDays(TODAY, -30);

const habit = (name: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id: name,
  name,
  categoryId: "health",
  dayPart: "morning",
  startDate: LONG_AGO,
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

const task = (id: string, name: string, fields: Partial<SingleTask> = {}): SingleTask => ({
  kind: "singleTask",
  id,
  name,
  dayPart: "workDay",
  startDate: TODAY,
  done: false,
  persistency: true,
  ...fields,
});

const fixture = (): AppData =>
  ({
    timeZone: ZONE,
    someFutureField: { kept: true },
    categories: DEFAULT_CATEGORIES,
    habits: [
      habit("Read", { dayPart: "evening" }),
      habit("Water", { completionType: "value", target: 8, unit: "glasses" }),
      habit("Pages", { completionType: "value", target: 20, unit: "pages" }),
      habit("No goal", { completionType: "timer" }),
      habit("Stretch morning"),
      habit("Stretch evening", { dayPart: "evening" }),
      habit("Night routine", {
        completionType: "checklist",
        checklist: [
          { id: "s1", text: "Floss", checked: false },
          { id: "s2", text: "Journal", checked: false },
        ],
      }),
      habit("Starts later", { startDate: TOMORROW }),
      habit("Archived", { endDate: YESTERDAY }),
    ],
    recurringTasks: [
      { kind: "recurringTask", id: "bins", name: "Take out bins", dayPart: "evening", startDate: LONG_AGO, recurrence: { type: "daily" } },
    ],
    singleTasks: [
      task("dentist", "Book dentist"),
      task("party", "Plan party", { startDate: addDays(TODAY, 3) }),
      task("momOld", "Call mom", { startDate: LONG_AGO, done: true }),
      task("momNew", "Call mom"),
      task("late", "Call bank", { startDate: YESTERDAY }),
    ],
    completionLog: [],
  }) as AppData;

const logged: Record<string, unknown>[] = [];
const fresh = (data: AppData = fixture()): { store: MemoryStore; deps: McpDeps } => {
  const store = memoryStore(data);
  return { store, deps: { store, log: (event) => logged.push(event) } };
};
const entry = (data: AppData, itemId: string, date = TODAY) =>
  data.completionLog.find((e) => e.itemId === itemId && e.date === date);

// --- set_done ------------------------------------------------------------------------

{
  const { store, deps } = fresh();
  const { isError, body } = await callTool(deps, "set_done", { name: "read" });
  assert.equal(isError, false);
  assert.equal(body.status, "ok");
  assert.equal(body.today, TODAY); // the stored zone's today, not the Worker's
  assert.equal(body.results[0].changed, true);
  assert.equal(body.results[0].item.done, true);
  assert.ok(entry(store.file(), "Read"));
  // Sets, never toggles: the second call changes nothing and doesn't write.
  const version = store.version();
  const again = (await callTool(deps, "set_done", { name: "Read" })).body;
  assert.equal(again.results[0].changed, false);
  assert.equal(again.results[0].item.done, true);
  assert.equal(store.version(), version);
  // Unknown fields and the stored zone survive a server-side write.
  assert.deepEqual((store.file() as AppData & { someFutureField?: unknown }).someFutureField, { kept: true });
  assert.equal(store.file().timeZone, ZONE);
  // Not done deletes the day's entry, as everywhere else.
  assert.equal((await callTool(deps, "set_done", { name: "Read", done: false })).body.results[0].item.done, false);
  assert.equal(entry(store.file(), "Read"), undefined);
}

// §41: done on a number habit logs the full goal; on a checklist habit, ticks every step.
{
  const { store, deps } = fresh();
  const water = (await callTool(deps, "set_done", { name: "water" })).body.results[0].item;
  assert.deepEqual([water.done, water.value, water.target], [true, 8, 8]);
  const night = (await callTool(deps, "set_done", { name: "night routine" })).body.results[0].item;
  assert.deepEqual([night.done, night.checklist.checked, night.checklist.total], [true, 2, 2]);
  assert.equal(entry(store.file(), "Water")?.value, 8);
  // A goal-less timer habit has no "done" amount.
  const noGoal = (await callTool(deps, "set_done", { name: "No goal" })).body;
  assert.equal(noGoal.status, "rejected");
  assert.match(noGoal.results[0].reason, /log_progress/);
}

// §29: no completion on a future day; not on a day the item isn't due either.
{
  const { store, deps } = fresh();
  const version = store.version();
  const future = (await callTool(deps, "set_done", { name: "Read", date: TOMORROW })).body;
  assert.equal(future.status, "rejected");
  assert.match(future.results[0].reason, /hasn't happened yet/);
  const notDue = (await callTool(deps, "set_done", { name: "Starts later" })).body;
  assert.equal(notDue.status, "rejected");
  assert.match(notDue.results[0].reason, /only starts/);
  assert.equal(store.version(), version);
  // A past day is fine.
  const past = (await callTool(deps, "set_done", { name: "Take out bins", date: YESTERDAY })).body;
  assert.equal(past.status, "ok");
  assert.ok(entry(store.file(), "bins", YESTERDAY));
}

// Several matches: never guessed between; picking both by id applies the change to each.
{
  const { store, deps } = fresh();
  const first = (await callTool(deps, "set_done", { name: "stretch" })).body;
  assert.equal(first.status, "ambiguous");
  assert.deepEqual(first.candidates.map((c: { id: string }) => c.id).sort(), ["Stretch evening", "Stretch morning"]);
  const both = (await callTool(deps, "set_done", { ids: ["Stretch morning", "Stretch evening"] })).body;
  assert.equal(both.status, "ok");
  assert.equal(both.results.length, 2);
  assert.ok(entry(store.file(), "Stretch morning") && entry(store.file(), "Stretch evening"));
  // Unknown ids are reported, not skipped.
  assert.equal((await callTool(deps, "set_done", { ids: ["nope"] })).body.status, "not_found");
  assert.equal((await callTool(deps, "set_done", { name: "Juggling" })).body.status, "not_found");
}

// A finished one-off task doesn't make today's namesake ambiguous.
{
  const { store, deps } = fresh();
  const body = (await callTool(deps, "set_done", { name: "call mom" })).body;
  assert.equal(body.status, "ok");
  assert.equal(body.results[0].item.id, "momNew");
  assert.equal(store.file().singleTasks.find((t) => t.id === "momNew")?.done, true);
}

// §29: a one-off task set for a later day asks first, then moves to today.
{
  const { store, deps } = fresh();
  const asked = (await callTool(deps, "set_done", { name: "Plan party" })).body;
  assert.equal(asked.status, "needs_confirm");
  assert.match(asked.results[0].question, /move it to today\?/);
  assert.equal(store.file().singleTasks.find((t) => t.id === "party")?.done, false);
  const yes = (await callTool(deps, "set_done", { ids: ["party"], moveToToday: true })).body;
  assert.equal(yes.status, "ok");
  const party = store.file().singleTasks.find((t) => t.id === "party");
  assert.deepEqual([party?.done, party?.startDate], [true, TODAY]);
}

// Every write rolls unfinished one-off tasks forward first, as the app does on opening.
{
  const { store, deps } = fresh();
  await callTool(deps, "set_done", { name: "Read" });
  assert.equal(store.file().singleTasks.find((t) => t.id === "late")?.startDate, TODAY);
}

// No stored or stated zone: ask, don't guess, and don't write.
{
  const { store, deps } = fresh({ ...fixture(), timeZone: undefined });
  assert.equal((await callTool(deps, "set_done", { name: "Read" })).body.status, "need_timezone");
  assert.equal(store.version(), 1);
  assert.equal((await callTool(deps, "set_done", { name: "Read", timeZone: ZONE })).body.status, "ok");
}

// --- §21 conflict replay ---------------------------------------------------------------

// The app saves in between: re-read, replay, and keep both changes.
{
  const { store, deps } = fresh();
  store.interfere(1, (data) => ({ ...data, completionLog: [...data.completionLog, { id: "app", itemId: "bins", date: TODAY }] }));
  assert.equal((await callTool(deps, "set_done", { name: "Read" })).body.status, "ok");
  const file = store.file();
  assert.ok(entry(file, "Read"));
  assert.ok(entry(file, "bins"));
}
// An amount added on a replay is added to what the app saved, not to the stale copy.
{
  const { store, deps } = fresh();
  store.interfere(2, (data) => ({ ...data, completionLog: [{ id: "app", itemId: "Pages", date: TODAY, value: 4 }] }));
  const body = (await callTool(deps, "log_progress", { name: "pages", add: 3 })).body;
  assert.equal(body.item.value, 7);
}
// Three conflicts in a row: nothing saved, a clear "try again".
{
  const { store, deps } = fresh();
  store.interfere(3, (data) => ({ ...data }));
  const { isError, body } = await callTool(deps, "set_done", { name: "Read" });
  assert.equal(isError, true);
  assert.equal(body.status, "conflict");
  assert.equal(entry(store.file(), "Read"), undefined);
}

// --- log_progress --------------------------------------------------------------------

{
  const { store, deps } = fresh();
  assert.equal((await callTool(deps, "log_progress", { name: "pages", add: 5 })).body.item.value, 5);
  assert.equal((await callTool(deps, "log_progress", { name: "pages", add: 5 })).body.item.value, 10);
  const set = (await callTool(deps, "log_progress", { id: "Pages", value: 3, date: YESTERDAY })).body;
  assert.deepEqual([set.status, set.date, set.item.value, set.item.target, set.item.unit], ["ok", YESTERDAY, 3, 20, "pages"]);
  assert.equal(entry(store.file(), "Pages")?.value, 10);
  assert.equal((await callTool(deps, "log_progress", { name: "pages", add: 5, date: TOMORROW })).body.status, "rejected");
  const yesNo = (await callTool(deps, "log_progress", { name: "Read", add: 1 })).body;
  assert.equal(yesNo.status, "rejected");
  assert.match(yesNo.reason, /set_done/);
  assert.equal((await callTool(deps, "log_progress", { name: "pages" })).body.status, "invalid_amount");
  assert.equal((await callTool(deps, "log_progress", { name: "pages", value: 1, add: 1 })).body.status, "invalid_amount");
}

// --- find_items ----------------------------------------------------------------------

{
  const { deps } = fresh();
  const all = (await callTool(deps, "find_items", {})).body.items as { id: string; name: string }[];
  const names = all.map((item) => item.name);
  assert.ok(!names.includes("Archived"));
  assert.equal(all.filter((item) => item.name === "Call mom").length, 1); // the finished one is left out
  assert.ok(names.indexOf("Stretch morning") < names.indexOf("Read")); // morning before evening
  const withInactive = (await callTool(deps, "find_items", { includeInactive: true })).body.items as { name: string }[];
  assert.ok(withInactive.some((item) => item.name === "Archived"));
  const stretch = (await callTool(deps, "find_items", { query: "stretch" })).body.items;
  assert.equal(stretch.length, 2);
  const [water] = (await callTool(deps, "find_items", { query: "water" })).body.items;
  assert.deepEqual([water.type, water.schedule, water.target, water.unit, water.dayPart], ["habit", "Every day", 8, "glasses", "morning"]);
  const tasks = (await callTool(deps, "find_items", { type: "singleTask" })).body.items as { type: string }[];
  assert.ok(tasks.every((item) => item.type === "singleTask"));
  // An archived item is still found when it's what the user names.
  assert.equal((await callTool(deps, "find_items", { query: "archived" })).body.items[0].archived, true);
}

// --- explicit dates --------------------------------------------------------------------
// dataStore's own "today" is the machine's; the connector passes the user's instead.
{
  const day = "2020-01-15";
  const created = addHabit(fixture(), { name: "Old", categoryId: "health", recurrence: { type: "daily" } }, day);
  assert.equal(created.habits.at(-1)?.startDate, day);
  const moved = updateSingleTask(fixture(), "dentist", { newStartDate: day }, day);
  assert.equal(moved.singleTasks.find((t) => t.id === "dentist")?.startDate, day); // not clamped to the machine's today
}

for (const event of logged) assert.deepEqual(Object.keys(event).sort(), ["ms", "status", "tool"]);

console.log("mcp write tools: all assertions passed");
