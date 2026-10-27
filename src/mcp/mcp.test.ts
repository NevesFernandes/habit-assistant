// MCP agent, Phase 1: the user's "today" from a time zone, get_day matching the Today tab,
// and the MCP protocol end to end (initialize, tools/list, tools/call) against an
// in-memory file — no Google, no Worker. Plain-assert style, run under tsx because it
// reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:mcp
import assert from "node:assert/strict";
import { isISODate, isValidTimeZone, localTodayISO, todayIn } from "../lib/today.ts";
import { getDay, type DayItemView } from "./getDay.ts";
import type { McpDeps } from "./server.ts";
import { callTool, memoryStore, rpc } from "./testing/fakes.ts";
import { DriveFileNotFoundError } from "./drive.ts";
import {
  addHabit,
  addRecurringTaskChecklistItem,
  pauseItem,
  rolloverPersistentTasks,
  setHabitDone,
  setHabitValue,
  updateHabit,
  withTimeZone,
} from "../lib/dataStore.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit, type RecurringTask, type SingleTask } from "../types/models.ts";

// --- today ---------------------------------------------------------------------------

// 23:30 UTC on 1 July is already 2 July in Lisbon (UTC+1 in summer)…
assert.equal(todayIn("Europe/Lisbon", new Date("2026-07-01T23:30:00Z")), "2026-07-02");
// …and 01:00 UTC on 2 July is still 1 July in São Paulo (UTC-3).
assert.equal(todayIn("America/Sao_Paulo", new Date("2026-07-02T01:00:00Z")), "2026-07-01");
assert.equal(isValidTimeZone("Europe/Lisbon"), true);
assert.equal(isValidTimeZone("Lisbon"), false);
// §62: the app's "today" is the device's own calendar date, not the UTC one.
{
  const lateEvening = new Date(2026, 6, 1, 23, 30); // 23:30 on 1 July, device-local
  assert.equal(localTodayISO(lateEvening), "2026-07-01");
}
assert.equal(isISODate("2026-10-27"), true);
assert.equal(isISODate("2026-02-30"), false);
assert.equal(isISODate("27/10/2026"), false);

// --- get_day ---------------------------------------------------------------------------

const DAY = "2026-10-27"; // a Tuesday

const habit = (name: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id: name,
  name,
  categoryId: "health",
  startDate: "2026-10-01",
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...fields,
});

const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [
    habit("Read", { dayPart: "evening" }),
    habit("Stretch", { dayPart: "wakeUp", important: true }),
    habit("Brush teeth", { dayPart: "wakeUp" }),
    habit("Old habit"), // saved before §54: no part of the day
    habit("Water", { dayPart: "workDay", completionType: "value", target: 8, unit: "glasses" }),
    habit("Meditate", { dayPart: "morning", completionType: "timer", target: 10 }),
    habit("Night routine", {
      dayPart: "bedtime",
      completionType: "checklist",
      checklist: [
        { id: "s1", text: "Floss", checked: false },
        { id: "s2", text: "Journal", checked: false },
      ],
    }),
    habit("Gym", { dayPart: "afternoon", recurrence: { type: "timesPerPeriod", period: "week", count: 3 } }),
    habit("Weekend hike", { dayPart: "morning", recurrence: { type: "daysOfWeek", days: [0, 6] } }), // not on a Tuesday
    habit("Paused", { dayPart: "morning", pauses: [{ from: "2026-10-20" }] }),
    habit("Archived", { dayPart: "morning", endDate: "2026-10-26" }),
  ],
  recurringTasks: [
    {
      kind: "recurringTask",
      id: "shop",
      name: "Groceries",
      dayPart: "evening",
      startDate: "2026-10-01",
      recurrence: { type: "daily" },
      checklist: [
        { id: "c1", text: "Milk", checked: false, addedOn: "2026-10-20" },
        { id: "c2", text: "Eggs", checked: false, addedOn: "2026-10-20", doneOn: DAY },
      ],
    } satisfies RecurringTask,
  ],
  singleTasks: [
    { kind: "singleTask", id: "late", name: "Call bank", dayPart: "morning", startDate: "2026-10-25", done: false, persistency: true } satisfies SingleTask,
    { kind: "singleTask", id: "doneOld", name: "Pay rent", dayPart: "morning", startDate: "2026-10-25", done: true, persistency: true } satisfies SingleTask,
    { kind: "singleTask", id: "todayTask", name: "Book dentist", dayPart: "workDay", startDate: DAY, done: false, persistency: true } satisfies SingleTask,
  ],
  completionLog: [
    { id: "l1", itemId: "Stretch", date: DAY },
    { id: "l2", itemId: "Water", date: DAY, value: 5 },
    { id: "l3", itemId: "Night routine", date: DAY, checklist: [
      { id: "s1", text: "Floss", checked: true },
      { id: "s2", text: "Journal", checked: false },
    ] },
    { id: "l4", itemId: "Gym", date: "2026-10-26" }, // Monday, same week
    { id: "l5", itemId: "shop", date: DAY },
  ],
};

const byName = (items: DayItemView[], name: string) => {
  const found = items.find((item) => item.name === name);
  assert.ok(found, `expected ${name}`);
  return found;
};

// Same selection, grouping and order as the Today tab.
{
  const view = getDay(data, DAY, DAY);
  assert.deepEqual(
    view.groups.map((group) => [group.label, group.items.map((item) => item.name)]),
    [
      ["Wake-up", ["Stretch", "Brush teeth"]], // important first
      ["Morning", ["Call bank", "Meditate"]], // rolled forward from the 25th
      ["Work day", ["Book dentist", "Water"]],
      ["Afternoon", ["Gym"]],
      ["Evening", ["Groceries", "Read"]],
      ["Bedtime", ["Night routine"]],
      ["Not placed yet", ["Old habit"]],
    ],
  );
  assert.equal(view.isFuture, false);
  const items = view.groups.flatMap((group) => group.items);
  assert.equal(byName(items, "Stretch").done, true);
  assert.equal(byName(items, "Stretch").important, true);
  assert.equal(byName(items, "Stretch").category, "Health");
  assert.equal(byName(items, "Brush teeth").done, false);

  const water = byName(items, "Water");
  assert.ok(water.kind === "habit");
  assert.deepEqual([water.done, water.value, water.target, water.unit], [false, 5, 8, "glasses"]);
  const meditate = byName(items, "Meditate");
  assert.ok(meditate.kind === "habit");
  assert.deepEqual([meditate.value, meditate.target, meditate.unit], [0, 10, "minutes"]);

  const night = byName(items, "Night routine");
  assert.deepEqual([night.done, night.checklist?.checked, night.checklist?.total], [false, 1, 2]);

  const gym = byName(items, "Gym");
  assert.ok(gym.kind === "habit");
  assert.deepEqual(gym.periodProgress, { done: 1, target: 3, period: "week" });

  const shop = byName(items, "Groceries");
  assert.equal(shop.done, true);
  assert.deepEqual(shop.checklist?.items.map((item) => [item.text, item.checked]), [["Milk", false], ["Eggs", true]]);

  const bank = byName(items, "Call bank");
  assert.ok(bank.kind === "singleTask");
  assert.equal(bank.originalStartDate, undefined); // never had one stored; not invented
}

// The roll-forward happens in memory only: the file passed in is untouched.
assert.equal(data.singleTasks[0].startDate, "2026-10-25");

// Without today, nothing rolls forward and the past day keeps its own tasks.
{
  const view = getDay(data, "2026-10-25");
  const names = view.groups.flatMap((group) => group.items.map((item) => item.name));
  assert.ok(names.includes("Call bank"));
  assert.ok(names.includes("Pay rent"));
  assert.equal(view.today, undefined);
}

// A future day is flagged.
assert.equal(getDay(data, "2026-10-28", DAY).isFuture, true);

// --- MCP protocol ----------------------------------------------------------------------

const callGetDay = (deps: McpDeps, args: Record<string, unknown>) => callTool(deps, "get_day", args);

const logged: Record<string, unknown>[] = [];
const deps: McpDeps = { store: memoryStore(data), log: (event) => logged.push(event) };

{
  const { result } = await rpc(deps, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  assert.equal(result.serverInfo.name, "habit-assistant");
  assert.match(result.instructions, /part of the day/);
}

{
  const { result } = await rpc(deps, "tools/list");
  assert.deepEqual(result.tools.map((t: { name: string }) => t.name).sort(), ["create_item", "find_items", "get_day", "log_progress", "set_done", "update_item"]);
  const tool = result.tools.find((t: { name: string }) => t.name === "get_day");
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["date", "timeZone"]);
}

{
  const { isError, body } = await callGetDay(deps, { date: DAY, timeZone: "Europe/Lisbon" });
  assert.equal(isError, false);
  assert.equal(body.status, "ok");
  assert.equal(body.date, DAY);
  assert.equal(body.groups[0].label, "Wake-up");
}

// No date, and no time zone stated or stored: ask, don't guess.
assert.equal((await callGetDay(deps, {})).body.status, "need_timezone");

// §62: the app stores the device's time zone, so "today" needs no arguments…
{
  const zoned: McpDeps = { store: memoryStore({ ...data, timeZone: "Pacific/Kiritimati" }) };
  const { body } = await callGetDay(zoned, {});
  assert.equal(body.status, "ok");
  assert.equal(body.today, todayIn("Pacific/Kiritimati"));
  assert.equal(body.date, body.today);
  // …a time zone the user states wins over the stored one…
  const stated = (await callGetDay(zoned, { timeZone: "Pacific/Pago_Pago" })).body;
  assert.equal(stated.today, todayIn("Pacific/Pago_Pago"));
  assert.notEqual(stated.today, body.today); // UTC+14 and UTC-11 are always a day apart
}
// …and a broken stored value is ignored rather than trusted.
{
  const broken: McpDeps = { store: memoryStore({ ...data, timeZone: "Not/A_Zone" }) };
  assert.equal((await callGetDay(broken, {})).body.status, "need_timezone");
}

assert.equal((await callGetDay(deps, { date: "tomorrow" })).body.status, "invalid_date");
assert.equal((await callGetDay(deps, { date: DAY, timeZone: "Lisbon" })).body.status, "invalid_time_zone");

// The spike's key question: a Drive with no visible file says so plainly.
{
  const missing: McpDeps = {
    store: memoryStore(async () => {
      throw new DriveFileNotFoundError("folder");
    }),
  };
  const { isError, body } = await callGetDay(missing, { date: DAY });
  assert.equal(isError, false);
  assert.equal(body.status, "no_data_file");
  assert.match(body.message, /habitassistant\.app/);
}

// --- Compatibility with the app ---------------------------------------------------------
// The app and the connector share one file. Every app-side write goes through dataStore's
// spread-based functions, so fields one side doesn't know (a newer app's, BYOK settings)
// and the stored time zone must survive any sequence of them, through JSON, unchanged.
{
  const shared = {
    ...data,
    timeZone: "Europe/Lisbon",
    byokSettings: { activeProvider: null, keys: {} },
    ttsEnabledByDevice: { "device-1": true },
    someFutureField: { kept: true },
  } as AppData;
  const steps: [string, (d: AppData) => AppData][] = [
    ["setHabitDone", (d) => setHabitDone(d, "Read", DAY, true)],
    ["setHabitValue", (d) => setHabitValue(d, "Water", DAY, 8)],
    ["addHabit", (d) => addHabit(d, { name: "Stretch hamstrings", categoryId: "sports", dayPart: "morning", recurrence: { type: "daily" }, startDate: DAY })],
    ["updateHabit", (d) => updateHabit(d, "Read", { newImportant: true })],
    ["pauseItem", (d) => pauseItem(d, "habit", "Gym", { from: "2026-10-28" }, DAY)],
    ["addRecurringTaskChecklistItem", (d) => addRecurringTaskChecklistItem(d, "shop", "Bread", DAY)],
    ["rolloverPersistentTasks", (d) => rolloverPersistentTasks(d, DAY)],
    ["withTimeZone (same zone)", (d) => withTimeZone(d, "Europe/Lisbon")],
  ];
  let file: AppData = JSON.parse(JSON.stringify(shared));
  for (const [name, step] of steps) {
    file = JSON.parse(JSON.stringify(step(file))); // what Drive stores between the two sides
    const extra = file as AppData & { someFutureField?: unknown };
    assert.equal(file.timeZone, "Europe/Lisbon", `${name} kept timeZone`);
    assert.deepEqual(extra.someFutureField, { kept: true }, `${name} kept an unknown field`);
    assert.deepEqual(file.byokSettings, shared.byokSettings, `${name} kept byokSettings`);
    assert.deepEqual(file.ttsEnabledByDevice, shared.ttsEnabledByDevice, `${name} kept ttsEnabledByDevice`);
  }
  // The connector reads the result exactly as the app would show it.
  const items = getDay(file, DAY, DAY).groups.flatMap((group) => group.items);
  assert.equal(byName(items, "Read").done, true);
  assert.equal(byName(items, "Read").important, true);
  assert.equal(byName(items, "Water").done, true);
  assert.ok(items.some((item) => item.name === "Stretch hamstrings"));
  // withTimeZone writes only on a change: same reference when the zone already matches.
  assert.equal(withTimeZone(file, "Europe/Lisbon"), file);
  assert.equal(withTimeZone(file, "America/Sao_Paulo").timeZone, "America/Sao_Paulo");
}

// Logs carry status and timing only, never item data.
assert.ok(logged.length > 0);
for (const event of logged) assert.deepEqual(Object.keys(event).sort(), ["ms", "status", "tool"]);

console.log("mcp: all assertions passed");
