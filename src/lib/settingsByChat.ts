// §69: the settings a chat can show and change, for the app's chat and the Claude connector
// alike: the first day of the week (synced) and reading replies aloud (per device). API keys,
// the chat provider and voice transcription stay in Settings: a key typed into a chat would
// go to the model provider and sit in the history. Pure: no Drive, no localStorage.
import { weekStartOf, type AppData, type WeekStart } from "../types/models.ts";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const NOT_BY_CHAT = "API keys, the chat provider and voice transcription are changed in Settings (⚙), not by chat.";

export function withWeekStart(data: AppData, weekStartsOn: WeekStart): AppData {
  return { ...data, weekStartsOn };
}

export function describeWeekStart(before: WeekStart, after: WeekStart): string {
  if (before === after) return `Weeks already start on ${WEEKDAY_NAMES[after]}.`;
  return `Weeks now start on ${WEEKDAY_NAMES[after]}. "This week" and the weekly counts follow it, past weeks included.`;
}

/** One device's read-aloud: its own choice, else the "everywhere" one, else off. */
export function readAloudOn(data: AppData, deviceId: string): boolean {
  return data.ttsEnabledByDevice?.[deviceId] ?? data.ttsEnabledDefault ?? false;
}

/** The app's chat: this device only, as its Settings toggle does. */
export function withReadAloudHere(data: AppData, deviceId: string, on: boolean): AppData {
  return { ...data, ttsEnabledByDevice: { ...data.ttsEnabledByDevice, [deviceId]: on } };
}

/** The connector, which has no device: every device that has an entry, and any that comes later. */
export function withReadAloudEverywhere(data: AppData, on: boolean): AppData {
  const byDevice = Object.fromEntries(Object.keys(data.ttsEnabledByDevice ?? {}).map((id) => [id, on]));
  return { ...data, ttsEnabledByDevice: byDevice, ttsEnabledDefault: on };
}

/** "on", "off", or "on on some devices, off on others" — for the connector. */
export function readAloudEverywhere(data: AppData): string {
  const values = new Set(Object.values(data.ttsEnabledByDevice ?? {}));
  if (data.ttsEnabledDefault !== undefined) values.add(data.ttsEnabledDefault);
  return values.size > 1 ? "on on some devices, off on others" : values.has(true) ? "on" : "off";
}

export function describeReadAloudHere(before: boolean, after: boolean): string {
  if (before === after) return after ? "Replies are already read aloud on this device." : "Replies already aren't read aloud on this device.";
  return after ? "I'll read replies aloud on this device from now on." : "I'll stop reading replies aloud on this device.";
}

export function describeReadAloudEverywhere(after: boolean): string {
  return `Read-aloud is now ${after ? "on" : "off"} in the Habit Assistant app on every device, from when the app is next opened or brought back to the screen.`;
}

/** The app's answer to "what are my settings?". */
export function describeSettings(data: AppData, readAloudHere: boolean): string {
  return [
    "Your settings:",
    `• First day of the week: ${WEEKDAY_NAMES[weekStartOf(data)]}`,
    `• Read replies aloud on this device: ${readAloudHere ? "on" : "off"}`,
    NOT_BY_CHAT,
  ].join("\n");
}
