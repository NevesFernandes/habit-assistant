// Talks to our own /api/agent function (never to a provider directly — the
// shared trial key stays server-side; a BYOK key, when set, is sent
// per-request and never stored server-side). See CLAUDE.md's "Cost model /
// provider strategy".
import type { ByokSettings } from "./settingsStore";
import type { Category, DayPart, WeekStart } from "../types/models";
import type { CreateHabitInput, CreateRecurringTaskInput, CreateSingleTaskInput, DeleteCriteria, UpdatePatch } from "./dataStore";
import { fetchJson, type JsonResponse } from "./fetchJson";
import { withoutDownloads, type AgentHistoryMessage } from "../server/agentHistory";
import type { AgentDebugEntry } from "../server/handleAgentRequest";

export type { AgentHistoryMessage } from "../server/agentHistory";

export interface CreateSingleTaskToolCall {
  name: "createSingleTask";
  input: CreateSingleTaskInput;
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
  input: { name: string; categoryId?: string } & UpdatePatch;
}

export interface UpdateHabitToolCall {
  name: "updateHabit";
  input: { name: string; categoryId?: string } & UpdatePatch;
}

export interface UpdateRecurringTaskToolCall {
  name: "updateRecurringTask";
  input: { name: string; categoryId?: string } & UpdatePatch;
}

export interface ArchiveHabitToolCall {
  name: "archiveHabit";
  input: { name: string; categoryId?: string };
}

export interface ArchiveRecurringTaskToolCall {
  name: "archiveRecurringTask";
  input: { name: string; categoryId?: string };
}

// §28: `from` defaults to today, `resumeOn` is the first day back (omitted = open-ended).
export interface PauseHabitToolCall {
  name: "pauseHabit";
  input: { name: string; categoryId?: string; from?: string; resumeOn?: string };
}

export interface PauseRecurringTaskToolCall {
  name: "pauseRecurringTask";
  input: { name: string; categoryId?: string; from?: string; resumeOn?: string };
}

export interface ResumeHabitToolCall {
  name: "resumeHabit";
  input: { name: string; categoryId?: string };
}

export interface ResumeRecurringTaskToolCall {
  name: "resumeRecurringTask";
  input: { name: string; categoryId?: string };
}

export interface ConfirmPendingActionToolCall {
  name: "confirmPendingAction";
  input: { confirmed: boolean };
}

export interface LogHabitProgressToolCall {
  name: "logHabitProgress";
  input: { name: string; categoryId?: string; date?: string; value?: number; delta?: number; note?: string };
}

// Several items in one call ("add milk and bread"); `text` is the older one-item
// form, still accepted in case the model copies it from earlier chat history.
export interface ChecklistAddInput {
  name: string;
  categoryId?: string;
  items?: string[];
  text?: string;
}

export interface AddRecurringTaskChecklistItemToolCall {
  name: "addRecurringTaskChecklistItem";
  input: ChecklistAddInput;
}

export interface AddSingleTaskChecklistItemToolCall {
  name: "addSingleTaskChecklistItem";
  input: ChecklistAddInput;
}

export interface CheckHabitChecklistItemToolCall {
  name: "checkHabitChecklistItem";
  input: { name: string; categoryId?: string; item: string; checked?: boolean; date?: string };
}

export interface CheckRecurringTaskChecklistItemToolCall {
  name: "checkRecurringTaskChecklistItem";
  input: { name: string; categoryId?: string; item: string; checked?: boolean; date?: string };
}

export interface CheckSingleTaskChecklistItemToolCall {
  name: "checkSingleTaskChecklistItem";
  input: { name: string; categoryId?: string; item: string; checked?: boolean };
}

// §56: one tool for all three item types — the app finds which one owns the list.
export interface RemoveChecklistItemsToolCall {
  name: "removeChecklistItems";
  input: { name: string; categoryId?: string; items?: string[]; item?: string; date?: string };
}

export interface RemoveTaskChecklistToolCall {
  name: "removeTaskChecklist";
  input: { name: string; categoryId?: string };
}

// §41: set (not toggle) whether an occurrence is done; done defaults to true.
export interface SetDoneInput {
  name: string;
  categoryId?: string;
  date?: string;
  done?: boolean;
  note?: string; // §67
}

export interface SetHabitDoneToolCall {
  name: "setHabitDone";
  input: SetDoneInput;
}

export interface SetRecurringTaskDoneToolCall {
  name: "setRecurringTaskDone";
  input: SetDoneInput;
}

// §66: reads only; the app writes the reply.
export interface GetHistoryToolCall {
  name: "getHistory";
  input: { from: string; to: string; name?: string; categoryId?: string };
}

// §67: "" removes the note.
export interface SetNoteToolCall {
  name: "setNote";
  input: { name: string; categoryId?: string; date?: string; note: string };
}

// §68: one day of a habit or recurring task; undo takes the skip back.
export interface SkipDayToolCall {
  name: "skipDay";
  input: { name: string; categoryId?: string; date?: string; undo?: boolean };
}

// §63: reads only; the app writes the reply.
export interface GetStatsToolCall {
  name: "getStats";
  input: { name?: string; categoryId?: string };
}

// §64: the app asks first; undo puts back the dates from before the last reset.
export interface ResetStatsToolCall {
  name: "resetStats";
  input: { name?: string; categoryId?: string; kind?: "habit" | "recurringTask" | "singleTask"; includeBestStreak?: boolean; undo?: boolean };
}

// §72: no dates = ask which period.
export interface ExportCsvToolCall {
  name: "exportCsv";
  input: { from?: string; to?: string };
}

// §75: one action on the items named, or on every item the filters catch.
export interface ApplyToManyToolCall {
  name: "applyToMany";
  input: {
    action: "done" | "undone" | "skip" | "pause" | "resume";
    names?: string[];
    dayPart?: DayPart;
    categoryId?: string;
    kind?: "habit" | "recurringTask" | "singleTask";
    date?: string;
    from?: string;
    resumeOn?: string;
  };
}

// §73: no dates = this week so far (or last week on its first day).
export interface GetMissedToolCall {
  name: "getMissed";
  input: { from?: string; to?: string };
}

// §69: no field set = show the settings.
export interface SettingsToolCall {
  name: "settings";
  input: { weekStartsOn?: "sunday" | "monday"; readAloud?: boolean };
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
  | PauseHabitToolCall
  | PauseRecurringTaskToolCall
  | ResumeHabitToolCall
  | ResumeRecurringTaskToolCall
  | ConfirmPendingActionToolCall
  | LogHabitProgressToolCall
  | AddRecurringTaskChecklistItemToolCall
  | AddSingleTaskChecklistItemToolCall
  | CheckHabitChecklistItemToolCall
  | CheckRecurringTaskChecklistItemToolCall
  | CheckSingleTaskChecklistItemToolCall
  | RemoveChecklistItemsToolCall
  | RemoveTaskChecklistToolCall
  | SetHabitDoneToolCall
  | SetRecurringTaskDoneToolCall
  | GetHistoryToolCall
  | SetNoteToolCall
  | SkipDayToolCall
  | GetStatsToolCall
  | ResetStatsToolCall
  | SettingsToolCall
  | GetMissedToolCall
  | ApplyToManyToolCall
  | ExportCsvToolCall;

export interface AgentResponse {
  reply?: string;
  // id is always present here (handleAgentRequest.ts synthesizes a fallback
  // for providers, like Gemini, whose wire format has none) — it round-trips
  // back into the next request's history to pair this call with its result.
  toolCall?: AgentToolCall & { id: string };
  error?: string;
  debug?: AgentDebugEntry;
}

// §27 in Roadmap.md: carries the server's debug entry even on a failed
// request (a failed/exhausted-failover call is exactly the case most worth
// seeing in the debug log), since sendMessage otherwise only throws a plain
// Error and the response body — including `debug` — would be lost.
export class AgentRequestError extends Error {
  debug?: AgentDebugEntry;
  /** The HTTP status the server answered with (§40: tells "the model is unavailable" apart). */
  status?: number;
  constructor(message: string, debug?: AgentDebugEntry, status?: number) {
    super(message);
    this.name = "AgentRequestError";
    this.debug = debug;
    this.status = status;
  }
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
  weekStartsOn?: WeekStart,
  todayISO?: string,
): Promise<AgentResponse> {
  const payload = JSON.stringify({
    messages: withoutDownloads(history), // §72
    byok: byok ?? undefined,
    categories,
    hasPendingConfirmation: hasPendingConfirmation || undefined,
    weekStartsOn: weekStartsOn || undefined,
    todayISO, // §62: the device's local date; the server's own is UTC
  });
  const { ok, status, body } = await sendWithRetry(payload);
  if (!ok) {
    throw new AgentRequestError(body.error ?? `Agent request failed (${status}).`, body.debug, status);
  }
  return body;
}
