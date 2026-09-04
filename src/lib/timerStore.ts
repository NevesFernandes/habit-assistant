// The live timer (§19 in Roadmap.md) lives in browser localStorage, deliberately not the
// Drive-synced data file — device-local by design (no cross-device sync), mirroring
// settingsStore.ts's existing localStorage pattern exactly. Only ever one slot: "one timer
// at a time" (decided requirement) means there's fundamentally one thing to persist, whether
// it's a running/paused session or a stopped-but-not-yet-saved record.

export type TimerMode = "stopwatch" | "countdown";

export interface RunningTimerState {
  kind: "session";
  mode: TimerMode;
  status: "running" | "paused";
  habitId?: string;
  targetMs?: number; // countdown only
  elapsedMs: number; // authoritative as of the last persist; see computeElapsedMs
  startedAtEpochMs?: number; // wall-clock anchor, only meaningful while status is "running"
}

export interface PendingTimerRecord {
  kind: "pending";
  elapsedMs: number;
  habitId?: string;
}

export type StoredTimerState = RunningTimerState | PendingTimerRecord;

const STORAGE_KEY = "habit-assistant:timer";

export function loadTimerState(): StoredTimerState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTimerState;
  } catch {
    return null;
  }
}

export function saveTimerState(state: StoredTimerState | null): void {
  if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  else localStorage.removeItem(STORAGE_KEY);
}

// The single source of truth for "how far along is this session" — used both for live
// ticking display and to detect a countdown reaching its target. A paused session is
// unaffected by `now` (elapsedMs is already authoritative); a running one adds the
// wall-clock diff since startedAtEpochMs, so it stays accurate through backgrounding
// without needing a precise tick rate.
export function computeElapsedMs(session: RunningTimerState, now: number): number {
  if (session.status !== "running" || session.startedAtEpochMs === undefined) return session.elapsedMs;
  return session.elapsedMs + Math.max(0, now - session.startedAtEpochMs);
}
