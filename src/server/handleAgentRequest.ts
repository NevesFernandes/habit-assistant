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

You can take two kinds of action:
1. createSingleTask — a one-off task, done/not-done, no recurrence.
2. createHabit — a recurring habit tracked over time. Recurring Tasks (same recurrence, but simple done/not-done tracking) aren't supported yet — if the user clearly wants a recurring task rather than a habit, use createHabit anyway rather than turning them away.

Only call one of these tools when the user is clearly and explicitly asking you to add or create something new. Do NOT call a tool in response to general statements, feedback, complaints, or corrections about something you already did (for example: "that was wrong", "I have one task", "you added the wrong thing") — reply in plain text instead and ask what they'd actually like.

If you don't have enough information to act — at minimum, a clear name — ask a short, single clarifying question instead of guessing, and never call a tool with a placeholder, guessed, or empty name.

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

function buildTools(categories: Category[]): ToolDefinition[] {
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
  ];
}

export async function handleAgentRequest(
  messages: IncomingMessage[],
  env: AgentEnv,
  byok?: Byok,
  categories: Category[] = [],
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
    const result = await provider.send({
      messages,
      tools: buildTools(availableCategories),
      systemPrompt: buildSystemPrompt(availableCategories, new Date().toISOString().slice(0, 10)),
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
