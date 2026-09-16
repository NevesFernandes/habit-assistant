// The "read replies aloud" toggle is scoped per device AND per account: each
// device keeps its own on/off choice (so phone and desktop can disagree), but
// that choice travels with the account via AppData.ttsEnabledByDevice, keyed
// by a random id generated once per device and cached alongside it — rather
// than being purely local (lost if this device's storage is cleared) or
// purely shared like the rest of BYOK settings (flipping it anywhere would
// flip it everywhere).
const DEVICE_ID_KEY = "habit-assistant:device-id";
const LOCAL_CACHE_KEY = "habit-assistant:tts-enabled";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getTtsEnabled(): boolean {
  return localStorage.getItem(LOCAL_CACHE_KEY) === "true";
}

export function setTtsEnabled(enabled: boolean): void {
  localStorage.setItem(LOCAL_CACHE_KEY, String(enabled));
}

/** Reconciles this device's cached value from the account's Drive data — call only at sign-in, same rule as the rest of BYOK settings. Absent (no entry for this device yet) leaves the existing local value rather than inheriting another device's choice. */
export function importTtsEnabled(byDevice: Record<string, boolean> | undefined): void {
  const mine = byDevice?.[getDeviceId()];
  if (mine !== undefined) setTtsEnabled(mine);
}
