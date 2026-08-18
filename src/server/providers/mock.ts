import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";

// Zero-cost, dev-only stand-in — no network call, no API key needed. Crude
// keyword matching, not real NLU: it exists so the full UI -> Drive-write
// path can be exercised for free while iterating on anything that isn't
// specifically about agent reasoning quality.
const CREATE_PATTERNS = [/^add (?:a )?task to (.+)/i, /^add (?:a )?task[: ]+(.+)/i, /^remind me to (.+)/i];
const HABIT_PATTERNS = [/^add (?:a )?habit to (.+)/i, /^add (?:a )?habit[: ]+(.+)/i];

const mockAdapter: ProviderAdapter = {
  defaultModel: "mock",

  async send({ messages }: ProviderCallArgs): Promise<ProviderResult> {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const text = lastUserMessage?.content.trim() ?? "";

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
