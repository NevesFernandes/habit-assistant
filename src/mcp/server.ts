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
  buildPatch,
  canTakePatch,
  candidate,
  decideLogProgress,
  decideSetDone,
  findItems,
  itemsOf,
  loggable,
  planCreate,
  planUpdate,
  resolveTargets,
  summarize,
  type AnyItem,
  type Decision,
  type ItemKind,
} from "./writeTools.ts";
import { RECURRENCE_SPEC_GRAMMAR } from "../server/recurrenceSpec.ts";
import { DAY_PARTS } from "../lib/dayParts.ts";

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

const CREATE_ITEM_DESCRIPTION = `Creates a habit, a recurring task or a one-off task.
- habit: something the user wants to build or track, with stats and streaks. Needs \`category\` (pick the best fit from the user's categories; "Other" when nothing fits; never ask) and a \`recurrence\`. Tracking (\`completionType\`) is "yesno" unless the user describes an amount ("value", with \`target\` and \`unit\`), a duration ("timer", \`target\` in minutes) or steps ("checklist", with \`checklistItems\`). Never ask how to track it; do ask for the goal amount when they gave none for a number or timer habit.
- recurringTask: a chore or errand that repeats (bins, weekly shopping), done/not done only. Category optional.
- singleTask: a one-off to-do. An unfinished one carries over to the next day unless \`carriesOver\` is false.
Always pick \`dayPart\` yourself from what the item is, even when the user named no time; never ask.
Pass the user's message word for word as \`userMessage\`: the confirmation marks what you assumed from it.
\`startDate\` defaults to today; for a weekday the user named ("from next Tuesday") pass \`startWeekday\` (0 = Sunday) instead of working out the date.
Statuses: "ok": reply with \`confirmation\`, keeping its "Assumed:" line. "needs_confirm": the name is already in use; ask the question, and only after a yes call again with \`confirmDuplicate: true\`. "need_info": ask what \`message\` says, then call again.

recurrence (habits and recurring tasks): ${RECURRENCE_SPEC_GRAMMAR}`;

const UPDATE_ITEM_DESCRIPTION = `Changes an existing item: rename, note, category, part of the day, important (star), start or end date, how often it repeats, a habit's tracking, goal, unit or checklist steps, a recurring task's checklist mode, whether a one-off task carries over. Pass only what changes. Not for done/not done (set_done) or logging amounts (log_progress).
Name the item with \`id\` (from get_day or find_items) or \`name\` (the user's words).
\`newChecklistItems\` replaces a habit's whole list of steps, from today on; earlier days keep theirs. Only when the user names an earlier day, pass it as \`newChecklistItemsFrom\`.
\`newRecurrence\` uses the same format as create_item's \`recurrence\` and replaces the whole rule.
Statuses: "ok": reply with \`confirmation\`. "ambiguous": list the candidates and ask which one, then call again with \`id\`. "rejected" or "need_info": tell or ask the user what \`message\` says.`;

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

function ambiguous(candidates: ReturnType<typeof candidate>[], pick: "ids" | "id" = "ids"): Body {
  return {
    status: "ambiguous",
    message:
      pick === "ids"
        ? "Several items match. List them and ask which one; a reply can pick several. Then call again with `ids`."
        : "Several items match. List them and ask which one, then call again with `id` (once per item if they pick several).",
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

const DAY_PART = z.enum(DAY_PARTS.map((part) => part.id) as [string, ...string[]]);
const START_WEEKDAY_MODE = z.enum(["closest", "next"]);
const COMPLETION_TYPE = z.enum(["yesno", "value", "timer", "checklist"]);
const CHECKLIST_MODE = z.enum(["carryOver", "sameList"]);

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
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
        const item = resolved.items[0];
        if (resolved.status === "ineligible" || !loggable(item)) {
          return { status: "rejected", ...candidate(item), reason: `"${item.name}" isn't tracked with a number or timer, so there's nothing to log. Use set_done.` };
        }
        const decision = decideLogProgress(item, dateISO, today, { value, add });
        const saved = await applyDecisions(deps.store, loaded, today, [decision]);
        return { date: dateISO, today, ...describeResult(saved, decision, dateISO) };
      }),
  );

  server.registerTool(
    "create_item",
    {
      title: "Create an item",
      description: CREATE_ITEM_DESCRIPTION,
      inputSchema: {
        type: ITEM_TYPE,
        name: z.string(),
        userMessage: z.string().describe("The user's message that asked for this, word for word."),
        dayPart: DAY_PART.describe("Part of the day it belongs to. Always set; never ask."),
        category: z.string().optional().describe("Category name. Required for habits."),
        recurrence: z.string().optional().describe("How often it repeats (habits and recurring tasks). See the format in the description."),
        important: z.boolean().optional().describe("Only when the user calls it important or top priority."),
        description: z.string().optional().describe("A note, only when the user gave one."),
        startDate: z.string().optional().describe("YYYY-MM-DD. For a one-off task, the day it's for. Defaults to today."),
        startWeekday: z.number().int().min(0).max(6).optional().describe("A weekday the user named instead of a date, 0 = Sunday."),
        startWeekdayMode: START_WEEKDAY_MODE.optional().describe('"next" for "next Tuesday" (never today); "closest" (default) may be today.'),
        endDate: z.string().optional().describe("YYYY-MM-DD, last day. Only when the user gave one."),
        completionType: COMPLETION_TYPE.optional().describe("Habits only. Defaults to yesno."),
        target: z.number().positive().optional().describe("Goal for value/timer habits (timer: minutes)."),
        unit: z.string().optional().describe('Unit for value habits, e.g. "glasses".'),
        checklistItems: z.array(z.string()).optional().describe("A checklist habit's steps, or the items of a task's checklist."),
        withChecklist: z.boolean().optional().describe("Tasks: give it a checklist even with no items yet."),
        checklistMode: CHECKLIST_MODE.optional().describe('Recurring tasks with a checklist: "carryOver" (unticked items move on, default) or "sameList" (a routine).'),
        carriesOver: z.boolean().optional().describe("One-off tasks: false to drop it at the end of its day if not done."),
        confirmDuplicate: z.boolean().optional().describe("Only after the user said yes to a needs_confirm question."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) =>
      timed(deps, "create_item", async () => {
        const invalid =
          invalidInput(input.startDate, input.timeZone) ??
          (input.endDate !== undefined ? invalidInput(input.endDate, undefined) : undefined);
        if (invalid) return invalid;
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, input.timeZone);
        if (!today) return NEED_TIMEZONE;
        const plan = planCreate(
          loaded.data,
          {
            ...input,
            type: input.type as ItemKind,
            dayPart: input.dayPart as AnyItem["dayPart"] & string,
            completionType: input.completionType as "yesno" | "value" | "timer" | "checklist" | undefined,
            checklistMode: input.checklistMode as "carryOver" | "sameList" | undefined,
            startWeekdayMode: input.startWeekdayMode as "closest" | "next" | undefined,
          },
          today,
        );
        if (plan.status !== "ok") return plan;
        const saved = (await persist(deps.store, loaded, today, plan.add)).data;
        const { item, confirmation } = plan.describe(saved);
        return { status: "ok", today, item: summarize(saved, item, today), confirmation };
      }),
  );

  server.registerTool(
    "update_item",
    {
      title: "Change an item",
      description: UPDATE_ITEM_DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("The item's id, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there's no id."),
        type: ITEM_TYPE.optional().describe("Only when the user said which kind of item."),
        newName: z.string().optional(),
        newDescription: z.string().optional().describe('A note; "" removes it.'),
        newCategory: z.string().optional().describe('Category name; "" removes a task\'s category.'),
        newDayPart: DAY_PART.optional(),
        newImportant: z.boolean().optional(),
        newStartDate: z.string().optional().describe("YYYY-MM-DD; for a one-off task, moves it to that day."),
        newStartWeekday: z.number().int().min(0).max(6).optional().describe("A weekday the user named instead of a date, 0 = Sunday."),
        newStartWeekdayMode: START_WEEKDAY_MODE.optional(),
        newEndDate: z.string().optional().describe('YYYY-MM-DD; "" removes it.'),
        newRecurrence: z.string().optional().describe("Habits and recurring tasks: the whole new rule, same format as create_item."),
        newCompletionType: COMPLETION_TYPE.optional().describe("Habits only."),
        newTarget: z.number().positive().optional().describe("Habits: goal for value/timer (timer: minutes)."),
        newUnit: z.string().optional().describe("Habits: unit for value."),
        newChecklistItems: z.array(z.string()).optional().describe("Habits: the whole new list of steps."),
        newChecklistItemsFrom: z.string().optional().describe("Habits: YYYY-MM-DD, only when the user names an earlier day for new steps."),
        newChecklistMode: CHECKLIST_MODE.optional().describe("Recurring tasks with a checklist."),
        newCarriesOver: z.boolean().optional().describe("One-off tasks: whether it carries over to the next day if not done."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, name, type, timeZone, ...fields }) =>
      timed(deps, "update_item", async () => {
        const dates = [fields.newStartDate, fields.newChecklistItemsFrom, fields.newEndDate || undefined];
        const invalid = invalidInput(undefined, timeZone) ?? dates.map((date) => invalidInput(date, undefined)).find(Boolean);
        if (invalid) return invalid;
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const patch = buildPatch(loaded.data, {
          ...fields,
          newDayPart: fields.newDayPart as AnyItem["dayPart"],
          newStartWeekdayMode: fields.newStartWeekdayMode as "closest" | "next" | undefined,
          newCompletionType: fields.newCompletionType as "yesno" | "value" | "timer" | "checklist" | undefined,
          newChecklistMode: fields.newChecklistMode as "carryOver" | "sameList" | undefined,
        });
        if ("status" in patch) return patch;
        const resolved = resolveTargets(loaded.data, { ids: id ? [id] : undefined, name, type: type as ItemKind | undefined }, canTakePatch(patch));
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
        const plan = planUpdate(loaded.data, resolved.items[0], patch, today);
        if (plan.status !== "ok") return plan;
        const saved = (await persist(deps.store, loaded, today, plan.apply)).data;
        const described = plan.describe(saved);
        if (!described) return { status: "rejected", message: `"${resolved.items[0].name}" was deleted in the meantime.` };
        return { status: "ok", today, item: summarize(saved, described.item, today), confirmation: described.confirmation };
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
