// Talks to our own /api/agent function (never to Anthropic directly — the
// API key stays server-side, see CLAUDE.md's "Agent / LLM" architecture note).

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
}

export async function sendMessage(history: ChatMessage[]): Promise<AgentResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
  });
  if (!res.ok) {
    throw new Error(`Agent request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
