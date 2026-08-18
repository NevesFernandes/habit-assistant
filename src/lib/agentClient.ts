// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CreateSingleTaskToolCall {
  name: "createSingleTask";
  input: { name: string; description?: string; priority?: number };
}

export interface AgentResponse {
  reply?: string;
  toolCall?: CreateSingleTaskToolCall;
  error?: string;
}

export async function sendMessage(
  history: ChatMessage[],
  byok?: ByokSettings | null,
): Promise<AgentResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, byok: byok ?? undefined }),
  });
  const body = (await res.json()) as AgentResponse;
  if (!res.ok) {
    throw new Error(body.error ?? `Agent request failed (${res.status}).`);
  }
  return body;
}
