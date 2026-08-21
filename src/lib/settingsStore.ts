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
  activeProvider: ByokProvider | null; // null = use the shared free trial (chat)
  keys: Partial<Record<ByokProvider, { apiKey: string; model?: string }>>;
  sttUsesOwnKey?: boolean; // independent of `activeProvider` — see getActiveStt()
  ttsEnabled?: boolean; // independent of everything above — see getTtsEnabled()
}

const STORAGE_KEY = "habit-assistant:byok";
const EMPTY_STATE: StoredState = { activeProvider: null, keys: {} };

function loadState(): StoredState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...EMPTY_STATE };
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(raw) as StoredState) };
  } catch {
    return { ...EMPTY_STATE };
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

// --- Text-to-speech: whether assistant replies are read aloud. Uses the
// browser's built-in SpeechSynthesis, so there's no key/provider to choose —
// just an on/off toggle, off by default (opt-in, like voice input itself). ---

export function getTtsEnabled(): boolean {
  return loadState().ttsEnabled ?? false;
}

export function setTtsEnabled(enabled: boolean): void {
  const state = loadState();
  state.ttsEnabled = enabled;
  saveState(state);
}
