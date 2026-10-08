// BYOK settings live in browser localStorage, mirroring AppData.byokSettings
// (see §30 in Roadmap.md) — Drive is the cross-device source of truth (except for a key
// kept on this device only, §47), but
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

// §47: what this browser holds. On top of the synced settings, the providers whose key
// stays on this device only — a list that itself never leaves the device.
interface LocalByokState extends SyncedByokSettings {
  deviceOnly?: ByokProvider[];
}

// A function, not a shared module-level object — loadState()'s callers mutate
// the object they get back (e.g. saveProviderKey does `state.keys[x] = ...`),
// so a single shared EMPTY_STATE.keys reference would get corrupted in place
// the first time that happened while storage was empty, and stay corrupted
// for the rest of the page's lifetime.
function emptyState(): LocalByokState {
  return { activeProvider: null, keys: {} };
}

function loadState(): LocalByokState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...(JSON.parse(raw) as LocalByokState) };
  } catch {
    return emptyState();
  }
}

function saveState(state: LocalByokState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// A provider counts as device-only only while its key is actually here.
function deviceOnlyProviders(state: LocalByokState): ByokProvider[] {
  return (state.deviceOnly ?? []).filter((provider) => state.keys[provider] !== undefined);
}

/**
 * What goes to the Drive file (App.tsx pushes it into AppData.byokSettings on save). §47: a
 * device-only key is left out, always — which is also what takes a key that used to be
 * synced back out of the file. The choices that depend on such a key (it being the active
 * provider; voice input using the Groq key) stay on this device too: for those the Drive
 * file keeps whatever it had, passed in as `remote`, so this device neither announces a
 * key other devices don't have nor undoes their own choice.
 */
export function exportState(remote?: SyncedByokSettings): SyncedByokSettings {
  const state = loadState();
  const local = deviceOnlyProviders(state);
  const keys = { ...state.keys };
  for (const provider of local) delete keys[provider];

  const remoteActive = remote?.activeProvider ?? null;
  const activeProvider =
    state.activeProvider !== null && local.includes(state.activeProvider)
      ? remoteActive !== null && keys[remoteActive] !== undefined
        ? remoteActive
        : null
      : state.activeProvider;
  const sttUsesOwnKey = local.includes("groq") ? remote?.sttUsesOwnKey : state.sttUsesOwnKey;

  const exported: SyncedByokSettings = { activeProvider, keys };
  if (sttUsesOwnKey !== undefined) exported.sttUsesOwnKey = sttUsesOwnKey;
  return exported;
}

/**
 * Takes a remote (Drive-sourced) blob into local storage — called only at sign-in, never
 * mid-session (see App.tsx's applyRemoteData). No-op if remote is undefined (an old Drive
 * file predating this field). §47: this device's device-only keys survive it, whether
 * Drive has another key for that provider or none, and so do the choices that depend on
 * them (see exportState).
 */
export function importState(remote: SyncedByokSettings | undefined): void {
  if (!remote) return;
  const state = loadState();
  const local = deviceOnlyProviders(state);
  const keys = { ...remote.keys };
  for (const provider of local) keys[provider] = state.keys[provider];

  const next: LocalByokState = {
    ...remote,
    keys,
    activeProvider: state.activeProvider !== null && local.includes(state.activeProvider) ? state.activeProvider : remote.activeProvider,
  };
  if (local.includes("groq")) {
    if (state.sttUsesOwnKey === undefined) delete next.sttUsesOwnKey;
    else next.sttUsesOwnKey = state.sttUsesOwnKey;
  }
  if (local.length > 0) next.deviceOnly = local;
  saveState(next);
}

/** True if this device has settings worth migrating into a Drive file that doesn't have byokSettings yet — syncable ones, so not a device-only key (§47). */
export function hasLocalByokSettings(): boolean {
  const state = exportState();
  return state.activeProvider !== null || Object.keys(state.keys).length > 0;
}

/** §47: whether a provider's saved key stays on this device instead of syncing to Drive. */
export function isDeviceOnly(provider: ByokProvider): boolean {
  return deviceOnlyProviders(loadState()).includes(provider);
}

/** §47: what the option starts as for a key not saved yet. An Anthropic key always has billing behind it. */
export function defaultDeviceOnly(provider: ByokProvider): boolean {
  return provider === "anthropic";
}

function withDeviceOnly(state: LocalByokState, provider: ByokProvider, on: boolean): void {
  const others = (state.deviceOnly ?? []).filter((id) => id !== provider);
  const next = on ? [...others, provider] : others;
  if (next.length > 0) state.deviceOnly = next;
  else delete state.deviceOnly;
}

/** §47: switches a saved key between device-only and synced. The caller persists, which is what rewrites the Drive file. */
export function setDeviceOnly(provider: ByokProvider, on: boolean): void {
  const state = loadState();
  if (state.keys[provider] === undefined) return;
  withDeviceOnly(state, provider, on);
  saveState(state);
}

/** The key saved for a given provider, if any — independent of which provider is currently active. */
export function getSavedKey(provider: ByokProvider): { apiKey: string; model?: string } | null {
  return loadState().keys[provider] ?? null;
}

/** Saves/updates a provider's key and makes it the active provider. `deviceOnly` (§47) keeps it out of the Drive file. */
export function saveProviderKey(provider: ByokProvider, apiKey: string, model?: string, deviceOnly: boolean = false): void {
  const state = loadState();
  state.keys[provider] = { apiKey, model };
  state.activeProvider = provider;
  withDeviceOnly(state, provider, deviceOnly);
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
  withDeviceOnly(state, provider, false);
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
