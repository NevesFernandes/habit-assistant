// Provider-agnostic contract for the agent's "brain". Each adapter in this
// folder implements ProviderAdapter for one LLM API; handleAgentRequest.ts
// picks one via resolveProvider() and never talks to a provider directly.
// See CLAUDE.md's "Cost model / provider strategy" for why this exists.

import type { AgentHistoryMessage } from "../agentHistory.ts";

export type { AgentHistoryMessage } from "../agentHistory.ts";

// Plain JSON Schema — close enough to what Anthropic, Groq (OpenAI-style),
// and Gemini all expect that each adapter can map it with a thin rename,
// rather than needing a heavier schema abstraction.
export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
}

export interface ProviderCallArgs {
  messages: AgentHistoryMessage[];
  tools: ToolDefinition[];
  systemPrompt: string;
  apiKey: string;
  model?: string;
  // Only meaningful to workersAI.ts (§26 in Roadmap.md) — Cloudflare's REST endpoint needs
  // an account id in the URL alongside the API token in apiKey, unlike every other provider
  // here which only needs one secret. Every other adapter ignores this field.
  accountId?: string;
  // Set by handleAgentRequest.ts's per-attempt timeout (§22 in Roadmap.md) — pass straight
  // into the adapter's own fetch() so a timed-out call is actually aborted, not just raced
  // against and abandoned (which would leave the request running and still costing quota).
  signal?: AbortSignal;
}

export interface ProviderResult {
  reply?: string;
  // id is optional here: not every provider's wire format returns one
  // natively (Gemini has none) — handleAgentRequest.ts synthesizes a
  // fallback centrally so adapters don't each need their own.
  toolCall?: { id?: string; name: string; input: Record<string, unknown> };
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

export type ProviderId = "anthropic" | "groq" | "gemini" | "workersAI" | "mock";
