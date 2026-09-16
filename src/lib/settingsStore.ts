// BYOK settings live in browser localStorage, mirroring AppData.byokSettings
// (see §30 in Roadmap.md) — Drive is the cross-device source of truth, but
// every existing read here stays synchronous/localStorage-backed to avoid
// rewriting every call site; App.tsx's sign-in flow is the only place that
// reconciles the two, via importState/exportState below.
//
// A key is remembered per provider (not just "the current one"), so
// switching which provider is active — e.g. for testing — doesn't lose
// whichever key isn't active right now.
import type { ByokProvider, SyncedByokSettings } from "../types/models";

export type { ByokProvider };

export interface ByokSettings {
  provider: ByokProvider;
  apiKey: string;
  model?: string;
}

const STORAGE_KEY = "habit-assistant:byok";

// A function, not a shared module-level object — loadState()'s callers mutate
// the object they get back (e.g. saveProviderKey does `state.keys[x] = ...`),
// so a single shared EMPTY_STATE.keys reference would get corrupted in place
// the first time that happened while storage was empty, and stay corrupted
// for the rest of the page's lifetime.
function emptyState(): SyncedByokSettings {
  return { activeProvider: null, keys: {} };
}

function loadState(): SyncedByokSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...(JSON.parse(raw) as SyncedByokSettings) };
  } catch {
    return emptyState();
  }
}

function saveState(state: SyncedByokSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** The full current settings blob, for App.tsx to push into AppData.byokSettings on save. */
export function exportState(): SyncedByokSettings {
  return loadState();
}

/** Overwrites local storage with a remote (Drive-sourced) blob — called only at sign-in, never mid-session (see App.tsx's applyRemoteData). No-op if remote is undefined (an old Drive file predating this field). */
export function importState(remote: SyncedByokSettings | undefined): void {
  if (!remote) return;
  saveState(remote);
}

/** True if this device has any locally-saved BYOK settings worth migrating into a Drive file that doesn't have byokSettings yet. */
export function hasLocalByokSettings(): boolean {
  const state = loadState();
  return state.activeProvider !== null || Object.keys(state.keys).length > 0;
}

/** The key saved for a given provider, if any — independent of which provider is currently active. */
export function getSavedKey(provider: ByokProvider): { apiKey: string; model?: string } | null {
  return loadState().keys[provider] ?? null;
}

/** Saves/updates a provider's key and makes it the active provider. */
export function saveProviderKey(provider: ByokProvider, apiKey: string, model?: string): void {
  const state = loadState();
  state.keys[provider] = { apiKey, model };
  state.activeProvider = provider;
  saveState(state);
}

/** Switches the active provider without touching any saved keys — including back to the shared trial (null). */
export function setActiveProvider(provider: ByokProvider | null): void {
  const state = loadState();
  state.activeProvider = provider;
  saveState(state);
}

/** Forgets a provider's saved key entirely; falls back to the trial if it was active. */
export function forgetProviderKey(provider: ByokProvider): void {
  const state = loadState();
  delete state.keys[provider];
  if (state.activeProvider === provider) state.activeProvider = null;
  saveState(state);
}

/** The settings to send with the next agent request — null means "use the shared free trial." */
export function getActiveByok(): ByokSettings | null {
  const state = loadState();
  if (!state.activeProvider) return null;
  const saved = state.keys[state.activeProvider];
  if (!saved) return null;
  return { provider: state.activeProvider, apiKey: saved.apiKey, model: saved.model };
}

// --- Speech-to-text: its own setting, independent of the chat provider above. ---
// Groq is the only viable STT option today, so this just toggles between the
// shared trial and whatever Groq key is already saved (the same one chat BYOK
// uses, if any) — no separate provider dropdown needed for a single option.

export function getSttUsesOwnKey(): boolean {
  return loadState().sttUsesOwnKey ?? false;
}

export function setSttUsesOwnKey(useOwnKey: boolean): void {
  const state = loadState();
  state.sttUsesOwnKey = useOwnKey;
  saveState(state);
}

/** null means "use the shared free STT trial." */
export function getActiveStt(): { apiKey: string } | null {
  const state = loadState();
  if (!state.sttUsesOwnKey) return null;
  const saved = state.keys.groq;
  return saved ? { apiKey: saved.apiKey } : null;
}
