// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";
import type { Category } from "../types/models";
import type { CreateHabitInput, DeleteCriteria } from "./dataStore";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CreateSingleTaskToolCall {
  name: "createSingleTask";
  input: { name: string; description?: string; priority?: number };
}

export interface CreateHabitToolCall {
  name: "createHabit";
  input: CreateHabitInput;
}

export interface DeleteSingleTasksToolCall {
  name: "deleteSingleTasks";
  input: DeleteCriteria;
}

export interface DeleteHabitsToolCall {
  name: "deleteHabits";
  input: DeleteCriteria;
}

export interface DeleteRecurringTasksToolCall {
  name: "deleteRecurringTasks";
  input: DeleteCriteria;
}

export interface ConfirmPendingDeletionToolCall {
  name: "confirmPendingDeletion";
  input: { confirmed: boolean };
}

export type AgentToolCall =
  | CreateSingleTaskToolCall
  | CreateHabitToolCall
  | DeleteSingleTasksToolCall
  | DeleteHabitsToolCall
  | DeleteRecurringTasksToolCall
  | ConfirmPendingDeletionToolCall;

export interface AgentResponse {
  reply?: string;
  toolCall?: AgentToolCall;
  error?: string;
}

export async function sendMessage(
  history: ChatMessage[],
  byok?: ByokSettings | null,
  categories?: Category[],
  hasPendingConfirmation?: boolean,
): Promise<AgentResponse> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history,
      byok: byok ?? undefined,
      categories,
      hasPendingConfirmation: hasPendingConfirmation || undefined,
    }),
  });
  const body = (await res.json()) as AgentResponse;
  if (!res.ok) {
    throw new Error(body.error ?? `Agent request failed (${res.status}).`);
  }
  return body;
}
