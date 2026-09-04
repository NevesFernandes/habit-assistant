// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";
import type { Category } from "../types/models";
import type { CreateHabitInput, CreateRecurringTaskInput, DeleteCriteria, UpdatePatch } from "./dataStore";
import { fetchJson, type JsonResponse } from "./fetchJson";
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
  input: { name: string; item: string; checked?: boolean; date?: string };
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

// §22 in Roadmap.md: a chat call gets a timeout (turns a hang into a loud failure instead of
// leaving "Thinking…" up forever) and one retry on a network failure or a 5xx-ish response —
// mirrors driveClient.ts's fetchWithRetry, adapted for the fact that fetchJson throws on a
// true network failure/timeout rather than returning an {ok: false} result, so the retry has
// to catch that throw too, not just check `.ok`.
//
// Deliberately well above the server's own worst case (handleAgentRequest.ts: up to 2
// providers x 2 attempts x 15s PROVIDER_TIMEOUT_MS + a 500ms retry delay between same-provider
// attempts, ~61s) — a client timeout equal to or below that could abort a request right as the
// server's own retry/failover was about to succeed, discarding a near-complete response and
// then paying for a full second attempt on top of it.
const CHAT_TIMEOUT_MS = 75_000;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function attemptSend(payload: string): Promise<JsonResponse<AgentResponse>> {
  return fetchJson<AgentResponse>("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
}

async function sendWithRetry(payload: string): Promise<JsonResponse<AgentResponse>> {
  try {
    const first = await attemptSend(payload);
    if (!RETRYABLE_STATUS.has(first.status)) return first;
  } catch {
    // Network failure or timeout on the first attempt — fall through to one retry.
  }
  return attemptSend(payload); // second attempt's outcome (success, a different error, or another throw) is final
}

export async function sendMessage(
  history: AgentHistoryMessage[],
  byok?: ByokSettings | null,
  categories?: Category[],
  hasPendingConfirmation?: boolean,
): Promise<AgentResponse> {
  const payload = JSON.stringify({
    messages: history,
    byok: byok ?? undefined,
    categories,
    hasPendingConfirmation: hasPendingConfirmation || undefined,
  });
  const { ok, status, body } = await sendWithRetry(payload);
  if (!ok) {
    throw new Error(body.error ?? `Agent request failed (${status}).`);
  }
  return body;
}
