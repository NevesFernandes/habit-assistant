// MCP agent, Phase 1: the user's "today" from a time zone, get_day matching the Today tab,
// and the MCP protocol end to end (initialize, tools/list, tools/call) against an
// in-memory file — no Google, no Worker. Plain-assert style, run under tsx because it
// reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:mcp
import assert from "node:assert/strict";
import { isISODate, isValidTimeZone, todayIn } from "./today.ts";
import { getDay, type DayItemView } from "./getDay.ts";
import { handleMcpRequest, type McpDeps } from "./server.ts";
import { DriveFileNotFoundError } from "./drive.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit, type RecurringTask, type SingleTask } from "../types/models.ts";

// --- today ---------------------------------------------------------------------------

// 23:30 UTC on 1 July is already 2 July in Lisbon (UTC+1 in summer)…
assert.equal(todayIn("Europe/Lisbon", new Date("2026-07-01T23:30:00Z")), "2026-07-02");
// …and 01:00 UTC on 2 July is still 1 July in São Paulo (UTC-3).
assert.equal(todayIn("America/Sao_Paulo", new Date("2026-07-02T01:00:00Z")), "2026-07-01");
assert.equal(isValidTimeZone("Europe/Lisbon"), true);
assert.equal(isValidTimeZone("Lisbon"), false);
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

async function rpc(deps: McpDeps, method: string, params: unknown = {}): Promise<{ result?: any; error?: any }> {
  const res = await handleMcpRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    deps,
  );
  assert.equal(res.status, 200, `${method}: HTTP ${res.status} ${await res.clone().text()}`);
  return res.json();
}

const callGetDay = async (deps: McpDeps, args: Record<string, unknown>) => {
  const { result } = await rpc(deps, "tools/call", { name: "get_day", arguments: args });
  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
};

const logged: Record<string, unknown>[] = [];
const deps: McpDeps = { loadData: async () => data, log: (event) => logged.push(event) };

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

// No date and no time zone: ask, don't guess (and don't read Drive for nothing).
{
  let reads = 0;
  const counting: McpDeps = { loadData: async () => (reads++, data) };
  const { body } = await callGetDay(counting, {});
  assert.equal(body.status, "need_timezone");
  assert.equal(reads, 0);
}

assert.equal((await callGetDay(deps, { date: "tomorrow" })).body.status, "invalid_date");
assert.equal((await callGetDay(deps, { date: DAY, timeZone: "Lisbon" })).body.status, "invalid_time_zone");

// The spike's key question: a Drive with no visible file says so plainly.
{
  const missing: McpDeps = {
    loadData: async () => {
      throw new DriveFileNotFoundError("folder");
    },
  };
  const { isError, body } = await callGetDay(missing, { date: DAY });
  assert.equal(isError, false);
  assert.equal(body.status, "no_data_file");
  assert.match(body.message, /habitassistant\.app/);
}

// Logs carry status and timing only, never item data.
assert.ok(logged.length > 0);
for (const event of logged) assert.deepEqual(Object.keys(event).sort(), ["ms", "status", "tool"]);

console.log("mcp: all assertions passed");
