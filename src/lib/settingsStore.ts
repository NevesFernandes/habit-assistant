// BYOK settings live in browser localStorage, deliberately not the
// Drive-synced data file — API keys are per-device secrets, while the Drive
// file is meant to hold habit/task data, not credentials.
//
// A key is remembered per provider (not just "the current one"), so
// switching which provider is active — e.g. for testing — doesn't lose
// whichever key isn't active right now.

export type ByokProvider = "anthropic" | "groq" | "gemini";

export interface ByokSettings {
  provider: ByokProvider;
  apiKey: string;
  model?: string;
}

interface StoredState {
  activeProvider: ByokProvider | null; // null = use the shared free trial
  keys: Partial<Record<ByokProvider, { apiKey: string; model?: string }>>;
}

const STORAGE_KEY = "habit-assistant:byok";

function loadState(): StoredState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { activeProvider: null, keys: {} };
  try {
    return JSON.parse(raw) as StoredState;
  } catch {
    return { activeProvider: null, keys: {} };
  }
}

function saveState(state: StoredState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
