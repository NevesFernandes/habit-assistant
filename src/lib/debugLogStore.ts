// §27 in Roadmap.md: a device-local, capped ring buffer of recent model
// interactions, shown behind a password gate in Settings' "Debug log"
// section. Deliberately localStorage-only, never synced to the Drive data
// file — this is debugging data about this browser's sessions, not habit
// data — mirroring timerStore.ts's persistence pattern exactly.
import type { AgentDebugEntry } from "../server/handleAgentRequest";

export type DebugLogEntry = AgentDebugEntry;

const STORAGE_KEY = "habit-assistant:debug-log";
const MAX_ENTRIES = 50;

export function loadDebugLog(): DebugLogEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DebugLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveDebugLog(entries: DebugLogEntry[]): void {
  if (entries.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  else localStorage.removeItem(STORAGE_KEY);
}

export function appendDebugLogEntry(entry: DebugLogEntry): void {
  const next = [...loadDebugLog(), entry].slice(-MAX_ENTRIES);
  saveDebugLog(next);
}

export function clearDebugLog(): void {
  saveDebugLog([]);
}
