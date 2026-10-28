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
import { weekStartOf, type AppData } from "../types/models.ts";
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
import { resolveCategoryId, rolloverPersistentTasks, withTimeZone } from "../lib/dataStore.ts";
import { describeReset, describeResetQuestion, resetRefusal, resetStats, resetTargets, type ResetScope } from "../lib/statsReset.ts";
import { getHistory, HISTORY_MAX_DAYS, historyRangeDays } from "../lib/history.ts";
import { summarizeHistory } from "../lib/historySummary.ts";
import { NOTE_MAX_LENGTH, setDayNote } from "../lib/dayNotes.ts";
import {
  canTakeChecklistOp,
  categoryStats,
  checklistIneligible,
  habitStats,
  itemStats,
  taskStats,
  HANDLERS,
  overallStats,
  planChecklist,
  planDelete,
  planSchedule,
  planSkip,
  type Change,
  type ChecklistOp,
  type Plan,
  type ScheduleOp,
} from "./manageTools.ts";
import { DAY_PARTS } from "../lib/dayParts.ts";

export interface McpDeps {
  store: FileStore;
  log?: (event: Record<string, unknown>) => void;
}

const INSTRUCTIONS = `Habit Assistant: the user's habits, routines, chores and to-dos (habits, recurring tasks and one-off tasks), stored in their own Google Drive and shared with the Habit Assistant app.
For any question about the user's day, plans or to-dos ("what's on today?", "what do I have left?", "what's planned for tomorrow?"), call get_day. Calendar events aren't in it: when a calendar is connected too, use both.
Act directly; ask a question only when a tool can't run without the answer.
Present days grouped by part of the day (Wake-up, Morning, Work day, Afternoon, Evening, Bedtime), in the order the tool returns them; important items carry a star.`;

const GET_DAY_DESCRIPTION = `The user's to-do list and habits for a day. Use it for "what's on today?", "what do I have to do?", "what's left?", "did I do X today?", "what's planned tomorrow?". It holds habits, recurring tasks and one-off tasks due that day, grouped by part of the day in the same order as the app's Today tab, with what's done, logged amounts, checklist progress and "N times a week" progress. Calendar events aren't in it.
For today, call it with no arguments: the user's time zone is stored with their data. Pass \`date\` (YYYY-MM-DD) for another day. When the user says they're somewhere else now, save it with settings' \`timeZone\` so it sticks.
If the result's status is "need_timezone", ask the user which city or time zone they're in, save it with settings, and try again.
Reply briefly: list what's left first, then what's done; mention a part of the day only when it has items. Never invent items that aren't in the result.`;

const SETTINGS_DESCRIPTION = `Shows or changes the user's Habit Assistant settings. With nothing set it shows them.
- \`weekStartsOn\`: "sunday" or "monday", the first day of the week ("start my week on Monday"); "this week" and weekly counts follow it.
- \`readAloud\`: whether the app reads its replies aloud, set on every device the user has ("turn off read-aloud").
- \`timeZone\`: an IANA name ("Asia/Tokyo") saved as the user's time zone, which decides what "today" is for every tool. Use it when the user says where they are now ("I'm in Tokyo this week"), or answers a need_timezone question. The app also sets it from the phone's clock when opened.
API keys, the chat provider and voice transcription change only in the app's Settings, never here: never ask for a key. Reply in one line with \`message\` (or the new today).`;

const CATEGORIES_DESCRIPTION = `The user's categories. op "list": each with how many habits and tasks use it. op "add": a new category called \`name\` (the app gives it a plain icon; the user can pick another in the app). To put items in a category, use update_items.`;

const SET_NOTE_DESCRIPTION = `Adds, replaces or removes the note on one day of an item, without marking anything: "add a note to today's run: legs tired", "note for tomorrow's gym: bring a towel", "remove the note from yesterday's gym". One note per item per day; a new one replaces it; \`note: ""\` removes it. A note can also ride on set_done or log_progress. Reply in one line with \`message\`.`;

const UNDO_DESCRIPTION = `Undoes the last change made through Habit Assistant from Claude, today: "undo that", "take that back". Any change, a delete included (the item comes back with its history), even a whole set of items. Refused if those items changed since (in the app or here), or if the change was made on an earlier day. Changes made in the app's own chat are undone there. Tell the user what \`message\` says was put back.`;

const FIND_ITEMS_DESCRIPTION = `Looks up the user's habits, recurring tasks and one-off tasks by name, or lists them all, with ids, schedule, part of the day, pause/archive state, goal and checklist.
Use it to answer "what habits do I have?" and to get ids when a name is unclear. Archived items and finished one-off tasks are left out unless \`includeInactive\` is true or they're the only match.`;

const SET_DONE_DESCRIPTION = `Marks items done or not done for a day. It sets, never toggles, so repeating a call is safe.
Name the item with \`name\` (the user's words) or \`ids\` (from get_day or find_items; several ids apply the same change to each, e.g. "both", "all of them"). \`date\` defaults to the user's today.
Several at once by the user's words: \`names\` ("floss and water"), or filters \`dayPart\`, \`category\`, \`type\` ("all my morning habits"), or \`all: true\` for everything (that asks first: status "needs_confirm", then call again with \`confirm: true\`). Items it doesn't fit (not due that day, already done) are left out and named in \`message\`.
A number or timer habit marked done gets its full goal logged (a bigger amount already logged is kept); a checklist habit gets every item ticked. For a stated amount use log_progress instead.
Statuses: "ambiguous": list the candidates and ask which one, then call again with \`ids\`. "rejected": tell the user the reason. "needs_confirm": a one-off task set for a later day; ask the question, and only after a yes call again with \`moveToToday: true\`.
Pass \`note\` when the user adds a detail about it ("5 km, legs tired"); it's kept with that day's completion. If the result has \`noteNotSaved\`, say why.
Reply in one line with what was recorded (e.g. "with 8 glasses", "all checklist items ticked"); if \`changed\` is false, say it already was.`;

const LOG_PROGRESS_DESCRIPTION = `Logs an amount on a number or timer habit for a day: \`value\` sets the day's total ("I drank 6 glasses"), \`add\` adds to it ("another 2 glasses", "20 more minutes"). Timer habits are in minutes. \`date\` defaults to the user's today; future days are rejected.
Pass \`note\` when the user adds a detail ("felt easy today"); it's kept with that day. If the result has \`noteNotSaved\`, say why.
Reply in one line with the day's total against the goal, from the returned item.`;

const CREATE_ITEMS_DESCRIPTION = `Creates a habit, a recurring task or a one-off task: its fields at the top level. Or several new items at once (\`items\`, each with the same fields, and \`packName\`), described below.
- habit: something the user wants to build or track, with stats and streaks. Needs \`category\` (pick the best fit from the user's categories; "Other" when nothing fits; never ask) and a \`recurrence\`. Tracking (\`completionType\`) is "yesno" unless the user describes an amount ("value", with \`target\` and \`unit\`), a duration ("timer", \`target\` in minutes) or steps ("checklist", with \`checklistItems\`). Never ask how to track it; do ask for the goal amount when they gave none for a number or timer habit.
- recurringTask: a chore or errand that repeats (bins, weekly shopping), done/not done only. Category optional.
- singleTask: a one-off to-do. An unfinished one carries over to the next day unless \`carriesOver\` is false.
Always pick \`dayPart\` yourself from what the item is, even when the user named no time; never ask.
Pass the user's message word for word as \`userMessage\`: the confirmation marks what you assumed from it.
\`startDate\` defaults to today; for a weekday the user named ("from next Tuesday") pass \`startWeekday\` (0 = Sunday) instead of working out the date.
Statuses: "ok": reply with \`confirmation\`, keeping its "Assumed:" line. "needs_confirm": the name is already in use; ask the question, and only after a yes call again with \`confirmDuplicate: true\`. "need_info": ask what \`message\` says, then call again.
Several at once ("set me up a morning routine", "help me get fit for a 10K"): build the set for this user from what they said (goals, schedule, level); if the request is broad and you know nothing about them, ask one short question first. Usually 3 to 8 items, at most 10. Items the user already has are left out. The first call adds nothing: it returns "needs_confirm" with the list as \`question\`; show it, drop any items the user doesn't want, and only after a yes call again with the remaining items and \`confirm: true\`. They all start on the same day (\`startDate\` on the items, or today).

recurrence (habits and recurring tasks): ${RECURRENCE_SPEC_GRAMMAR}`;

const UPDATE_ITEMS_DESCRIPTION = `Changes an existing item: rename, note, category, part of the day, important (star), start or end date, how often it repeats, a habit's tracking, goal, unit or checklist steps, a recurring task's checklist mode, whether a one-off task carries over. Pass only what changes. Not for done/not done (set_done) or logging amounts (log_progress).
Name the item with \`id\` (from get_day or find_items) or \`name\` (the user's words).
\`newChecklistItems\` replaces a habit's whole list of steps, from today on; earlier days keep theirs. Only when the user names an earlier day, pass it as \`newChecklistItemsFrom\`.
\`newRecurrence\` uses the same format as create_items' \`recurrence\` and replaces the whole rule.
Statuses: "ok": reply with \`confirmation\`. "ambiguous": list the candidates and ask which one, then call again with \`id\`. "rejected" or "need_info": tell or ask the user what \`message\` says.
One change on several items ("move all my Sports habits to the evening", "make gym and run Mon, Wed, Fri"): choose them with \`names\`, or filters \`dayPart\`, \`category\`, \`type\`, or \`all: true\` (asks first: "needs_confirm", then \`confirm: true\`). Only \`newDayPart\`, \`newImportant\`, \`newCategory\` and \`newRecurrence\` change several at once. Items already like that, or a one-off task given a repeat rule, are left out and named. Reply with \`message\`.`;

const CHECKLIST_DESCRIPTION = `A checklist on an item: a habit's steps, or the list on a task (e.g. a weekly shopping list).
- op "add": add \`items\` to a task's list (gives a task without one its first list). Habits' steps change with update_items instead.
- op "tick" / "untick": check items off or back on, for \`date\` (default today; a recurring task and a habit have a list per day). Each item is matched by the user's words.
- op "remove": take \`items\` off for good, from today on (or an earlier \`date\` the user named); earlier days keep them. A checklist habit keeps at least one step.
- op "remove_all": take the whole list off a task, which stays as a plain task. Asks first when it has items: ask the question, and only after a yes call again with \`confirm: true\`.
Name the item with \`id\` or \`name\`. After ticking a task's last item, offer (never force) to mark the task done with set_done. Reply in one line with \`message\`.`;

const SCHEDULE_DESCRIPTION = `Pauses, skips, resumes or archives a habit or recurring task (not one-off tasks: delete those instead).
- op "pause": from \`from\` (default today; never a past day) until \`resumeOn\`, the first day back (omit for open-ended). Paused days count as neither done nor missed, so streaks survive. A new pause replaces one that's running or upcoming.
- op "skip": one excused day (\`date\`, default today or later, never past) that counts as neither done nor missed, lighter than a pause ("I'm sick today, skip gym"). op "unskip" takes it back.
- op "resume": due again from today; cancels an upcoming pause; also brings back an archived item.
- op "archive": no more occurrences after today; the history and stats stay. For "stop tracking it". op "unarchive" brings it back: due from today, and the days it was archived count as paused, not missed. Erasing it with its history is delete_items.
Several at once (pause, skip, resume): \`names\`, or filters \`dayPart\`, \`category\`, \`type\`, or \`all: true\` (asks first: "needs_confirm", then \`confirm: true\`); items it doesn't fit are left out and named.
Reply in one line with \`message\`.`;

const GET_HISTORY_DESCRIPTION = `What happened over a period, day by day: what was due, done, missed, skipped or paused, logged amounts and notes, with a summary. Use it for "how did my week go?", "when did I last go to the dentist?", "how many times did I run in October?", and to plan ahead.
\`from\` and \`to\` are YYYY-MM-DD, both included. Limit it to one item with \`id\` or \`name\`, or to one kind with \`type\`. For a single day, get_day is enough.
- \`view: "missed"\`: only the misses, plus one-off tasks still carried over, and up to two \`suggestions\` to put to the user ("what did I miss?"). \`from\`/\`to\` optional: without them it uses this week up to yesterday, and \`period\` says so; tell the user which period. Never offer to mark missed days done: the app looks forward.
- \`format: "csv"\`: the period as a spreadsheet ("export my October"), the same file the app gives; give \`csv\` to the user as a file named \`filename\`, unchanged. Ask which period if the user didn't say. At most 3,000 rows.`;

const DELETE_DESCRIPTION = `Permanently deletes items and, for habits and recurring tasks, all their history. Prefer schedule's archive when the user only wants to stop an item.
It asks first (status "needs_confirm", with details of each item): ask the user the question word for word, and only after a yes call again with the same items and \`confirm: true\`. One one-off task named by the user goes without asking.`;

const GET_STATS_DESCRIPTION = `Stats, as in the app's stats tab: for a habit, streak, best streak, completion % and counts this week, month, year and all time; recurring and one-off tasks have their own.
- scope "item": one habit or task, by \`id\` or \`name\`. \`streakUnit\` says whether streaks count days, weeks or months.
- scope "category": the items in \`category\` (its name), together.
- scope "overall": everything, plus each category.
\`type\` limits category or overall to one kind of item.`;

const RESET_STATS_DESCRIPTION = `Starts stats over, from today, for one item, a category or everything (\`type\` limits it to one kind of item). Nothing is erased: the history stays (the app's heatmap still shows it), only the counting restarts. Not for deleting an item (delete_items) or a single day's tick (set_done).
It asks first (status "needs_confirm"): ask the user the question word for word, and only after a yes call again with the same arguments and \`confirm: true\`. The best streak always stays from here; resetting it too is only in the app.
\`undo: true\` (with the same scope) puts the counting back as it was before the last reset ("undo the reset of my gym stats"); it doesn't ask.`;


const NEED_TIMEZONE = {
  status: "need_timezone",
  message: "Ask the user which city or time zone they're in, save it with settings' timeZone, then try again.",
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
const TIME_ZONE = z
  .string()
  .optional()
  .describe('The user\'s IANA time zone for this call only, e.g. "Europe/Lisbon". To change it for good, use settings.');

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

/** §67: an allowed change also saves the note on that day (even when nothing else changes). */
function withNote(decision: Decision, note: string | undefined, dateISO: string): Decision {
  const text = note?.trim().slice(0, NOTE_MAX_LENGTH);
  if (!text || decision.status !== "ok") return decision;
  const mutate = decision.mutate;
  return {
    ...decision,
    changed: true,
    mutate: (data) => setDayNote(mutate && decision.changed ? mutate(data) : data, decision.item.id, dateISO, text),
  };
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

/** Saves an allowed change and reports it; a refusal or a question goes back as is. */
async function runPlan(
  store: FileStore,
  loaded: Awaited<ReturnType<FileStore["load"]>>,
  today: string,
  plan: Plan,
): Promise<Body> {
  if (plan.status !== "ok") return plan;
  const saved = (await persist(store, loaded, today, (plan as Change).apply, { recordUndo: (plan as Change).recordUndo })).data;
  const { message, ownerId, date } = (plan as Change).describe(saved);
  const owner = ownerId ? itemsOf(saved).find((item) => item.id === ownerId) : undefined;
  return {
    status: "ok",
    today,
    message,
    ...(owner ? { item: dayItemView(saved, owner, owner.kind === "singleTask" ? owner.startDate : (date ?? today)) } : {}),
  };
}

/** §80: runs one of manageTools' handlers: a read comes back as is; a change waits for the user's zone, then saves. */
async function runHandler(deps: McpDeps, name: string, args: Record<string, unknown>, timeZone: string | undefined): Promise<Body> {
  const invalid = invalidInput(undefined, timeZone);
  if (invalid) return invalid;
  const loaded = await deps.store.load();
  const today = userToday(loaded.data, timeZone);
  const outcome = HANDLERS[name].run(loaded.data, args, today ?? localTodayISO());
  if ("result" in outcome) return { status: "ok", ...outcome.result };
  if (!today) return NEED_TIMEZONE;
  return runPlan(deps.store, loaded, today, outcome);
}

// §75/§78/§80: choosing several items by the user's words, shared by set_done, schedule and update_items.
const MANY = {
  names: z.array(z.string()).optional().describe("Several items by the user's words, e.g. [\"floss\", \"water\"]."),
  dayPart: DAY_PART.optional().describe("Several: every item in this part of the day."),
  category: z.string().optional().describe("Several: every item in this category (its name)."),
  all: z.boolean().optional().describe("Several: every item (narrowed by type, if given). Asks first."),
  confirm: z.boolean().optional().describe("Only after the user said yes to a needs_confirm question."),
};
type ManyInput = { names?: string[]; dayPart?: string; category?: string; all?: boolean; type?: string };
const isMany = (input: ManyInput) => !!(input.names?.length || input.dayPart || input.category || input.all);
const manyArgs = (input: ManyInput) => ({ names: input.names, dayPart: input.dayPart, category: input.category, kind: input.type });

const NOTE = z.string().optional().describe('A short note for that day, in the user\'s words, e.g. "5 km, legs tired". Only when they gave one.');
const CHECKLIST_OP = z.enum(["add", "tick", "untick", "remove", "remove_all"]);

export function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "habit-assistant", version: "0.3.0" },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    "get_day",
    {
      title: "Get a day",
      description: GET_DAY_DESCRIPTION,
      inputSchema: {
        date: z.string().optional().describe("The day to show, YYYY-MM-DD, in the user's local calendar. Defaults to today."),
        timeZone: TIME_ZONE,
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
        note: NOTE,
        ...MANY,
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ ids, name, type, date, done = true, moveToToday = false, note, names, dayPart, category, all, confirm, timeZone }) =>
      timed(deps, "set_done", async () => {
        const invalid = invalidInput(date, timeZone);
        if (invalid) return invalid;
        // §75: several by the user's words or a filter.
        if (isMany({ names, dayPart, category, all })) {
          return runHandler(deps, "apply_to_many", { action: done ? "done" : "undone", ...manyArgs({ names, dayPart, category, type }), date, confirm }, timeZone);
        }
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
        const decisions = resolved.items
          .map((item) => decideSetDone(loaded.data, item, dateISO, today, done, moveToToday))
          // §67: each item's note on that day (a one-off task's on today) rides in the same save.
          .map((decision) => withNote(decision, note, decision.item.kind === "singleTask" ? today : dateISO));
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
        note: NOTE,
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ id, name, value, add, date, note, timeZone }) =>
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
        const decision = withNote(decideLogProgress(item, dateISO, today, { value, add }), note, dateISO);
        const saved = await applyDecisions(deps.store, loaded, today, [decision]);
        return { date: dateISO, today, ...describeResult(saved, decision, dateISO) };
      }),
  );

  server.registerTool(
    "checklist",
    {
      title: "Change a checklist",
      description: CHECKLIST_DESCRIPTION,
      inputSchema: {
        op: CHECKLIST_OP,
        id: z.string().optional().describe("The item's id, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there's no id."),
        items: z.array(z.string()).optional().describe("The checklist items, one entry each, in the user's words."),
        date: DATE,
        confirm: z.boolean().optional().describe("remove_all only, after the user said yes."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ op, id, name, items, date, confirm, timeZone }) =>
      timed(deps, "checklist", async () => {
        const invalid = invalidInput(date, timeZone);
        if (invalid) return invalid;
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const checklistOp = op as ChecklistOp;
        const resolved = resolveTargets(loaded.data, { ids: id ? [id] : undefined, name }, canTakeChecklistOp(checklistOp));
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
        const owner = resolved.items[0];
        if (resolved.status === "ineligible" || !canTakeChecklistOp(checklistOp)(owner)) return checklistIneligible(checklistOp, resolved.items);
        return runPlan(deps.store, loaded, today, planChecklist(owner, checklistOp, { items, date, confirm }, today));
      }),
  );

  server.registerTool(
    "schedule",
    {
      title: "Pause, skip, resume or archive",
      description: SCHEDULE_DESCRIPTION,
      inputSchema: {
        op: z.enum(["pause", "skip", "unskip", "resume", "archive", "unarchive"]),
        id: z.string().optional().describe("The item's id, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there's no id."),
        from: z.string().optional().describe("pause: first paused day, YYYY-MM-DD. Defaults to today."),
        resumeOn: z.string().optional().describe("pause: first day back, YYYY-MM-DD. Omit for open-ended."),
        date: z.string().optional().describe("skip, unskip: the day, YYYY-MM-DD. Defaults to today."),
        type: ITEM_TYPE.optional().describe("Several: only this kind of item."),
        ...MANY,
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ op, id, name, from, resumeOn, date, type, names, dayPart, category, all, confirm, timeZone }) =>
      timed(deps, "schedule", async () => {
        const invalid = invalidInput(from, timeZone) ?? invalidInput(resumeOn, undefined) ?? invalidInput(date, undefined);
        if (invalid) return invalid;
        if (isMany({ names, dayPart, category, all })) {
          if (op !== "pause" && op !== "skip" && op !== "resume") {
            return { status: "rejected", message: `"${op}" works on one item at a time; call it once per item.` };
          }
          return runHandler(deps, "apply_to_many", { action: op, ...manyArgs({ names, dayPart, category, type }), date, from, resumeOn, confirm }, timeZone);
        }
        if (op === "unskip") return runHandler(deps, "unskip", { id, name, date }, timeZone);
        if (op === "unarchive") return runHandler(deps, "unarchive", { id, name }, timeZone);
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const recurring = (item: AnyItem) => item.kind !== "singleTask";
        const resolved = resolveTargets(loaded.data, { ids: id ? [id] : undefined, name }, recurring);
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
        const item = resolved.items[0];
        if (item.kind === "singleTask") {
          return { status: "rejected", message: `"${item.name}" is a one-off task, which can't be paused, skipped or archived. It can be moved to another day (update_items) or deleted.` };
        }
        if (op === "skip") return runPlan(deps.store, loaded, today, planSkip(loaded.data, item, date ?? today, today));
        return runPlan(deps.store, loaded, today, planSchedule(item, op as ScheduleOp, { from, resumeOn }, today));
      }),
  );

  server.registerTool(
    "delete_items",
    {
      title: "Delete items",
      description: DELETE_DESCRIPTION,
      inputSchema: {
        ids: z.array(z.string()).optional().describe("Item ids, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there are no ids."),
        type: ITEM_TYPE.optional().describe("Only when the user said which kind of item."),
        confirm: z.boolean().optional().describe("Only after the user said yes to the needs_confirm question."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ ids, name, type, confirm = false, timeZone }) =>
      timed(deps, "delete_items", async () => {
        const invalid = invalidInput(undefined, timeZone);
        if (invalid) return invalid;
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        const resolved = resolveTargets(loaded.data, { ids, name, type: type as ItemKind | undefined });
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates);
        const byName = !(ids && ids.length > 0);
        return runPlan(deps.store, loaded, today, planDelete(loaded.data, resolved.items, byName, confirm, today));
      }),
  );

  server.registerTool(
    "get_history",
    {
      title: "Get history",
      description: GET_HISTORY_DESCRIPTION,
      inputSchema: {
        from: z.string().optional().describe("First day, YYYY-MM-DD. Required except for view missed."),
        to: z.string().optional().describe("Last day, YYYY-MM-DD. Required except for view missed."),
        id: z.string().optional().describe("Only this item, by id."),
        name: z.string().optional().describe("Only this item, in the user's words."),
        type: ITEM_TYPE.optional().describe("Only this kind of item."),
        view: z.enum(["days", "missed"]).optional().describe('"missed": only the misses and carried-over tasks. Default "days".'),
        format: z.enum(["json", "csv"]).optional().describe('"csv": the period as a spreadsheet file.'),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ from, to, id, name, type, view, format, timeZone }) =>
      timed(deps, "get_history", async () => {
        const invalid = invalidInput(from, timeZone) ?? invalidInput(to, undefined);
        if (invalid) return invalid;
        // §73 and §72, folded in by §80.
        if (view === "missed") return runHandler(deps, "missed", { from, to }, timeZone);
        if (format === "csv") return runHandler(deps, "export", { from, to }, timeZone);
        if (!from || !to) return { status: "invalid_date", message: "Pass `from` and `to` (YYYY-MM-DD)." };
        if (to < from) return { status: "invalid_date", message: "`to` is before `from`." };
        if (historyRangeDays(from, to) > HISTORY_MAX_DAYS) {
          return { status: "rejected", message: `That's more than ${HISTORY_MAX_DAYS} days. Ask for a shorter period, or one item.` };
        }
        const { data: stored } = await deps.store.load();
        const today = userToday(stored, timeZone);
        if (!today) return NEED_TIMEZONE;
        // As the app shows it: unfinished one-off tasks already carried over to today.
        const data = rolloverPersistentTasks(stored, today);
        let items: AnyItem[] = itemsOf(data, type);
        if (id || name) {
          const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name, type });
          if (resolved.status === "not_found") return resolved;
          if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
          if (resolved.status === "ineligible") return { status: "not_found", message: `Nothing is called "${name}".` };
          items = resolved.items;
        }
        const history = getHistory(data, from, to, today, items, { keepEmpty: !!(id || name) });
        return {
          status: "ok",
          ...history,
          // §65: worked out by the app; Claude words it or draws it, never recomputes it.
          summary: summarizeHistory(data, history, weekStartOf(data), items),
          fields:
            "daily: per-day totals (done, missed, open today, upcoming) for a calendar or chart. summary.period/previous: done rate (done ÷ (done + missed), past days only) for this range and the same number of days before. summary.weekly: per-week totals. summary.highlights: longest current streak, most missed, most improved (vs previous), every-due-day-done items. Use these numbers as they are.",
          ...(history.daysOmitted ? { note: "Too many entries to list day by day; only the totals are here. Ask for a shorter period or one item for the days." } : {}),
        };
      }),
  );

  server.registerTool(
    "get_stats",
    {
      title: "Get stats",
      description: GET_STATS_DESCRIPTION,
      inputSchema: {
        scope: z.enum(["item", "category", "overall"]),
        id: z.string().optional().describe("scope item: the item's id."),
        name: z.string().optional().describe("scope item: the item's name in the user's words."),
        category: z.string().optional().describe("scope category: the category's name."),
        type: ITEM_TYPE.optional().describe("scope category or overall: only this kind of item."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ scope, id, name, category, type, timeZone }) =>
      timed(deps, "get_stats", async () => {
        const invalid = invalidInput(undefined, timeZone);
        if (invalid) return invalid;
        const { data } = await deps.store.load();
        const today = userToday(data, timeZone);
        if (!today) return NEED_TIMEZONE;
        // §63: habits as before; recurring and one-off tasks in sections of their own, so
        // they never dilute the habit numbers. `type` keeps one kind.
        const wants = (kind: string) => !type || type === kind;
        const tasksIn = (categoryId?: string) => {
          const tasks = taskStats(data, today, categoryId);
          return {
            ...(wants("recurringTask") ? { recurringTasks: tasks.recurringTasks } : {}),
            ...(wants("singleTask") ? { singleTasks: tasks.singleTasks } : {}),
          };
        };
        if (scope === "overall") return { status: "ok", today, ...(wants("habit") ? overallStats(data, today) : {}), ...tasksIn() };
        if (scope === "category") {
          const categoryId = category ? resolveCategoryId(data, category) : undefined;
          if (!categoryId) {
            return { status: "rejected", message: `There's no category called "${category ?? ""}". The categories are: ${data.categories.map((c) => c.name).join(", ")}.` };
          }
          const habits = data.habits.filter((habit) => habit.categoryId === categoryId);
          return {
            status: "ok",
            today,
            category: data.categories.find((c) => c.id === categoryId)?.name,
            ...(wants("habit") ? { ...categoryStats(data, categoryId, today), habits: habits.map((habit) => habitStats(data, habit, today)) } : {}),
            ...tasksIn(categoryId),
          };
        }
        const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name });
        if (resolved.status === "not_found") return resolved;
        if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
        return { status: "ok", today, ...itemStats(data, resolved.items[0], today) };
      }),
  );

  server.registerTool(
    "reset_stats",
    {
      title: "Reset stats",
      description: RESET_STATS_DESCRIPTION,
      inputSchema: {
        scope: z.enum(["item", "category", "all"]),
        id: z.string().optional().describe("scope item: the item's id."),
        name: z.string().optional().describe("scope item: the item's name in the user's words."),
        category: z.string().optional().describe("scope category: the category's name."),
        type: ITEM_TYPE.optional().describe("scope category or all: only this kind of item."),
        confirm: z.boolean().optional().describe("Only after the user said yes to the needs_confirm question."),
        undo: z.boolean().optional().describe("Put the counting back as before the last reset, same scope."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ scope, id, name, category, type, confirm = false, undo, timeZone }) =>
      timed(deps, "reset_stats", async () => {
        const invalid = invalidInput(undefined, timeZone);
        if (invalid) return invalid;
        if (undo) return runHandler(deps, "undo_reset_stats", scope === "item" ? { id, name } : scope === "category" ? { category, type } : { type }, timeZone);
        const loaded = await deps.store.load();
        const today = userToday(loaded.data, timeZone);
        if (!today) return NEED_TIMEZONE;
        let resetScope: ResetScope;
        if (scope === "item") {
          const resolved = resolveTargets(loaded.data, { ids: id ? [id] : undefined, name });
          if (resolved.status === "not_found") return resolved;
          if (resolved.status === "ambiguous") return ambiguous(resolved.candidates, "id");
          resetScope = { kind: "item", item: resolved.items[0] };
        } else if (scope === "category") {
          const categoryId = category ? resolveCategoryId(loaded.data, category) : undefined;
          if (!categoryId) {
            return { status: "rejected", message: `There's no category called "${category ?? ""}". The categories are: ${loaded.data.categories.map((c) => c.name).join(", ")}.` };
          }
          resetScope = { kind: "category", categoryId };
        } else {
          resetScope = { kind: "all" };
        }
        const targets = resetTargets(loaded.data, resetScope, type as ItemKind | undefined);
        const refusal = resetRefusal(resetScope, targets);
        if (refusal) return { status: "rejected", message: refusal };
        // §64: from Claude the best streak always stays; the tool froze with no input for it.
        if (!confirm) {
          const question = describeResetQuestion(loaded.data, resetScope, targets, today, weekStartOf(loaded.data), {
            includeBestStreak: false,
            bestStreakNote: "Resetting the best streak too can only be done in the Habit Assistant app.",
          });
          return { status: "needs_confirm", question };
        }
        const ids = new Set(targets.map((item) => item.id));
        await persist(deps.store, loaded, today, (data) => resetStats(data, ids, today, false));
        return { status: "ok", today, message: describeReset(targets, resetScope, loaded.data.categories, today, false) };
      }),
  );

  server.registerTool(
    "set_note",
    {
      title: "Note on a day",
      description: SET_NOTE_DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe("The item's id, from get_day or find_items."),
        name: z.string().optional().describe("The item's name in the user's words, when there's no id."),
        date: DATE,
        note: z.string().describe('The note, in the user\'s words; "" removes it.'),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, name, date, note, timeZone }) =>
      timed(deps, "set_note", async () => (invalidInput(date, undefined) ?? runHandler(deps, "set_note", { id, name, date, note }, timeZone))),
  );

  server.registerTool(
    "categories",
    {
      title: "Categories",
      description: CATEGORIES_DESCRIPTION,
      inputSchema: {
        op: z.enum(["list", "add"]),
        name: z.string().optional().describe("add: the new category's name."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ op, name, timeZone }) =>
      timed(deps, "categories", async () => runHandler(deps, op === "add" ? "add_category" : "list_categories", { name }, timeZone)),
  );

  server.registerTool(
    "settings",
    {
      title: "Settings",
      description: SETTINGS_DESCRIPTION,
      inputSchema: {
        weekStartsOn: z.enum(["sunday", "monday"]).optional(),
        readAloud: z.boolean().optional(),
        timeZone: z.string().optional().describe('Save this IANA time zone as the user\'s, e.g. "Asia/Tokyo".'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ weekStartsOn, readAloud, timeZone }) =>
      timed(deps, "settings", async () => {
        const invalid = invalidInput(undefined, timeZone);
        if (invalid) return invalid;
        let zone: Body | undefined;
        if (timeZone) {
          const loaded = await deps.store.load();
          const today = todayIn(timeZone);
          const changed = loaded.data.timeZone !== timeZone;
          // The same §62 helper the app uses at sign-in and on returning to the foreground.
          if (changed) await persist(deps.store, loaded, today, (data) => withTimeZone(data, timeZone));
          zone = { status: "ok", timeZone, today, changed };
          if (weekStartsOn === undefined && readAloud === undefined) return zone;
        }
        const result = await runHandler(deps, "settings", { weekStartsOn, readAloud }, undefined);
        return zone ? { ...result, timeZone, today: zone.today } : result;
      }),
  );

  server.registerTool(
    "undo",
    {
      title: "Undo the last change",
      description: UNDO_DESCRIPTION,
      inputSchema: { timeZone: TIME_ZONE },
      // §80: it can remove an item just created, so it asks for approval like a delete.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ timeZone }) => timed(deps, "undo", async () => runHandler(deps, "undo", {}, timeZone)),
  );

  server.registerTool(
    "create_items",
    {
      title: "Create items",
      description: CREATE_ITEMS_DESCRIPTION,
      inputSchema: {
        type: ITEM_TYPE.optional().describe("One item: its kind."),
        name: z.string().optional().describe("One item: its name."),
        userMessage: z.string().describe("The user's message that asked for this, word for word."),
        dayPart: DAY_PART.optional().describe("One item: the part of the day it belongs to. Always set; never ask."),
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
        items: z
          .array(
            z.object({
              type: ITEM_TYPE,
              name: z.string(),
              dayPart: DAY_PART,
              category: z.string().optional(),
              recurrence: z.string().optional(),
              description: z.string().optional(),
              startDate: z.string().optional(),
              completionType: COMPLETION_TYPE.optional(),
              target: z.number().positive().optional(),
              unit: z.string().optional(),
              checklistItems: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .describe("Several new items at once, each with the fields above."),
        packName: z.string().optional().describe('Several: what the set is, e.g. "a morning routine".'),
        confirm: z.boolean().optional().describe("Several: only after the user agreed to the list."),
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) =>
      timed(deps, "create_items", async () => {
        // §76: several at once, previewed and confirmed.
        if (input.items?.length) {
          const startDates = [...new Set(input.items.map((item) => item.startDate).filter(Boolean))];
          const invalidStart = startDates.map((date) => invalidInput(date, undefined)).find(Boolean);
          if (invalidStart) return invalidStart;
          const items = input.items.map(({ type, startDate: _start, ...rest }) => ({ kind: type, ...rest }));
          return runHandler(
            deps,
            "add_pack",
            { name: input.packName ?? "", items, startDate: startDates.length === 1 ? startDates[0] : undefined, confirm: input.confirm },
            input.timeZone,
          );
        }
        if (!input.type || !input.name || !input.dayPart) {
          return { status: "need_info", message: "Pass `type`, `name` and `dayPart` for one item, or `items` for several." };
        }
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
            name: input.name,
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
    "update_items",
    {
      title: "Change items",
      description: UPDATE_ITEMS_DESCRIPTION,
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
        newRecurrence: z.string().optional().describe("Habits and recurring tasks: the whole new rule, same format as create_items."),
        newCompletionType: COMPLETION_TYPE.optional().describe("Habits only."),
        newTarget: z.number().positive().optional().describe("Habits: goal for value/timer (timer: minutes)."),
        newUnit: z.string().optional().describe("Habits: unit for value."),
        newChecklistItems: z.array(z.string()).optional().describe("Habits: the whole new list of steps."),
        newChecklistItemsFrom: z.string().optional().describe("Habits: YYYY-MM-DD, only when the user names an earlier day for new steps."),
        newChecklistMode: CHECKLIST_MODE.optional().describe("Recurring tasks with a checklist."),
        newCarriesOver: z.boolean().optional().describe("One-off tasks: whether it carries over to the next day if not done."),
        ...MANY,
        timeZone: TIME_ZONE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, name, type, timeZone, names, dayPart, category, all, confirm, ...fields }) =>
      timed(deps, "update_items", async () => {
        // §78: one change on several items; only these fields go in bulk.
        if (isMany({ names, dayPart, category, all })) {
          const { newDayPart, newImportant, newCategory, newRecurrence, ...others } = fields;
          const extra = Object.entries(others).filter(([, value]) => value !== undefined).map(([key]) => key);
          if (extra.length) {
            return { status: "rejected", message: `Only newDayPart, newImportant, newCategory and newRecurrence change several items at once; change ${extra.join(", ")} one item at a time.` };
          }
          return runHandler(deps, "apply_to_many", { action: "edit", ...manyArgs({ names, dayPart, category, type }), newDayPart, newImportant, newCategory, newRecurrence, confirm }, timeZone);
        }
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
