// Shared agent logic used by both the real Worker entry point
// (worker.ts, real deployment) and the local Vite dev middleware
// (vite.config.ts, used because the Workers emulator can't run in this
// sandboxed environment — see README.md's "Local dev note").
// Runtime-agnostic: takes plain data in, returns a plain {status, body} out.
//
// Provider-agnostic by design (see CLAUDE.md's "Cost model / provider
// strategy"): a BYOK request uses the caller's own provider/key; otherwise
// it falls back to the shared free trial configured via env vars.
import { resolveProvider } from "./providers/index.ts";
import { ProviderRequestError, type ToolDefinition } from "./providers/types.ts";
import type { AgentHistoryMessage } from "./agentHistory.ts";
import { DEFAULT_CATEGORIES, type Category } from "../types/models.ts";

export interface AgentEnv {
  TRIAL_PROVIDER?: string;
  TRIAL_API_KEY?: string;
  TRIAL_MODEL?: string;
}

export interface Byok {
  provider: string;
  apiKey: string;
  model?: string;
}

export interface AgentResult {
  status: number;
  body: {
    reply?: string;
    toolCall?: { id: string; name: string; input: Record<string, unknown> };
    error?: string;
  };
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildSystemPrompt(categories: Category[], todayISO: string): string {
  const categoryList = categories.map((category) => `${category.id} (${category.name})`).join(", ");
  const todayWeekday = WEEKDAY_NAMES[new Date(`${todayISO}T00:00:00Z`).getUTCDay()];

  return `You are the in-app assistant for Habit Assistant, a personal habit and task tracker the user controls entirely through conversation.

Today's date is ${todayISO} (${todayWeekday}). Use this as the anchor for any relative date the user gives you — "today", "tomorrow", "in 3 days", etc. — and resolve it to an exact ISO date (YYYY-MM-DD) yourself before calling a tool.

Exception: if the user names the start day by weekday (e.g. "on Tuesday", "next Thursday", "starting next Tuesday") rather than an absolute date, do NOT compute that date yourself — day-of-week counting is where you're most error-prone. Instead pass startWeekday (0=Sunday..6=Saturday) and startWeekdayMode ("next" if the user said the word "next" before the weekday, otherwise "closest") and leave startDate unset; the app resolves the exact date deterministically.

You can take these actions:
1. createSingleTask — a one-off task, done/not-done, no recurrence.
2. createHabit — a recurring habit tracked over time, with a completion type (yes/no, numeric, timer, or checklist).
3. createRecurringTask — a recurring task with the same recurrence options as a habit, but simple done/not-done tracking only (no completion type). Use this instead of createHabit when the user clearly wants a "recurring task" or a plain repeating to-do rather than something with detailed tracking.
4. deleteSingleTasks — delete one-off tasks matching filters you specify.
5. deleteHabits — delete habits matching filters you specify.
6. deleteRecurringTasks — delete recurring tasks matching filters you specify.
7. updateSingleTask — change one or more fields on an existing one-off task.
8. updateHabit — change one or more fields on an existing habit.
9. updateRecurringTask — change one or more fields on an existing recurring task.
10. archiveHabit — archive an existing habit.
11. archiveRecurringTask — archive an existing recurring task.
12. logHabitProgress — log or adjust a Numeric-value or Timer habit's progress for a specific day (not for Yes/No or Checklist habits, and not for changing a habit's target/settings — see below).
13. addRecurringTaskChecklistItem — add one item to an existing recurring task's checklist.
14. addSingleTaskChecklistItem — add one item to an existing one-off task's checklist.
15. checkHabitChecklistItem — check or uncheck one item on a checklist-type habit's checklist.
16. checkRecurringTaskChecklistItem — check or uncheck one item on a recurring task's checklist.
17. checkSingleTaskChecklistItem — check or uncheck one item on a one-off task's checklist.

Only call a tool when the user is clearly and explicitly asking you to add, create, delete, or change something. Do NOT call a tool in response to general statements, feedback, complaints, or corrections about something you already did (for example: "that was wrong", "I have one task", "you added the wrong thing") — reply in plain text instead and ask what they'd actually like.

If you don't have enough information to act — at minimum, a clear name, or for a deletion, a clear sense of what should be deleted, or for an edit, both which item and what to change — ask a short, single clarifying question instead of guessing, and never call a tool with a placeholder, guessed, or empty value.

For deleteSingleTasks, deleteHabits, and deleteRecurringTasks: you only express *what* to delete, via a filter object. Every filter field you set is combined with AND (e.g. categoryId + done together means "in that category AND not done"). You do NOT decide whether confirmation is needed, and you must NEVER ask a confirmation question yourself ("are you sure?", etc.) — the app resolves your filters against the user's real data (which you can't see) and handles confirmation deterministically. Just call the tool with your best-effort filters whenever the user is clearly asking to delete something. Leaving every field unset matches nothing — if the user means "delete everything", set all: true instead.
- all: set true to match every item of that kind, ignoring every other field below.
- name: a text fragment to match against the item's name (e.g. "delete the gym habit" → name: "gym").
- categoryIds: one or more category ids from this list: ${categoryList} (e.g. "delete my Health and Finance tasks" → categoryIds: ["health", "finance"]).
- startDateFrom / startDateTo: an inclusive ISO date range on the item's start date — e.g. "delete tasks from last week" → resolve that phrase to explicit from/to dates yourself, same as you do for other relative dates. "delete all tasks for today" → startDateFrom and startDateTo both "${todayISO}".
- priorityMin / priorityMax: an inclusive numeric range on priority (e.g. "delete my low priority tasks" only if the user has given you a sense of what counts as low — otherwise ask).
- done (deleteSingleTasks only): true = only completed tasks, false = only not-yet-done tasks.
- completionType (deleteHabits only): "yesno" | "value" | "timer" | "checklist" — only when the user explicitly refers to how a habit is tracked.
- neverCompleted (deleteHabits and deleteRecurringTasks): true = only items with zero completions ever recorded (e.g. "delete habits I've never actually done").
- inactiveSince (deleteHabits and deleteRecurringTasks): an ISO date you compute from a relative phrase like "haven't done in 2 weeks" — matches items with no completions on or after that date.

For updateSingleTask, updateHabit, and updateRecurringTask: name is always required and selects which single item to change — it's the same kind of text fragment as delete's name filter (e.g. "rename the gym habit to..." → name: "gym"), never a full replacement value. Every other field is prefixed "new" (newName, newPriority, newRecurrenceType, etc.) and, when you set it, replaces that field on the item; leave a "new" field out entirely if it shouldn't change. Never call an update tool with only name set and no "new" fields — if you know which item but not what to change, ask. You do NOT decide what happens if name matches zero items or more than one — the app resolves that against the user's real data and asks a clarifying question itself if needed; just pass your best-effort name fragment and "new" fields. "" (empty string) explicitly clears newDescription, newEndDate, and — for updateSingleTask/updateRecurringTask only — newCategoryId (updateHabit's newCategoryId can't be cleared, since a habit always needs a category; pick from ${categoryList} same as createHabit). newStartDate follows the same today-or-later rule as creating an item. For updateHabit and updateRecurringTask, newRecurrenceType (if set) replaces the entire recurrence rule, not just one piece of it — include whichever of newRecurrenceDays/newRecurrenceInterval/newRecurrencePeriod/newRecurrenceCount that type needs, exactly as you would for createHabit's recurrenceType. For updateHabit, setting newCompletionType to "checklist" needs newChecklistItems in the same call — ask what the items are if the user hasn't said, don't guess an empty list; setting newCompletionType away from "checklist" clears the habit's checklist. newChecklistItems, when given, fully replaces the checklist rather than adding to it. newTarget/newUnit change the habit's *goal* (e.g. "change my water goal to 10 glasses") — use logHabitProgress instead when the user is reporting today's (or another day's) actual progress, not changing the goal itself. None of this ever touches a habit's already-logged completion history.

For archiveHabit and archiveRecurringTask: name is the same kind of text fragment used by delete/update to select the single item to archive — never a new value. Use these (not deleteHabits/deleteRecurringTasks) whenever the user says "archive", "retire", "stop tracking", or similar about an *existing* habit or recurring task they want to stop seeing going forward without losing its history — archiving sets its end date to today and keeps every completion already logged, whereas delete permanently erases that history too. If the user instead names a specific end date (not "today"), use updateHabit/updateRecurringTask's newEndDate rather than archive. You do NOT decide what happens if name matches zero items or more than one — same as update/delete, the app resolves that and asks a clarifying question itself if needed.

For logHabitProgress: name is the same kind of text fragment used elsewhere to select the single habit — never a new value; the app resolves it and tells you if it matched zero, more than one, or a habit that isn't tracked with a number or timer. date is optional and defaults to today — resolve any relative phrase ("yesterday", "last Tuesday") to an exact ISO date yourself first, same as everywhere else. Set exactly one of value or delta, never both: value is an absolute total for that day (use for a stated total, e.g. "I read for 30 minutes today", "log 6 glasses of water"); delta adds to (or, if negative, subtracts from) whatever's already logged for that day (use for "add N", "increase by N", "do N more", e.g. "add 10 minutes to my reading time today"). If the phrasing is genuinely ambiguous between a total and an increment, ask rather than guessing. This only logs day-to-day progress — it never changes a habit's target or other settings (use updateHabit's newTarget/newUnit for that).

For addRecurringTaskChecklistItem and addSingleTaskChecklistItem: name is a text fragment to find the task, text is the one item to add (e.g. "add milk to my shopping list" → name: "shopping", text: "milk"). These always *add* one item — they never see or replace the task's existing items, so don't use them to rewrite a whole list. Pick recurring vs. single-task by what you know about that task from earlier in the conversation (or the user's own wording, e.g. "my weekly shopping list" implies recurring); if you genuinely can't tell, ask rather than guessing. A task's checklist starts empty — there's no way to seed several items at task-creation time, only one at a time via these tools.

For checkHabitChecklistItem, checkRecurringTaskChecklistItem, and checkSingleTaskChecklistItem: name selects the habit/task (same fragment-matching as elsewhere), item is a text fragment to find which checklist item (e.g. "check off milk on my shopping list" → name: "shopping", item: "milk") — the app resolves both and tells you if either matched zero or more than one. checked defaults to true ("check off X", "I did X"); set it to false explicitly for "uncheck X", "actually I didn't do X". These are distinct from logHabitProgress (which is for a Numeric/Timer habit's logged number, not a checklist) and from the plain done/not-done toggle (which the user can't reach via chat at all — only through the app's UI). checkHabitChecklistItem specifically also takes date, same as logHabitProgress: optional, defaults to today, resolve any relative phrase ("yesterday", "last Tuesday") to an exact ISO date yourself first — a habit's checklist resets per occurrence, so checking an item off on one date has no effect on any other date's state. checkRecurringTaskChecklistItem and checkSingleTaskChecklistItem have no date — a task's checklist doesn't reset, it's one persistent list.

For createSingleTask specifically:
- startDate must be today or a future date. If unspecified, it defaults to today automatically — leave it out unless the user gives a specific date.
- persistency defaults to true (the task keeps carrying forward until done) — leave it out unless the user's own phrasing signals a same-day/one-shot intent (e.g. "just for today", "don't need this tomorrow") or explicitly asks for it to persist or not. Never ask about this proactively; it has a sensible default.

For createHabit specifically:
- categoryId is required. Pick the best match from this list: ${categoryList}. If nothing fits, use "other" — don't ask the user to pick a category unless they seem to care about it.
- priority is a positive whole number; higher means more important. Default to 1 (the lowest priority) unless the user signals otherwise (e.g. "this is really important" → a higher number).
- startDate must be today or a future date (never in the past). If unspecified, it defaults to today automatically — leave it out. If the user explicitly asks for a start date that's already in the past, ask them to confirm what they actually meant rather than silently picking a different date.
- Map how the user describes frequency to recurrenceType:
  - "every day" / "daily" → recurrenceType "daily"
  - specific weekdays (e.g. "Mon/Wed/Fri", "on weekends") → recurrenceType "daysOfWeek" with recurrenceDays as an array of 0=Sunday..6=Saturday
  - "every N days" (e.g. "every 3 days") → recurrenceType "intervalDays" with recurrenceInterval = N
  - "N times a week/month" (not pinned to specific days) → recurrenceType "timesPerPeriod" with recurrencePeriod ("week" or "month") and recurrenceCount = N
  - "the Nth <weekday> of the month" (e.g. "every third Monday", "the last Friday of the month") → recurrenceType "nthWeekdayOfMonth" with recurrenceNth ("first"|"second"|"third"|"fourth"|"fifth"|"last") and recurrenceWeekday (0=Sunday..6=Saturday)
  - a date that recurs every year (e.g. a birthday, an anniversary) → recurrenceType "specificDatesOfYear" with recurrenceDates as an array of "MM-DD" strings (no year). recurrenceDates always replaces the full list — you can't see a habit's already-stored dates, so if the user wants to add one more date to an existing habit, ask them for the complete list of dates rather than guessing what's already there (same as checklistItems below).
  - "N days on, M days off" (e.g. "5 days on, 2 days off") → recurrenceType "onOffCycle" with recurrenceOnDays = N and recurrenceOffDays = M
  - If the frequency is vague (e.g. "sometimes", "regularly") ask a clarifying question instead of guessing.
- completionType defaults to "yesno" (simple done/not-done) unless the user describes tracking a number (→ "value"), a duration (→ "timer"), or a checklist of sub-items to complete (→ "checklist", with checklistItems as the list of item names). If the user states a specific amount for a "value" or "timer" habit (e.g. "drink 8 glasses of water" → target 8, unit "glasses"; "meditate for 10 minutes" → target 10, minutes are implicit for timer so no unit needed), set target (and unit, for "value" only) to match. If they don't give a specific amount, leave target/unit unset — don't ask proactively, tracking works fine without a target.

For createRecurringTask specifically:
- categoryId is optional — only set it if there's a clear match from this list: ${categoryList}; otherwise leave it out rather than guessing or asking.
- priority, startDate/startWeekday/startWeekdayMode, and recurrenceType (with its matching fields) all work exactly as they do for createHabit — see above.
- There is no completion type: tracking is always simple done/not-done, so never set anything completion-related for this tool.

Keep replies brief and conversational.`;
}

function buildConfirmationSystemPrompt(todayISO: string): string {
  return `You are the in-app assistant for Habit Assistant. Today's date is ${todayISO}.

A destructive deletion is currently pending the user's confirmation — they were already shown exactly what would be deleted in the previous message. The user's latest message is their answer to that question.

Call confirmPendingDeletion with confirmed=true only if they clearly agreed (e.g. "yes", "confirm", "do it", "go ahead"). Call it with confirmed=false if they declined, said you misunderstood, or their message is ambiguous, off-topic, or an unrelated new request — when in doubt, decline. Nothing should be deleted on anything less than a clear yes. Do not call any other tool.`;
}

function buildTools(categories: Category[], hasPendingConfirmation: boolean): ToolDefinition[] {
  const categoryList = categories.map((category) => `${category.id} (${category.name})`).join(", ");

  if (hasPendingConfirmation) {
    return [
      {
        name: "confirmPendingDeletion",
        description:
          "Record whether the user just confirmed or declined a pending deletion. Call this exactly once, interpreting the user's latest message as their answer.",
        parameters: {
          type: "object",
          properties: {
            confirmed: {
              type: "boolean",
              description:
                "true only if the user clearly agreed (e.g. 'yes', 'confirm', 'go ahead'). false if they declined, corrected you, or their message is ambiguous/off-topic/unrelated to the pending question.",
            },
          },
          required: ["confirmed"],
        },
      },
    ];
  }

  return [
    {
      name: "createSingleTask",
      description: "Create a single one-off task (not recurring).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name of the task." },
          description: { type: "string", description: "Optional extra detail." },
          priority: {
            type: "number",
            description: "Optional numeric priority; higher values show first.",
          },
          startDate: {
            type: "string",
            description: "ISO date (YYYY-MM-DD), today or later. Omit to default to today.",
          },
          persistency: {
            type: "boolean",
            description:
              "Whether an incomplete task keeps carrying forward until done (true, the default) or dies uncompleted at the end of its start date (false). Only set explicitly when the user's phrasing signals a one-shot/same-day intent (e.g. 'just for today', 'don't need this tomorrow') or explicitly asks it to persist — otherwise omit.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "createHabit",
      description: "Create a recurring habit to track over time.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name of the habit." },
          description: { type: "string", description: "Optional extra detail." },
          categoryId: {
            type: "string",
            description: "Best-fit category id for this habit.",
            enum: categories.map((category) => category.id),
          },
          priority: {
            type: "number",
            description: "Positive whole number; higher means more important. Defaults to 1.",
          },
          startDate: {
            type: "string",
            description:
              "ISO date (YYYY-MM-DD), today or later. Omit to default to today. Do not use this for a start day given by weekday name — use startWeekday/startWeekdayMode instead.",
          },
          startWeekday: {
            type: "number",
            description:
              "Use instead of startDate when the user names the start day by weekday (e.g. 'next Tuesday'). 0=Sunday..6=Saturday.",
          },
          startWeekdayMode: {
            type: "string",
            description:
              "'next' if the user said the word 'next' before the weekday; 'closest' (default) otherwise.",
            enum: ["closest", "next"],
          },
          endDate: {
            type: "string",
            description: "Optional ISO date (YYYY-MM-DD) after which the habit stops recurring.",
          },
          recurrenceType: {
            type: "string",
            description: "How this habit repeats.",
            enum: [
              "daily",
              "daysOfWeek",
              "intervalDays",
              "timesPerPeriod",
              "nthWeekdayOfMonth",
              "specificDatesOfYear",
              "onOffCycle",
            ],
          },
          recurrenceDays: {
            type: "array",
            description: "Used when recurrenceType is daysOfWeek: 0=Sunday..6=Saturday.",
            items: { type: "number" },
          },
          recurrenceInterval: {
            type: "number",
            description: "Used when recurrenceType is intervalDays: repeat every N days.",
          },
          recurrencePeriod: {
            type: "string",
            description: "Used when recurrenceType is timesPerPeriod.",
            enum: ["week", "month"],
          },
          recurrenceCount: {
            type: "number",
            description: "Used when recurrenceType is timesPerPeriod: how many times per period.",
          },
          recurrenceNth: {
            type: "string",
            description: "Used when recurrenceType is nthWeekdayOfMonth: which occurrence of recurrenceWeekday in the month.",
            enum: ["first", "second", "third", "fourth", "fifth", "last"],
          },
          recurrenceWeekday: {
            type: "number",
            description: "Used when recurrenceType is nthWeekdayOfMonth: 0=Sunday..6=Saturday.",
          },
          recurrenceDates: {
            type: "array",
            description:
              "Used when recurrenceType is specificDatesOfYear: annual dates as \"MM-DD\" strings (no year), e.g. \"03-15\".",
            items: { type: "string" },
          },
          recurrenceOnDays: {
            type: "number",
            description: "Used when recurrenceType is onOffCycle: consecutive days on, starting at startDate.",
          },
          recurrenceOffDays: {
            type: "number",
            description: "Used when recurrenceType is onOffCycle: consecutive days off, following the on days.",
          },
          completionType: {
            type: "string",
            description: "How completion is tracked. Defaults to yesno.",
            enum: ["yesno", "value", "timer", "checklist"],
          },
          checklistItems: {
            type: "array",
            description: "Used when completionType is checklist: the sub-item names.",
            items: { type: "string" },
          },
          target: {
            type: "number",
            description:
              "Used when completionType is value or timer: the numeric goal (value) or goal duration in minutes (timer). Leave unset if the user didn't give a specific amount.",
          },
          unit: {
            type: "string",
            description: "Used when completionType is value: a short label for the number, e.g. \"glasses\", \"pages\", \"reps\".",
          },
        },
        required: ["name", "categoryId", "recurrenceType"],
      },
    },
    {
      name: "createRecurringTask",
      description:
        "Create a recurring task to track over time. Same recurrence options as createHabit, but simple done/not-done tracking only — no completion type.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name of the task." },
          description: { type: "string", description: "Optional extra detail." },
          categoryId: {
            type: "string",
            description: "Optional best-fit category id for this task.",
            enum: categories.map((category) => category.id),
          },
          priority: {
            type: "number",
            description: "Positive whole number; higher means more important. Defaults to 1.",
          },
          startDate: {
            type: "string",
            description:
              "ISO date (YYYY-MM-DD), today or later. Omit to default to today. Do not use this for a start day given by weekday name — use startWeekday/startWeekdayMode instead.",
          },
          startWeekday: {
            type: "number",
            description:
              "Use instead of startDate when the user names the start day by weekday (e.g. 'next Tuesday'). 0=Sunday..6=Saturday.",
          },
          startWeekdayMode: {
            type: "string",
            description:
              "'next' if the user said the word 'next' before the weekday; 'closest' (default) otherwise.",
            enum: ["closest", "next"],
          },
          endDate: {
            type: "string",
            description: "Optional ISO date (YYYY-MM-DD) after which the task stops recurring.",
          },
          recurrenceType: {
            type: "string",
            description: "How this task repeats.",
            enum: [
              "daily",
              "daysOfWeek",
              "intervalDays",
              "timesPerPeriod",
              "nthWeekdayOfMonth",
              "specificDatesOfYear",
              "onOffCycle",
            ],
          },
          recurrenceDays: {
            type: "array",
            description: "Used when recurrenceType is daysOfWeek: 0=Sunday..6=Saturday.",
            items: { type: "number" },
          },
          recurrenceInterval: {
            type: "number",
            description: "Used when recurrenceType is intervalDays: repeat every N days.",
          },
          recurrencePeriod: {
            type: "string",
            description: "Used when recurrenceType is timesPerPeriod.",
            enum: ["week", "month"],
          },
          recurrenceCount: {
            type: "number",
            description: "Used when recurrenceType is timesPerPeriod: how many times per period.",
          },
          recurrenceNth: {
            type: "string",
            description: "Used when recurrenceType is nthWeekdayOfMonth: which occurrence of recurrenceWeekday in the month.",
            enum: ["first", "second", "third", "fourth", "fifth", "last"],
          },
          recurrenceWeekday: {
            type: "number",
            description: "Used when recurrenceType is nthWeekdayOfMonth: 0=Sunday..6=Saturday.",
          },
          recurrenceDates: {
            type: "array",
            description:
              "Used when recurrenceType is specificDatesOfYear: annual dates as \"MM-DD\" strings (no year), e.g. \"03-15\".",
            items: { type: "string" },
          },
          recurrenceOnDays: {
            type: "number",
            description: "Used when recurrenceType is onOffCycle: consecutive days on, starting at startDate.",
          },
          recurrenceOffDays: {
            type: "number",
            description: "Used when recurrenceType is onOffCycle: consecutive days off, following the on days.",
          },
        },
        required: ["name", "recurrenceType"],
      },
    },
    {
      name: "deleteSingleTasks",
      description:
        "Delete one-off tasks matching filters. Every filter field you set is combined with AND. Set all=true to match every task regardless of other filters. Leaving every field unset matches nothing. Never ask a confirmation question yourself — the app handles that.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Set true to match every task, ignoring every other field." },
          name: { type: "string", description: "Case-insensitive fragment to match against the task's name." },
          categoryIds: {
            type: "array",
            description: `Match tasks in any of these categories. Valid ids: ${categoryList}.`,
            items: { type: "string" },
          },
          startDateFrom: { type: "string", description: "ISO date (YYYY-MM-DD): only tasks starting on/after this date." },
          startDateTo: { type: "string", description: "ISO date (YYYY-MM-DD): only tasks starting on/before this date." },
          priorityMin: { type: "number", description: "Only tasks with priority >= this value." },
          priorityMax: { type: "number", description: "Only tasks with priority <= this value." },
          done: { type: "boolean", description: "true = only completed tasks, false = only not-yet-done tasks." },
        },
        required: [],
      },
    },
    {
      name: "deleteHabits",
      description:
        "Delete habits matching filters. Every filter field you set is combined with AND. Set all=true to match every habit regardless of other filters. Leaving every field unset matches nothing. The app always confirms before deleting a habit (it also deletes its tracked completion history) — never ask a confirmation question yourself.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Set true to match every habit, ignoring every other field." },
          name: { type: "string", description: "Case-insensitive fragment to match against the habit's name." },
          categoryIds: {
            type: "array",
            description: `Match habits in any of these categories. Valid ids: ${categoryList}.`,
            items: { type: "string" },
          },
          startDateFrom: { type: "string", description: "ISO date (YYYY-MM-DD): only habits starting on/after this date." },
          startDateTo: { type: "string", description: "ISO date (YYYY-MM-DD): only habits starting on/before this date." },
          priorityMin: { type: "number", description: "Only habits with priority >= this value." },
          priorityMax: { type: "number", description: "Only habits with priority <= this value." },
          completionType: {
            type: "string",
            description: "Only habits tracked this way.",
            enum: ["yesno", "value", "timer", "checklist"],
          },
          neverCompleted: {
            type: "boolean",
            description: "true = only habits with zero completions ever recorded.",
          },
          inactiveSince: {
            type: "string",
            description: "ISO date (YYYY-MM-DD): only habits with no completions on/after this date.",
          },
        },
        required: [],
      },
    },
    {
      name: "deleteRecurringTasks",
      description:
        "Delete recurring tasks matching filters. Every filter field you set is combined with AND. Set all=true to match every recurring task regardless of other filters. Leaving every field unset matches nothing. The app always confirms before deleting (it also deletes tracked completion history) — never ask a confirmation question yourself.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Set true to match every recurring task, ignoring every other field." },
          name: { type: "string", description: "Case-insensitive fragment to match against the task's name." },
          categoryIds: {
            type: "array",
            description: `Match tasks in any of these categories. Valid ids: ${categoryList}.`,
            items: { type: "string" },
          },
          startDateFrom: { type: "string", description: "ISO date (YYYY-MM-DD): only tasks starting on/after this date." },
          startDateTo: { type: "string", description: "ISO date (YYYY-MM-DD): only tasks starting on/before this date." },
          priorityMin: { type: "number", description: "Only tasks with priority >= this value." },
          priorityMax: { type: "number", description: "Only tasks with priority <= this value." },
          neverCompleted: {
            type: "boolean",
            description: "true = only tasks with zero completions ever recorded.",
          },
          inactiveSince: {
            type: "string",
            description: "ISO date (YYYY-MM-DD): only tasks with no completions on/after this date.",
          },
        },
        required: [],
      },
    },
    {
      name: "updateSingleTask",
      description:
        "Change one or more fields on an existing one-off task. name selects the task (a fragment, not a new value); every field you set replaces that field, everything else is left as-is. Never call this with no fields set besides name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the task's current name, to find which task to change." },
          newName: { type: "string", description: "New name for the task." },
          newDescription: { type: "string", description: "New description. Empty string clears it." },
          newCategoryId: {
            type: "string",
            description: `New category id from: ${categoryList}. Empty string clears the category.`,
          },
          newPriority: { type: "number", description: "New priority; positive whole number, higher means more important." },
          newStartDate: { type: "string", description: "New start date, ISO (YYYY-MM-DD), today or later." },
          newEndDate: { type: "string", description: "New end date, ISO (YYYY-MM-DD). Empty string clears it." },
          newDone: { type: "boolean", description: "New completion status: true = done, false = not done." },
          newPersistency: {
            type: "boolean",
            description:
              "New persistency: true = carries forward until done, false = dies uncompleted at the end of its start date if not done by then.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "updateHabit",
      description:
        "Change one or more fields on an existing habit. name selects the habit (a fragment, not a new value); every field you set replaces that field, everything else is left as-is. Never call this with no fields set besides name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the habit's current name, to find which habit to change." },
          newName: { type: "string", description: "New name for the habit." },
          newDescription: { type: "string", description: "New description. Empty string clears it." },
          newCategoryId: {
            type: "string",
            description: `New category id from: ${categoryList}.`,
            enum: categories.map((category) => category.id),
          },
          newPriority: { type: "number", description: "New priority; positive whole number, higher means more important." },
          newStartDate: { type: "string", description: "New start date, ISO (YYYY-MM-DD), today or later." },
          newEndDate: { type: "string", description: "New end date, ISO (YYYY-MM-DD). Empty string clears it." },
          newRecurrenceType: {
            type: "string",
            description: "New recurrence type. Replaces the entire recurrence rule — include the matching fields below for this type.",
            enum: [
              "daily",
              "daysOfWeek",
              "intervalDays",
              "timesPerPeriod",
              "nthWeekdayOfMonth",
              "specificDatesOfYear",
              "onOffCycle",
            ],
          },
          newRecurrenceDays: {
            type: "array",
            description: "Used when newRecurrenceType is daysOfWeek: 0=Sunday..6=Saturday.",
            items: { type: "number" },
          },
          newRecurrenceInterval: {
            type: "number",
            description: "Used when newRecurrenceType is intervalDays: repeat every N days.",
          },
          newRecurrencePeriod: {
            type: "string",
            description: "Used when newRecurrenceType is timesPerPeriod.",
            enum: ["week", "month"],
          },
          newRecurrenceCount: {
            type: "number",
            description: "Used when newRecurrenceType is timesPerPeriod: how many times per period.",
          },
          newRecurrenceNth: {
            type: "string",
            description: "Used when newRecurrenceType is nthWeekdayOfMonth: which occurrence of newRecurrenceWeekday in the month.",
            enum: ["first", "second", "third", "fourth", "fifth", "last"],
          },
          newRecurrenceWeekday: {
            type: "number",
            description: "Used when newRecurrenceType is nthWeekdayOfMonth: 0=Sunday..6=Saturday.",
          },
          newRecurrenceDates: {
            type: "array",
            description:
              "Used when newRecurrenceType is specificDatesOfYear: annual dates as \"MM-DD\" strings (no year). Fully replaces the existing list.",
            items: { type: "string" },
          },
          newRecurrenceOnDays: {
            type: "number",
            description: "Used when newRecurrenceType is onOffCycle: consecutive days on, starting at startDate.",
          },
          newRecurrenceOffDays: {
            type: "number",
            description: "Used when newRecurrenceType is onOffCycle: consecutive days off, following the on days.",
          },
          newCompletionType: {
            type: "string",
            description:
              "New way completion is tracked. Switching to checklist requires newChecklistItems in the same call. Switching away from checklist clears the checklist.",
            enum: ["yesno", "value", "timer", "checklist"],
          },
          newChecklistItems: {
            type: "array",
            description: "Fully replaces the checklist sub-items (used with completionType checklist).",
            items: { type: "string" },
          },
          newTarget: {
            type: "number",
            description:
              "Used when newCompletionType (or the habit's existing completionType) is value or timer: the numeric goal (value) or goal duration in minutes (timer).",
          },
          newUnit: {
            type: "string",
            description: "Used when completionType is value: a short label for the number, e.g. \"glasses\", \"pages\", \"reps\".",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "updateRecurringTask",
      description:
        "Change one or more fields on an existing recurring task. name selects the task (a fragment, not a new value); every field you set replaces that field, everything else is left as-is. Never call this with no fields set besides name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the task's current name, to find which task to change." },
          newName: { type: "string", description: "New name for the task." },
          newDescription: { type: "string", description: "New description. Empty string clears it." },
          newCategoryId: {
            type: "string",
            description: `New category id from: ${categoryList}. Empty string clears the category.`,
          },
          newPriority: { type: "number", description: "New priority; positive whole number, higher means more important." },
          newStartDate: { type: "string", description: "New start date, ISO (YYYY-MM-DD), today or later." },
          newEndDate: { type: "string", description: "New end date, ISO (YYYY-MM-DD). Empty string clears it." },
          newRecurrenceType: {
            type: "string",
            description: "New recurrence type. Replaces the entire recurrence rule — include the matching fields below for this type.",
            enum: [
              "daily",
              "daysOfWeek",
              "intervalDays",
              "timesPerPeriod",
              "nthWeekdayOfMonth",
              "specificDatesOfYear",
              "onOffCycle",
            ],
          },
          newRecurrenceDays: {
            type: "array",
            description: "Used when newRecurrenceType is daysOfWeek: 0=Sunday..6=Saturday.",
            items: { type: "number" },
          },
          newRecurrenceInterval: {
            type: "number",
            description: "Used when newRecurrenceType is intervalDays: repeat every N days.",
          },
          newRecurrencePeriod: {
            type: "string",
            description: "Used when newRecurrenceType is timesPerPeriod.",
            enum: ["week", "month"],
          },
          newRecurrenceCount: {
            type: "number",
            description: "Used when newRecurrenceType is timesPerPeriod: how many times per period.",
          },
          newRecurrenceNth: {
            type: "string",
            description: "Used when newRecurrenceType is nthWeekdayOfMonth: which occurrence of newRecurrenceWeekday in the month.",
            enum: ["first", "second", "third", "fourth", "fifth", "last"],
          },
          newRecurrenceWeekday: {
            type: "number",
            description: "Used when newRecurrenceType is nthWeekdayOfMonth: 0=Sunday..6=Saturday.",
          },
          newRecurrenceDates: {
            type: "array",
            description:
              "Used when newRecurrenceType is specificDatesOfYear: annual dates as \"MM-DD\" strings (no year). Fully replaces the existing list.",
            items: { type: "string" },
          },
          newRecurrenceOnDays: {
            type: "number",
            description: "Used when newRecurrenceType is onOffCycle: consecutive days on, starting at startDate.",
          },
          newRecurrenceOffDays: {
            type: "number",
            description: "Used when newRecurrenceType is onOffCycle: consecutive days off, following the on days.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "archiveHabit",
      description:
        "Archive a habit: sets its end date to today, stopping future occurrences while permanently preserving all of its already-logged completion history. Use for 'archive', 'retire', 'stop tracking' intents — not the same as deleting, which erases history.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the habit's current name, to find which habit to archive." },
        },
        required: ["name"],
      },
    },
    {
      name: "archiveRecurringTask",
      description:
        "Archive a recurring task: sets its end date to today, stopping future occurrences while permanently preserving all of its already-logged completion history. Use for 'archive', 'retire', 'stop tracking' intents — not the same as deleting, which erases history.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the task's current name, to find which recurring task to archive." },
        },
        required: ["name"],
      },
    },
    {
      name: "logHabitProgress",
      description:
        "Log or adjust a Numeric-value or Timer habit's progress for a specific date (defaults to today). Use for phrases like 'add 10 minutes to my reading today', 'I drank 6 glasses of water', 'log 30 minutes of meditation for yesterday'. Not for Yes/No or Checklist habits, and not for changing a habit's target — use updateHabit for that.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the habit's name." },
          date: { type: "string", description: "ISO date (YYYY-MM-DD). Omit to default to today." },
          value: {
            type: "number",
            description:
              "Absolute value to set for that date, replacing anything already logged. Use for a stated total (e.g. 'I read for 30 minutes today', 'log 6 glasses of water').",
          },
          delta: {
            type: "number",
            description:
              "Amount to add to (or, if negative, subtract from) whatever's already logged for that date. Use for 'add N', 'increase by N', 'do N more'.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "addRecurringTaskChecklistItem",
      description:
        "Add one item to an existing recurring task's checklist. Use for phrases like 'add milk to my shopping list'. Always adds — never replaces or clears the existing items.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the recurring task's name." },
          text: { type: "string", description: "The item to add." },
        },
        required: ["name", "text"],
      },
    },
    {
      name: "addSingleTaskChecklistItem",
      description:
        "Add one item to an existing one-off task's checklist. Use for phrases like 'add milk to my shopping list'. Always adds — never replaces or clears the existing items.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the task's name." },
          text: { type: "string", description: "The item to add." },
        },
        required: ["name", "text"],
      },
    },
    {
      name: "checkHabitChecklistItem",
      description:
        "Check or uncheck one item on a checklist-type habit's checklist, for a specific date (defaults to today) — a habit's checklist resets per occurrence. Use for phrases like 'check off stretching on my morning routine' or 'uncheck meditate'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the habit's name." },
          item: { type: "string", description: "Fragment to match against the checklist item's text." },
          checked: {
            type: "boolean",
            description: "true (default) to check it off; false to uncheck it.",
          },
          date: { type: "string", description: "ISO date (YYYY-MM-DD). Omit to default to today." },
        },
        required: ["name", "item"],
      },
    },
    {
      name: "checkRecurringTaskChecklistItem",
      description:
        "Check or uncheck one item on a recurring task's checklist. Use for phrases like 'check off milk on my shopping list' or 'I still need to buy milk, uncheck it'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the recurring task's name." },
          item: { type: "string", description: "Fragment to match against the checklist item's text." },
          checked: {
            type: "boolean",
            description: "true (default) to check it off; false to uncheck it.",
          },
        },
        required: ["name", "item"],
      },
    },
    {
      name: "checkSingleTaskChecklistItem",
      description:
        "Check or uncheck one item on a one-off task's checklist. Use for phrases like 'check off milk on my shopping list' or 'I still need to buy milk, uncheck it'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fragment to match against the task's name." },
          item: { type: "string", description: "Fragment to match against the checklist item's text." },
          checked: {
            type: "boolean",
            description: "true (default) to check it off; false to uncheck it.",
          },
        },
        required: ["name", "item"],
      },
    },
  ];
}

export async function handleAgentRequest(
  messages: AgentHistoryMessage[],
  env: AgentEnv,
  byok?: Byok,
  categories: Category[] = [],
  hasPendingConfirmation = false,
): Promise<AgentResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, body: { error: "Expected a non-empty `messages` array." } };
  }

  const availableCategories = categories.length > 0 ? categories : DEFAULT_CATEGORIES;

  const providerId = byok?.provider ?? env.TRIAL_PROVIDER ?? "groq";
  const apiKey = byok?.apiKey ?? env.TRIAL_API_KEY;
  const model = byok?.model ?? (byok ? undefined : env.TRIAL_MODEL);

  if (!apiKey && providerId !== "mock") {
    return {
      status: 500,
      body: { error: `No API key available for provider "${providerId}".` },
    };
  }

  let provider;
  try {
    provider = resolveProvider(providerId);
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : "Unknown provider." } };
  }

  try {
    const todayISO = new Date().toISOString().slice(0, 10);
    const result = await provider.send({
      messages,
      tools: buildTools(availableCategories, hasPendingConfirmation),
      systemPrompt: hasPendingConfirmation
        ? buildConfirmationSystemPrompt(todayISO)
        : buildSystemPrompt(availableCategories, todayISO),
      apiKey: apiKey ?? "",
      model,
    });
    const toolCall = result.toolCall
      ? { id: result.toolCall.id ?? crypto.randomUUID(), name: result.toolCall.name, input: result.toolCall.input }
      : undefined;
    return { status: 200, body: { reply: result.reply, toolCall } };
  } catch (err) {
    if (err instanceof ProviderRequestError) {
      // Provider error bodies are raw, provider-specific JSON/text not meant
      // for end users (e.g. Groq's rate-limit response) — log it for
      // debugging but never forward it verbatim into the chat UI.
      console.error(`Provider request failed (${err.status}):`, err.message);
      return {
        status: err.status,
        body: { error: "The assistant provider had a problem answering. Please try again in a moment." },
      };
    }
    return { status: 500, body: { error: err instanceof Error ? err.message : "Unknown error." } };
  }
}
