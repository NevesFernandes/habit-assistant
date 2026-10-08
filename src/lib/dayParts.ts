// §54: the day in its natural order. Every item belongs to one part of the day, and lists
// read top to bottom like a day: by part, then important items first, then by name. This
// replaced the open-ended priority number, which only ever set sort order. Type-only
// imports, so it's runnable under node for tests.
import type { BaseItem, DayPart } from "../types/models.ts";

export const DAY_PARTS: { id: DayPart; label: string }[] = [
  { id: "wakeUp", label: "Wake-up" },
  { id: "morning", label: "Morning" },
  { id: "workDay", label: "Work day" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
  { id: "bedtime", label: "Bedtime" },
];

/** The heading for items saved before §54 that nobody has placed yet. New items always get a part. */
export const UNPLACED_LABEL = "Not placed yet";

export function isDayPart(value: unknown): value is DayPart {
  return DAY_PARTS.some((part) => part.id === value);
}

export function dayPartLabel(part: DayPart | undefined): string {
  return DAY_PARTS.find((entry) => entry.id === part)?.label ?? UNPLACED_LABEL;
}

type Placed = Pick<BaseItem, "dayPart" | "important" | "priority" | "name">;

// Unplaced items sort after every part.
function partRank(item: Pick<BaseItem, "dayPart">): number {
  const index = DAY_PARTS.findIndex((part) => part.id === item.dayPart);
  return index < 0 ? DAY_PARTS.length : index;
}

/**
 * Whether the item is flagged important. An item from before §54 has no flag, only its old
 * priority number: above the default (1) it counts as important, until the flag is set
 * either way. No migration write is needed for that.
 */
export function isImportant(item: Pick<BaseItem, "important" | "priority">): boolean {
  return item.important ?? (item.priority ?? 0) > 1;
}

/** Sort order for every list: part of the day, important first, then name. */
export function compareForDay(a: Placed, b: Placed): number {
  return partRank(a) - partRank(b) || Number(isImportant(b)) - Number(isImportant(a)) || a.name.localeCompare(b.name);
}

export interface DayPartGroup<T> {
  part: DayPart | undefined; // undefined = not placed yet
  label: string;
  items: T[];
}

/** Items under their part's heading, in day order, with empty parts left out and unplaced items last. */
export function groupByDayPart<T>(items: T[], itemOf: (entry: T) => Placed): DayPartGroup<T>[] {
  const sorted = items.slice().sort((a, b) => compareForDay(itemOf(a), itemOf(b)));
  const groups: DayPartGroup<T>[] = [];
  for (const entry of sorted) {
    const placed = itemOf(entry).dayPart;
    const part = isDayPart(placed) ? placed : undefined;
    const last = groups[groups.length - 1];
    if (last && last.part === part) last.items.push(entry);
    else groups.push({ part, label: dayPartLabel(part), items: [entry] });
  }
  return groups;
}
