// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";
import type { Category } from "../types/models";
import type { CreateHabitInput, DeleteCriteria, UpdatePatch } from "./dataStore";
import { fetchJson } from "./fetchJson";

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

export interface UpdateSingleTaskToolCall {
  name: "updateSingleTask";
  input: { name: string } & UpdatePatch;
}

export interface UpdateHabitToolCall {
  name: "updateHabit";
  input: { name: string } & UpdatePatch;
}

export interface UpdateRecurringTaskToolCall {
  name: "updateRecurringTask";
  input: { name: string } & UpdatePatch;
}

export interface ArchiveHabitToolCall {
  name: "archiveHabit";
  input: { name: string };
}

export interface ArchiveRecurringTaskToolCall {
  name: "archiveRecurringTask";
  input: { name: string };
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
  | UpdateSingleTaskToolCall
  | UpdateHabitToolCall
  | UpdateRecurringTaskToolCall
  | ArchiveHabitToolCall
  | ArchiveRecurringTaskToolCall
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
  const { ok, status, body } = await fetchJson<AgentResponse>("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history,
      byok: byok ?? undefined,
      categories,
      hasPendingConfirmation: hasPendingConfirmation || undefined,
    }),
  });
  if (!ok) {
    throw new Error(body.error ?? `Agent request failed (${status}).`);
  }
  return body;
}
