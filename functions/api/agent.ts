// Cloudflare Pages Function. Holds ANTHROPIC_API_KEY server-side and proxies
// chat turns to Anthropic — the browser never sees the key. See the
// "API key security" decision in the scaffolding plan / CLAUDE.md.

interface Env {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

const SYSTEM_PROMPT = `You are the in-app assistant for Habit Assistant, a personal habit and task tracker the user controls entirely through conversation.

Right now, the only action you can take is creating a simple one-off task via the createSingleTask tool. (Habits and recurring tasks are coming in a later version — if the user asks for something recurring, explain briefly that recurring items aren't supported yet and offer to add it as a one-off task instead.)

If you don't have enough information to act — at minimum, a clear task name — ask a short, single clarifying question instead of guessing. Keep replies brief and conversational.`;

const TOOLS = [
  {
    name: "createSingleTask",
    description: "Create a single one-off task (not recurring).",
    input_schema: {
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
];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let messages: IncomingMessage[];
  try {
    const body = (await context.request.json()) as { messages: IncomingMessage[] };
    messages = body.messages;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: "Expected a non-empty `messages` array." }, 400);
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": context.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: context.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    return jsonResponse({ error: await anthropicRes.text() }, 502);
  }

  const result = (await anthropicRes.json()) as { content: AnthropicContentBlock[] };

  const toolUse = result.content.find(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  );
  const text = result.content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return jsonResponse({
    reply: text || undefined,
    toolCall: toolUse ? { name: toolUse.name, input: toolUse.input } : undefined,
  });
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
