// BYOK settings live in browser localStorage, deliberately not the
// Drive-synced data file — API keys are per-device secrets, while the Drive
// file is meant to hold habit/task data, not credentials.

export type ByokProvider = "anthropic" | "groq" | "gemini";

export interface ByokSettings {
  provider: ByokProvider;
  apiKey: string;
  model?: string;
}

const STORAGE_KEY = "habit-assistant:byok";

export function loadByokSettings(): ByokSettings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ByokSettings;
  } catch {
    return null;
  }
}

export function saveByokSettings(settings: ByokSettings | null): void {
  if (settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
