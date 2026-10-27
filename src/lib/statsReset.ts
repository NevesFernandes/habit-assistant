// §64: start the stats over, for one item, a category or everything. Never erases history:
// it sets a "count from" date (statsFrom, today) that streaks, completion % and counts start
// at, while the completion log and the heatmap keep the past. The best streak survives
// unless the user explicitly asks to reset it too (bestStreakFrom). Always asked first.
// "Undo the reset" puts back the dates from before it. Shared by the app's chat and the
// Claude connector (which never resets the best streak: its frozen tool has no input for it).
import type { AppData, Category, Habit, RecurringTask, SingleTask, WeekStart } from "../types/models.ts";
import { computeHabitStats, statsCountFrom } from "./habitStats.ts";
import { asTrackable } from "./taskStats.ts";
import { formatDate } from "./confirmations.ts";

type Item = Habit | RecurringTask | SingleTask;
type Kind = Item["kind"];

export type ResetScope = { kind: "item"; item: Item } | { kind: "category"; categoryId: string } | { kind: "all" };

const NOUNS: Record<Kind, [string, string]> = {
  habit: ["habit", "habits"],
  recurringTask: ["recurring task", "recurring tasks"],
  singleTask: ["one-off task", "one-off tasks"],
};

/** The items a reset covers; a single one-off task is refused by the caller (resetRefusal). */
export function resetTargets(data: AppData, scope: ResetScope, type?: Kind): Item[] {
  if (scope.kind === "item") return [scope.item];
  const all: Item[] = [...data.habits, ...data.recurringTasks, ...data.singleTasks];
  return all.filter((item) => (!type || item.kind === type) && (scope.kind === "all" || item.categoryId === scope.categoryId));
}

export function resetRefusal(scope: ResetScope, targets: Item[]): string | undefined {
  if (scope.kind === "item" && scope.item.kind === "singleTask") {
    return `"${scope.item.name}" is a one-off task, which has no stats of its own to reset. One-off tasks are counted together: reset them with "reset my one-off task stats".`;
  }
  if (targets.length === 0) return "There's nothing there to reset.";
  return undefined;
}

function describeTargets(targets: Item[], scope: ResetScope, categories: Category[]): string {
  if (scope.kind === "item") return `"${targets[0].name}"`;
  const counts = (Object.keys(NOUNS) as Kind[])
    .map((kind) => [kind, targets.filter((t) => t.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${NOUNS[kind][n === 1 ? 0 : 1]}`);
  const where = scope.kind === "category" ? ` in ${categories.find((c) => c.id === scope.categoryId)?.name ?? "that category"}` : "";
  return `${counts.join(", ")}${where}`;
}

function bestStreakOf(data: AppData, item: Item, todayISO: string, weekStartsOn: WeekStart): number {
  if (item.kind === "singleTask") return 0;
  const tracked = item.kind === "habit" ? item : asTrackable(item);
  return computeHabitStats(tracked, data.completionLog, todayISO, weekStartsOn).bestStreak;
}

/**
 * The question asked before a reset. `bestStreakNote` says how to reset the best streak
 * too (the app's chat), or that it can't be from here (the connector).
 */
export function describeResetQuestion(
  data: AppData,
  scope: ResetScope,
  targets: Item[],
  todayISO: string,
  weekStartsOn: WeekStart,
  options: { includeBestStreak: boolean; bestStreakNote: string },
): string {
  const day = formatDate(todayISO, todayISO);
  const base = `Start the stats over from ${day} for ${describeTargets(targets, scope, data.categories)}? Streaks, completion % and counts begin again from ${day}; the history and heatmap stay.`;
  const streaky = targets.filter((item) => item.kind !== "singleTask");
  if (streaky.length === 0) return base;
  if (options.includeBestStreak) return `${base} The best streak starts over too.`;
  const best = scope.kind === "item" ? bestStreakOf(data, targets[0], todayISO, weekStartsOn) : undefined;
  const kept = best !== undefined ? `The best streak (${best}) stays.` : "Best streaks stay.";
  return `${base} ${kept} ${options.bestStreakNote}`.trim();
}

export function resetStats(data: AppData, ids: Set<string>, todayISO: string, includeBestStreak: boolean): AppData {
  const reset = <T extends Item>(item: T): T => {
    if (!ids.has(item.id)) return item;
    const { statsFrom, bestStreakFrom } = item;
    // A second reset the same day keeps the first one's undo point.
    const statsUndo =
      statsFrom === todayISO && item.statsUndo
        ? item.statsUndo
        : { ...(statsFrom ? { statsFrom } : {}), ...(bestStreakFrom ? { bestStreakFrom } : {}) };
    return {
      ...item,
      statsFrom: todayISO,
      ...(includeBestStreak && item.kind !== "singleTask" ? { bestStreakFrom: todayISO } : {}),
      statsUndo,
    };
  };
  return { ...data, habits: data.habits.map(reset), recurringTasks: data.recurringTasks.map(reset), singleTasks: data.singleTasks.map(reset) };
}

/** Items in `targets` that a reset can be undone on. */
export function undoable(targets: Item[]): Item[] {
  return targets.filter((item) => item.statsUndo !== undefined);
}

export function undoReset(data: AppData, ids: Set<string>): AppData {
  const undo = <T extends Item>(item: T): T => {
    if (!ids.has(item.id) || !item.statsUndo) return item;
    const { statsFrom: _s, bestStreakFrom: _b, statsUndo, ...rest } = item;
    return { ...rest, ...statsUndo } as T;
  };
  return { ...data, habits: data.habits.map(undo), recurringTasks: data.recurringTasks.map(undo), singleTasks: data.singleTasks.map(undo) };
}

export function describeReset(targets: Item[], scope: ResetScope, categories: Category[], todayISO: string, includeBestStreak: boolean): string {
  const streaky = targets.some((item) => item.kind !== "singleTask");
  const best = !streaky ? "" : includeBestStreak ? " The best streak starts over too." : " The best streak stays.";
  return `Stats start over from ${formatDate(todayISO, todayISO)} for ${describeTargets(targets, scope, categories)}; the history stays.${best}`;
}

/** §64: the "Counting since" date for a group: the earliest any of them counts from. */
export function countingSince(items: Item[]): string | undefined {
  const dates = items.map((item) =>
    item.kind === "singleTask" ? (item.statsFrom ?? item.originalStartDate ?? item.startDate) : statsCountFrom(item),
  );
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : undefined;
}

export function describeUndoReset(targets: Item[], scope: ResetScope, categories: Category[], todayISO: string): string {
  const from = scope.kind === "item" ? ` They count from ${formatDate(statsCountFrom(targets[0]), todayISO)} again.` : "";
  return `Undid the stats reset for ${describeTargets(targets, scope, categories)}.${from}`;
}
