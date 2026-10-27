// Canonical shape for a chat turn, shared end-to-end between the frontend
// (src/App.tsx, src/lib/agentClient.ts) and the backend (every provider
// adapter, functions/api/agent.ts, vite.config.ts's dev middleware). Kept
// under src/server/ (not src/shared/) because tsconfig.functions.json only
// includes "functions" and "src/server/**/*.ts", not all of src — this is
// the one location every tsconfig project that needs it actually typechecks.
//
// A tool call and its result are first-class history entries (not
// paraphrased into plain text) so a provider's own conversation history
// contains real "I called tool X with these args and got result Y" turns —
// see the "Replay proper tool-call/tool-result history" fix.

export interface HistoryUserMessage {
  role: "user";
  content: string;
}

export interface HistoryAssistantMessage {
  role: "assistant";
  // Friendly text shown in the chat log — the reply itself, or the summary
  // sentence for a tool call (e.g. `Added "Gym" as a habit.`).
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  // §72: a file the reply offers (an export), shown as a Download button. Never sent to
  // the model: agentClient strips it.
  download?: ChatDownload;
}

export interface ChatDownload {
  filename: string;
  /** The file's text; a CSV for now. */
  text: string;
}

export interface HistoryToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  // Deliberately reuses the same friendly text rather than inventing a
  // separate machine-readable result schema — see the fix's design notes.
  result: string;
}

export type AgentHistoryMessage = HistoryUserMessage | HistoryAssistantMessage | HistoryToolResultMessage;

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  download?: ChatDownload;
}

/** Drops tool-result entries and keeps only what belongs in the visible chat log. */
export function toDisplayMessages(history: AgentHistoryMessage[]): DisplayMessage[] {
  return history
    .filter((message): message is HistoryUserMessage | HistoryAssistantMessage => message.role !== "tool")
    .map((message) => ({
      role: message.role,
      content: message.content ?? "",
      ...(message.role === "assistant" && message.download ? { download: message.download } : {}),
    }));
}

/** §72: the history as the model gets it: an export's file stays on the device. */
export function withoutDownloads(history: AgentHistoryMessage[]): AgentHistoryMessage[] {
  return history.map((message) => {
    if (message.role !== "assistant" || !message.download) return message;
    const { download: _file, ...rest } = message;
    return rest;
  });
}
