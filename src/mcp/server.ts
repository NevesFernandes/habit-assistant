// The MCP server: tool definitions and the per-request transport. Auth and Drive are
// injected (McpDeps), so tests drive this file with a fake file and no Google at all.
//
// A new McpServer and transport per request, never a module-level one: a shared instance
// can send one user's response to another (MCP SDK 1.26.0 advisory).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppData } from "../types/models.ts";
import { dayItemView, getDay } from "./getDay.ts";
import { isISODate, isValidTimeZone, localTodayISO, todayIn } from "../lib/today.ts";
import { DriveAccessError, DriveConflictError, DriveFileNotFoundError } from "./drive.ts";
import { persist, type FileStore } from "./persist.ts";
import {
  candidate,
  decideLogProgress,
  decideSetDone,
  findItems,
  itemsOf,
  loggable,
  resolveTargets,
  type AnyItem,
  type Decision,
  type ItemKind,
} from "./writeTools.ts";

export interface McpDeps {
  store: FileStore;
  log?: (event: Record<string, unknown>) => void;
}

const INSTRUCTIONS = `Habit Assistant: the user's habits, recurring tasks and one-off tasks, stored in their own Google Drive and shared with the Habit Assistant app.
Act directly; ask a question only when a tool can't run without the answer.
Present days grouped by part of the day (Wake-up, Morning, Work day, Afternoon, Evening, Bedtime), in the order the tool returns them; important items carry a star.`;

const GET_DAY_DESCRIPTION = `What the user has on a given day: habits, recurring tasks and one-off tasks that are due, grouped by part of the day, in the same order as the app's Today tab, with what's done, logged amounts, checklist progress and "N times a week" progress.
For today, call it with no arguments: the user's time zone is stored with their data. Pass \`date\` (YYYY-MM-DD) for another day, and \`timeZone\` (IANA, e.g. "Europe/Lisbon") only when the user says they're somewhere else.
If the result's status is "need_timezone", ask the user which city or time zone they're in, then call again with \`timeZone\`.
Reply briefly: list what's left first, then what's done; mention a part of the day only when it has items. Never invent items that aren't in the result.`;

const FIND_ITEMS_DESCRIPTION = `Looks up the user's habits, recurring tasks and one-off tasks by name, or lists them all, with ids, schedule, part of the day, pause/archive state, goal and checklist.
Use it to answer "what habits do I have?" and to get ids when a name is unclear. Archived items and finished one-off tasks are left out unless \`includeInactive\` is true or they're the only match.`;

const SET_DONE_DESCRIPTION = `Marks items done or not done for a day. It sets, never toggles, so repeating a call is safe.
Name the item with \`name\` (the user's words) or \`ids\` (from get_day or find_items; several ids apply the same change to each, e.g. "both", "all of them"). \`date\` defaults to the user's today.
A number or timer habit marked done gets its full goal logged (a bigger amount already logged is kept); a checklist habit gets every item ticked. For a stated amount use log_progress instead.
Statuses: "ambiguous": list the candidates and ask which one, then call again with \`ids\`. "rejected": tell the user the reason. "needs_confirm": a one-off task set for a later day; ask the question, and only after a yes call again with \`moveToToday: true\`.
Reply in one line with what was recorded (e.g. "with 8 glasses", "all checklist items ticked"); if \`changed\` is false, say it already was.`;

const LOG_PROGRESS_DESCRIPTION = `Logs an amount on a number or timer habit for a day: \`value\` sets the day's total ("I drank 6 glasses"), \`add\` adds to it ("another 2 glasses", "20 more minutes"). Timer habits are in minutes. \`date\` defaults to the user's today; future days are rejected.
Reply in one line with the day's total against the goal, from the returned item.`;

const NEED_TIMEZONE = {
  status: "need_timezone",
  message: "Ask the user which city or time zone they're in, then call again with `timeZone`.",
};

type Body = { status: string } & Record<string, unknown>;

function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function driveFailure(error: unknown): { body: Body; isError: boolean } | undefined {
  if (error instanceof DriveFileNotFoundError) {
    return {
      body: {
        status: "no_data_file",
        message:
          "No Habit Assistant data is visible in this Google Drive. Ask the user to open https://habitassistant.app once with the same Google account, then try again.",
      },
      isError: false,
    };
  }
  if (error instanceof DriveAccessError) {
    return {
      body: {
        status: "drive_access_denied",
        message: "Google Drive refused access. Ask the user to disconnect and reconnect Habit Assistant in Claude's connector settings.",
      },
      isError: true,
    };
  }
  if (error instanceof DriveConflictError) {
    return {
      body: {
        status: "conflict",
        message: "The data kept changing in the Habit Assistant app while saving, so nothing was saved. Tell the user and try again.",
      },
      isError: true,
    };
  }
  return undefined;
}

/** Runs a tool body with timing, Drive error mapping and a log line (status and timing only: never item data). */
async function timed(deps: McpDeps, tool: string, run: () => Promise<Body>): Promise<CallToolResult> {
  const started = Date.now();
  let status = "error";
  try {
    const body = await run();
    status = body.status;
    return json(body, body.status.startsWith("invalid_"));
  } catch (error) {
    const failure = driveFailure(error);
    if (!failure) throw error;
    status = failure.body.status;
    return json(failure.body, failure.isError);
  } finally {
    deps.log?.({ tool, status, ms: Date.now() - started });
  }
}

function invalidInput(date: string | undefined, timeZone: string | undefined): Body | undefined {
  if (date !== undefined && !isISODate(date)) return { status: "invalid_date", message: `"${date}" is not a YYYY-MM-DD date.` };
  if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
    return { status: "invalid_time_zone", message: `"${timeZone}" is not an IANA time zone name.` };
  }
  return undefined;
}

/** §62: the app stores the device's time zone; a stated one wins; a broken stored one is ignored. */
function userToday(data: AppData, timeZone: string | undefined): string | undefined {
  const stored = data.timeZone && isValidTimeZone(data.timeZone) ? data.timeZone : undefined;
  const zone = timeZone ?? stored;
  return zone ? todayIn(zone) : undefined;
}

const ITEM_TYPE = z.enum(["habit", "recurringTask", "singleTask"]);
const DATE = z.string().optional().describe("YYYY-MM-DD in the user's local calendar. Defaults to today.");
const TIME_ZONE = z.string().optional().describe('The user\'s IANA time zone, e.g. "Europe/Lisbon". Only when they say they\'re somewhere else.');

function ambiguous(candidates: ReturnType<typeof candidate>[]): Body {
  return {
    status: "ambiguous",
    message: "Several items match. List them and ask which one; a reply can pick several. Then call again with `ids`.",
    candidates,
  };
}

/** One result per item; ok ones carry the item as saved, in get_day's shape. */
function describeResult(saved: AppData, decision: Decision, dateISO: string): Body {
  if (decision.status === "rejected") return { status: "rejected", ...candidate(decision.item), reason: decision.reason };
  if (decision.status === "needs_confirm") return { status: "needs_confirm", ...candidate(decision.item), question: decision.question };
  const item = itemsOf(saved).find((entry) => entry.id === decision.item.id);
  if (!item) return { status: "rejected", ...candidate(decision.item), reason: `"${decision.item.name}" was deleted in the meantime.` };
  return { status: "ok", changed: decision.changed, item: dayItemView(saved, item, item.kind === "singleTask" ? item.startDate : dateISO) };
}

/** Saves every allowed change in one write, replayed together on a conflict. */
async function applyDecisions(store: FileStore, loaded: Awaited<ReturnType<FileStore["load"]>>, todayISO: string, decisions: Decision[]) {
  const mutations = decisions.flatMap((decision) => (decision.status === "ok" && decision.changed && decision.mutate ? [decision.mutate] : []));
  if (mutations.length === 0) return loaded.data;
  return (await persist(store, loaded, todayISO, (data) => mutations.reduce((next, mutate) => mutate(next), data))).data;
}

export function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "habit-assistant", version: "0.2.0" },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    "get_day",
    {
      title: "Get a day",
      description: GET_DAY_DESCRIPTION,
      inputSchema: {
        date: z.string().optional().describe("The day to show, YYYY-MM-DD, in the user's local calendar. Defaults to today."),
        timeZone: z.string().optional().describe('The user\'s IANA time zone, e.g. "Europe/Lisbon".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ date, timeZone }) =>
      timed(deps, "get_day", async () => {
        const invalid = invalidInput(date, timeZone);
        if (invalid) return invalid;
        const { data } = await deps.store.load();
        const today = userToday(data, timeZone);
        const target = date ?? today;
        if (!target) return NEED_TIMEZONE;
        return { status: "ok", ...getDay(data, target, today) };
      }),
  );

  server.registerTool(
    "find_items",
    {
      title: "Find items",
      description: FIND_ITEMS_DESCRIPTION,
      inputSchema: {
        query: z.string().optional().describe("A name or the user's words for it. Omit to list everything."),
        type: ITEM_TYPE.optional().describe("Only this kind of item."),
        includeInactive: z.boolean().optional().describe("Also archived habits/recurring tasks and finished one-off tasks."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query, type, includeInactive, timeZone }) =>
      timed(deps, "find_items", async () => {
        const invalid = invalidInput(undefined, timeZone);
        if (invalid) return invalid;
        const { data } = await deps.store.load();
        // Today only decides what counts as archived or paused, so without a known zone the
        // UTC date stands in: at worst an item archived today shows a day late.
        const today = userToday(data, timeZone) ?? localTodayISO();
        return { status: "ok", items: findItems(data, today, { query, type: type as ItemKind | undefined, includeInactive }) };
      }),
  );

  server.registerTool(
    "set_done",
    {
      title: "Mark done or not done",
      description: SET_DONE_DESCRIPTION,
      inputSchema: {
        ids: z.array(z.string()).optional().describe("Item ids, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there are no ids."),
        type: ITEM_TYPE.optional().describe("Only when the user said which kind of item."),
        date: DATE,
        done: z.boolean().optional().describe("false marks it not done. Defaults to true."),
        moveToToday: z.boolean().optional().describe("Only after the user said yes to a needs_confirm question."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ ids, name, type, date, done = true, moveToToday = false, timeZone }) =>
      timed(deps, "set_done", async () => {
        const invalid = invalidInput(date, timeZone);
        if (invalid) return invalid;
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const dateISO = date ?? today;
        // A finished one-off task only matches "mark it not done", so last week's "Call mom"
        // doesn't make today's ambiguous.
        const resolved = resolveTargets(
          loaded.data,
          { ids, name, type: type as ItemKind | undefined },
          (item: AnyItem) => item.kind !== "singleTask" || item.done !== done,
        );
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates);
        const decisions = resolved.items.map((item) => decideSetDone(loaded.data, item, dateISO, today, done, moveToToday));
        const saved = await applyDecisions(deps.store, loaded, today, decisions);
        const results = decisions.map((decision) => describeResult(saved, decision, dateISO));
        const statuses = new Set(results.map((result) => result.status));
        return { status: statuses.size === 1 ? results[0].status : "partial", date: dateISO, today, results };
      }),
  );

  server.registerTool(
    "log_progress",
    {
      title: "Log an amount",
      description: LOG_PROGRESS_DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("The habit's id, from get_day or find_items."),
        name: z.string().optional().describe("The habit's name in the user's words, when there's no id."),
        value: z.number().min(0).optional().describe("The day's new total."),
        add: z.number().optional().describe("An amount to add to the day's total (negative to take some off)."),
        date: DATE,
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ id, name, value, add, date, timeZone }) =>
      timed(deps, "log_progress", async () => {
        const invalid = invalidInput(date, timeZone);
        if (invalid) return invalid;
        if ((value === undefined) === (add === undefined)) return { status: "invalid_amount", message: "Pass exactly one of `value` or `add`." };
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const dateISO = date ?? today;
        const resolved = resolveTargets(loaded.data, { ids: id ? [id] : undefined, name, type: "habit" }, loggable);
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates);
        const item = resolved.items[0];
        if (resolved.status === "ineligible" || !loggable(item)) {
          return { status: "rejected", ...candidate(item), reason: `"${item.name}" isn't tracked with a number or timer, so there's nothing to log. Use set_done.` };
        }
        const decision = decideLogProgress(item, dateISO, today, { value, add });
        const saved = await applyDecisions(deps.store, loaded, today, [decision]);
        return { date: dateISO, today, ...describeResult(saved, decision, dateISO) };
      }),
  );

  return server;
}

/** Answers one MCP HTTP request (streamable HTTP, stateless, JSON responses). */
export async function handleMcpRequest(request: Request, deps: McpDeps): Promise<Response> {
  const server = buildServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
