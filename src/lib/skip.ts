// §68: skip one day of a habit or recurring task ("I'm sick today, skip gym"). Stored as a
// one-day pause flagged `skip`, so occursOn, streaks and stats treat it like any paused
// day (neither done nor missed) with nothing new to teach them. Today or later only: the
// app looks forward, never at managing the past. Shared by the app's chat and the connector.
import type { AppData, Habit, PausePeriod, RecurringTask } from "../types/models.ts";
import { addDays, isPausedOn, occursOn } from "./recurrence.ts";
import { isHabitEntryComplete } from "./habitStats.ts";
import { formatDate } from "./confirmations.ts";

type Skippable = Habit | RecurringTask;

export function skipOn(item: { pauses?: PausePeriod[] }, dateISO: string): PausePeriod | undefined {
  return item.pauses?.find((pause) => pause.skip && pause.from === dateISO);
}

/** Why `dateISO` can't be skipped, in words for the user; undefined when it can. */
export function skipRefusal(data: AppData, item: Skippable, dateISO: string, todayISO: string): string | undefined {
  const day = formatDate(dateISO, todayISO);
  if (dateISO < todayISO) return `I can only skip today or a later day, not ${day}.`;
  if (item.recurrence.type === "timesPerPeriod") {
    return `"${item.name}" is ${item.recurrence.count} times a ${item.recurrence.period}, with no set day to skip — any day you don't do it already counts as neither done nor missed.`;
  }
  if (skipOn(item, dateISO)) return `"${item.name}" is already skipped on ${day}.`;
  if (isPausedOn(item, dateISO)) return `"${item.name}" is already paused on ${day}.`;
  if (!occursOn(item, dateISO)) return `"${item.name}" isn't due on ${day}, so there's nothing to skip.`;
  const entry = data.completionLog.find((e) => e.itemId === item.id && e.date === dateISO);
  const done = item.kind === "habit" ? isHabitEntryComplete(item, entry) : !!entry;
  if (done) return `"${item.name}" is already done on ${day}. Undo it first if you want to skip it.`;
  return undefined;
}

export function skipDay(data: AppData, item: Skippable, dateISO: string): AppData {
  const pause: PausePeriod = { from: dateISO, resumeOn: addDays(dateISO, 1), skip: true };
  return withPauses(data, item, [...(item.pauses ?? []), pause]);
}

/** Undoes a skip on today or a later day; a past one stays, like a finished pause. */
export function unskipDay(data: AppData, item: Skippable, dateISO: string): AppData {
  return withPauses(data, item, (item.pauses ?? []).filter((pause) => !(pause.skip && pause.from === dateISO)));
}

function withPauses(data: AppData, item: Skippable, pauses: PausePeriod[]): AppData {
  return item.kind === "habit"
    ? { ...data, habits: data.habits.map((h) => (h.id === item.id ? { ...h, pauses } : h)) }
    : { ...data, recurringTasks: data.recurringTasks.map((t) => (t.id === item.id ? { ...t, pauses } : t)) };
}

/** "today (Wed 28 Oct)", "tomorrow (…)", or "on Fri 30 Oct". */
function onDay(dateISO: string, todayISO: string): string {
  const day = formatDate(dateISO, todayISO);
  return /^(today|tomorrow)/.test(day) ? day : `on ${day}`;
}

export function describeSkip(item: Skippable, dateISO: string, todayISO: string): string {
  return `Skipped "${item.name}" ${onDay(dateISO, todayISO)}. It counts as neither done nor missed, so your streak is safe.`;
}

export function describeUnskip(item: Skippable, dateISO: string, todayISO: string): string {
  return `"${item.name}" is back on ${onDay(dateISO, todayISO)}; it's no longer skipped.`;
}
