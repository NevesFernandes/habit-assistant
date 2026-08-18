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

const SYSTEM_PROMPT = `You are the in-app assistant for Habit Assistant, a personal habit and task tracker the user controls entirely through conversation.

Right now, the only action you can take is creating a simple one-off task via the createSingleTask tool. (Habits and recurring tasks are coming in a later version — if the user asks for something recurring, explain briefly that recurring items aren't supported yet and offer to add it as a one-off task instead.)

Only call createSingleTask when the user is clearly and explicitly asking you to add or create something new. Do NOT call it in response to general statements, feedback, complaints, or corrections about something you already did (for example: "that was wrong", "I have one task", "you added the wrong thing") — reply in plain text instead and ask what they'd actually like.

If you don't have enough information to act — at minimum, a clear task name — ask a short, single clarifying question instead of guessing, and never call the tool with a placeholder, guessed, or empty name. Keep replies brief and conversational.`;

const TOOLS: ToolDefinition[] = [
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
];

export async function handleAgentRequest(
  messages: IncomingMessage[],
  env: AgentEnv,
  byok?: Byok,
): Promise<AgentResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, body: { error: "Expected a non-empty `messages` array." } };
  }

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
      tools: TOOLS,
      systemPrompt: SYSTEM_PROMPT,
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
