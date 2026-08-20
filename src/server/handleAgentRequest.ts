// Shared agent logic used by both the Cloudflare Pages Function
// (functions/api/agent.ts, real deployment) and the local Vite dev
// middleware (vite.config.ts, used because the Workers emulator can't run
// in this sandboxed environment — see README.md's "Local dev note").
// Runtime-agnostic: takes plain data in, returns a plain {status, body} out.
//
// Provider-agnostic by design (see CLAUDE.md's "Cost model / provider
// strategy"): a BYOK request uses the caller's own provider/key; otherwise
// it falls back to the shared free trial configured via env vars.
import { resolveProvider } from "./providers/index.ts";
import { ProviderRequestError, type IncomingMessage, type ToolDefinition } from "./providers/types.ts";
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
    toolCall?: { name: string; input: Record<string, unknown> };
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
2. createHabit — a recurring habit tracked over time. Recurring Tasks (same recurrence, but simple done/not-done tracking) aren't supported yet — if the user clearly wants a recurring task rather than a habit, use createHabit anyway rather than turning them away.
3. deleteSingleTasks — delete one-off tasks matching filters you specify.
4. deleteHabits — delete habits matching filters you specify.
5. deleteRecurringTasks — delete recurring tasks matching filters you specify (there is currently no way to create one, so this will typically find nothing — only call it if the user explicitly refers to a "recurring task").

Only call a tool when the user is clearly and explicitly asking you to add, create, or delete something. Do NOT call a tool in response to general statements, feedback, complaints, or corrections about something you already did (for example: "that was wrong", "I have one task", "you added the wrong thing") — reply in plain text instead and ask what they'd actually like.

If you don't have enough information to act — at minimum, a clear name, or for a deletion, a clear sense of what should be deleted — ask a short, single clarifying question instead of guessing, and never call a tool with a placeholder, guessed, or empty value.

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

For createHabit specifically:
- categoryId is required. Pick the best match from this list: ${categoryList}. If nothing fits, use "other" — don't ask the user to pick a category unless they seem to care about it.
- priority is a positive whole number; higher means more important. Default to 1 (the lowest priority) unless the user signals otherwise (e.g. "this is really important" → a higher number).
- startDate must be today or a future date (never in the past). If unspecified, it defaults to today automatically — leave it out. If the user explicitly asks for a start date that's already in the past, ask them to confirm what they actually meant rather than silently picking a different date.
- Map how the user describes frequency to recurrenceType:
  - "every day" / "daily" → recurrenceType "daily"
  - specific weekdays (e.g. "Mon/Wed/Fri", "on weekends") → recurrenceType "daysOfWeek" with recurrenceDays as an array of 0=Sunday..6=Saturday
  - "every N days" (e.g. "every 3 days") → recurrenceType "intervalDays" with recurrenceInterval = N
  - "N times a week/month" (not pinned to specific days) → recurrenceType "timesPerPeriod" with recurrencePeriod ("week" or "month") and recurrenceCount = N
  - If the frequency is vague (e.g. "sometimes", "regularly") ask a clarifying question instead of guessing.
- completionType defaults to "yesno" (simple done/not-done) unless the user describes tracking a number (→ "value"), a duration (→ "timer"), or a checklist of sub-items to complete (→ "checklist", with checklistItems as the list of item names).

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
            enum: ["daily", "daysOfWeek", "intervalDays", "timesPerPeriod"],
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
        },
        required: ["name", "categoryId", "recurrenceType"],
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
  ];
}

export async function handleAgentRequest(
  messages: IncomingMessage[],
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
    return { status: 200, body: result };
  } catch (err) {
    if (err instanceof ProviderRequestError) {
      return { status: err.status, body: { error: err.message } };
    }
    return { status: 500, body: { error: err instanceof Error ? err.message : "Unknown error." } };
  }
}
