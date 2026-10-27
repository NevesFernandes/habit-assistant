// §72: a period as a CSV (src/lib/exportCsv.ts), and the app's chat reply with its Download
// attachment, which never goes to the model. Run: npm run test:exportCsv
import assert from "node:assert/strict";
import { buildExportCsv, EXPORT_COLUMNS, exportRefusal } from "./exportCsv.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentHistoryMessage, AgentToolCall } from "./agentClient.ts";
import { withoutDownloads } from "../server/agentHistory.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-10-27";
const habit = (id: string, fields: Partial<Habit> = {}): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning",
  startDate: "2026-10-25", recurrence: { type: "daily" }, completionType: "yesno", ...fields,
});
const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [habit("Floss", { dayPart: "bedtime" }), habit("Water", { completionType: "value", target: 8, unit: "glasses" })],
  recurringTasks: [],
  singleTasks: [{ kind: "singleTask", id: "bank", name: "Call the bank, \"urgent\"", startDate: TODAY, done: false, persistency: true }],
  completionLog: [
    { id: "1", itemId: "Floss", date: "2026-10-25" },
    { id: "2", itemId: "Water", date: "2026-10-25", value: 5 },
  ],
  notes: [{ id: "n", itemId: "Floss", date: "2026-10-26", text: "gums sore,\nskipped" }],
};

const file = buildExportCsv(data, "2026-10-25", "2026-10-31", TODAY);
const lines = file.csv.split("\r\n");
assert.equal(lines[0], EXPORT_COLUMNS.join(","));
// Cut at today: an export is a record, never days to come.
assert.deepEqual([file.from, file.to, file.filename], ["2026-10-25", TODAY, "habit-assistant-2026-10-25-to-2026-10-27.csv"]);
assert.equal(file.rows, 7); // 3 days × 2 habits, plus the task today
assert.ok(lines.includes("2026-10-25,Water,habit,Health,Morning,missed,5,8,glasses,,"));
assert.ok(lines.includes("2026-10-25,Floss,habit,Health,Bedtime,done,,,,,"));
// Commas, quotes and line breaks are quoted.
assert.ok(file.csv.includes('2026-10-26,Floss,habit,Health,Bedtime,missed,,,,,"gums sore,\nskipped"'));
assert.ok(file.csv.includes('2026-10-27,"Call the bank, ""urgent""",one-off task,,,to do today,,,,,'));
assert.equal(lines.at(-1), "");

assert.equal(exportRefusal("2026-10-28", "2026-10-31", TODAY), "That period hasn't started yet, so there's nothing to export.");
assert.match(exportRefusal("2025-01-01", "2026-10-27", TODAY)!, /more than a year/);
assert.equal(exportRefusal("2026-10-01", "2026-10-31", TODAY), undefined);
assert.equal(buildExportCsv(data, "2026-09-01", "2026-09-30", TODAY).rows, 0);

// The engine: no period named → asks; a period → the reply carries the file.
{
  let input: Record<string, unknown> = {};
  let sent: AgentHistoryMessage[] = [];
  const session = new ChatSession({
    getData: () => data,
    persist: async () => true,
    callAgent: async (messages) => {
      sent = messages;
      return { toolCall: { id: String(sent.length), name: "exportCsv", input } as AgentToolCall & { id: string } };
    },
    todayISO: () => TODAY,
  });
  const last = () => session.messages.filter((m) => m.role === "assistant").pop()!;
  await session.send("export my data");
  assert.match(last().content!, /^Which period should I export\?/);
  input = { from: "2026-10-01", to: "2026-10-31" };
  await session.send("October");
  const reply = last();
  assert.match(reply.content!, /^Your spreadsheet for .* \(up to today; later days haven't happened yet\): 7 rows, one per item per day\. Tap Download to save it\.$/);
  assert.equal(reply.role === "assistant" && reply.download?.filename, "habit-assistant-2026-10-01-to-2026-10-27.csv");
  // The session keeps the file for the button; sendMessage strips it before the model.
  await session.send("thanks");
  assert.ok(sent.some((m) => m.role === "assistant" && m.download));
  const stripped = withoutDownloads(sent);
  assert.equal(stripped.some((m) => m.role === "assistant" && "download" in m), false);
  assert.equal(stripped.length, sent.length);
}

console.log("exportCsv: all assertions passed");
