import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";

// Zero-cost, dev-only stand-in — no network call, no API key needed. Crude
// keyword matching, not real NLU: it exists so the full UI -> Drive-write
// path can be exercised for free while iterating on anything that isn't
// specifically about agent reasoning quality.
const CREATE_PATTERNS = [/^add (?:a )?task to (.+)/i, /^add (?:a )?task[: ]+(.+)/i, /^remind me to (.+)/i];
const HABIT_PATTERNS = [/^add (?:a )?habit to (.+)/i, /^add (?:a )?habit[: ]+(.+)/i];

const DELETE_ALL_HABITS = /^delete all habits/i;
const DELETE_HABIT_BY_NAME = /^delete (?:the )?habit[: ]+(.+)/i;
const DELETE_TASKS_TODAY = /^delete all tasks for today/i;
const DELETE_ALL_TASKS = /^delete all tasks/i;
const DELETE_TASK_BY_NAME = /^delete (?:the )?task[: ]+(.+)/i;
const YES_PATTERN = /^(yes|yep|yeah|confirm|do it|go ahead)\b/i;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const mockAdapter: ProviderAdapter = {
  defaultModel: "mock",

  async send({ messages, tools }: ProviderCallArgs): Promise<ProviderResult> {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const text = lastUserMessage?.content.trim() ?? "";

    // A pending deletion restricts the real tool list to just this one entry.
    if (tools.some((tool) => tool.name === "confirmPendingDeletion")) {
      return { toolCall: { name: "confirmPendingDeletion", input: { confirmed: YES_PATTERN.test(text) } } };
    }

    if (DELETE_ALL_HABITS.test(text)) {
      return { toolCall: { name: "deleteHabits", input: { scope: "all" } } };
    }
    const habitNameMatch = text.match(DELETE_HABIT_BY_NAME);
    if (habitNameMatch) {
      return {
        toolCall: { name: "deleteHabits", input: { scope: "byName", name: habitNameMatch[1].replace(/\.$/, "").trim() } },
      };
    }
    if (DELETE_TASKS_TODAY.test(text)) {
      return { toolCall: { name: "deleteSingleTasks", input: { scope: "byDate", date: today() } } };
    }
    if (DELETE_ALL_TASKS.test(text)) {
      return { toolCall: { name: "deleteSingleTasks", input: { scope: "all" } } };
    }
    const taskNameMatch = text.match(DELETE_TASK_BY_NAME);
    if (taskNameMatch) {
      return {
        toolCall: {
          name: "deleteSingleTasks",
          input: { scope: "byName", name: taskNameMatch[1].replace(/\.$/, "").trim() },
        },
      };
    }

    for (const pattern of HABIT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const name = capitalize(match[1].replace(/\.$/, "").trim());
        return {
          toolCall: {
            name: "createHabit",
            input: { name, categoryId: "other", recurrenceType: "daily" },
          },
        };
      }
    }

    for (const pattern of CREATE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const name = capitalize(match[1].replace(/\.$/, "").trim());
        return { toolCall: { name: "createSingleTask", input: { name } } };
      }
    }

    if (/\btask\b/i.test(text)) {
      return { toolCall: { name: "createSingleTask", input: { name: capitalize(text) } } };
    }

    return { reply: "(mock provider) What would you like me to add as a task?" };
  },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default mockAdapter;
