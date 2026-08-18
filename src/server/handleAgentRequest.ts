// Shared agent logic used by both the Cloudflare Pages Function
// (functions/api/agent.ts, real deployment) and the local Vite dev
// middleware (vite.config.ts, used because the Workers emulator can't run
// in this sandboxed environment — see README.md's "Local dev note").
// Runtime-agnostic: takes plain data in, returns a plain {status, body} out.

export interface AgentEnv {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
}

export interface IncomingMessage {
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

export interface AgentResult {
  status: number;
  body: {
    reply?: string;
    toolCall?: { name: string; input: Record<string, unknown> };
    error?: string;
  };
}

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

export async function handleAgentRequest(
  messages: IncomingMessage[],
  env: AgentEnv,
): Promise<AgentResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, body: { error: "Expected a non-empty `messages` array." } };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { status: 500, body: { error: "ANTHROPIC_API_KEY is not configured." } };
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    return { status: 502, body: { error: await anthropicRes.text() } };
  }

  const result = (await anthropicRes.json()) as { content: AnthropicContentBlock[] };

  const toolUse = result.content.find(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  );
  const text = result.content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    status: 200,
    body: {
      reply: text || undefined,
      toolCall: toolUse ? { name: toolUse.name, input: toolUse.input } : undefined,
    },
  };
}
