// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";
import type { Category } from "../types/models";
import type { CreateHabitInput, CreateRecurringTaskInput, DeleteCriteria, UpdatePatch } from "./dataStore";
import { fetchJson } from "./fetchJson";
import type { AgentHistoryMessage } from "../server/agentHistory";

export type { AgentHistoryMessage } from "../server/agentHistory";

export interface CreateSingleTaskToolCall {
  name: "createSingleTask";
  input: { name: string; description?: string; priority?: number };
}

export interface CreateHabitToolCall {
  name: "createHabit";
  input: CreateHabitInput;
}

export interface CreateRecurringTaskToolCall {
  name: "createRecurringTask";
  input: CreateRecurringTaskInput;
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

export interface LogHabitProgressToolCall {
  name: "logHabitProgress";
  input: { name: string; date?: string; value?: number; delta?: number };
}

export interface AddRecurringTaskChecklistItemToolCall {
  name: "addRecurringTaskChecklistItem";
  input: { name: string; text: string };
}

export interface AddSingleTaskChecklistItemToolCall {
  name: "addSingleTaskChecklistItem";
  input: { name: string; text: string };
}

export interface CheckHabitChecklistItemToolCall {
  name: "checkHabitChecklistItem";
  input: { name: string; item: string; checked?: boolean };
}

export interface CheckRecurringTaskChecklistItemToolCall {
  name: "checkRecurringTaskChecklistItem";
  input: { name: string; item: string; checked?: boolean };
}

export interface CheckSingleTaskChecklistItemToolCall {
  name: "checkSingleTaskChecklistItem";
  input: { name: string; item: string; checked?: boolean };
}

export type AgentToolCall =
  | CreateSingleTaskToolCall
  | CreateHabitToolCall
  | CreateRecurringTaskToolCall
  | DeleteSingleTasksToolCall
  | DeleteHabitsToolCall
  | DeleteRecurringTasksToolCall
  | UpdateSingleTaskToolCall
  | UpdateHabitToolCall
  | UpdateRecurringTaskToolCall
  | ArchiveHabitToolCall
  | ArchiveRecurringTaskToolCall
  | ConfirmPendingDeletionToolCall
  | LogHabitProgressToolCall
  | AddRecurringTaskChecklistItemToolCall
  | AddSingleTaskChecklistItemToolCall
  | CheckHabitChecklistItemToolCall
  | CheckRecurringTaskChecklistItemToolCall
  | CheckSingleTaskChecklistItemToolCall;

export interface AgentResponse {
  reply?: string;
  // id is always present here (handleAgentRequest.ts synthesizes a fallback
  // for providers, like Gemini, whose wire format has none) — it round-trips
  // back into the next request's history to pair this call with its result.
  toolCall?: AgentToolCall & { id: string };
  error?: string;
}

export async function sendMessage(
  history: AgentHistoryMessage[],
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
