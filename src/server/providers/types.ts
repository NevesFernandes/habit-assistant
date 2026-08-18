// Provider-agnostic contract for the agent's "brain". Each adapter in this
// folder implements ProviderAdapter for one LLM API; handleAgentRequest.ts
// picks one via resolveProvider() and never talks to a provider directly.
// See CLAUDE.md's "Cost model / provider strategy" for why this exists.

export interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

// Plain JSON Schema — close enough to what Anthropic, Groq (OpenAI-style),
// and Gemini all expect that each adapter can map it with a thin rename,
// rather than needing a heavier schema abstraction.
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface ProviderCallArgs {
  messages: IncomingMessage[];
  tools: ToolDefinition[];
  systemPrompt: string;
  apiKey: string;
  model?: string;
}

export interface ProviderResult {
  reply?: string;
  toolCall?: { name: string; input: Record<string, unknown> };
}

export interface ProviderAdapter {
  defaultModel: string;
  send(args: ProviderCallArgs): Promise<ProviderResult>;
}

export class ProviderRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
  }
}

export type ProviderId = "anthropic" | "groq" | "gemini" | "mock";
