// §27 in Roadmap.md: a device-local, capped ring buffer of recent model
// interactions, shown behind a password gate in Settings' "Debug log"
// section (which §40 also hides unless switched on for this device, below). Deliberately localStorage-only, never synced to the Drive data
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

// §40 in Roadmap.md: the debug log is hidden from the public app. It's switched on per
// device by opening the app once at `…/#debug` (and off again at `…/#nodebug`); the
// §27 password still applies after that. Client-only by design (no server-side check), so
// it hides the section rather than securing it — a user who finds the switch only sees
// their own device's calls. While it's off, nothing is recorded either.
const ENABLED_KEY = "habit-assistant:debug-log-enabled";

export function isDebugLogEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

/** Applies a `#debug` / `#nodebug` switch in the URL, then removes it from the address bar. */
export function applyDebugLogSwitchFromUrl(): void {
  const hash = window.location.hash;
  if (hash !== "#debug" && hash !== "#nodebug") return;
  if (hash === "#debug") {
    localStorage.setItem(ENABLED_KEY, "1");
  } else {
    localStorage.removeItem(ENABLED_KEY);
    clearDebugLog();
  }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}
