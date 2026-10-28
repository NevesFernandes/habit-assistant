// §71: goals and challenges, for the app's chat and screens and the Claude connector alike.
// A goal hangs on one habit or recurring task and is measured on its log, so there's no
// second way to log and a goal can't disagree with the item's own stats:
// - a total: N done days, or N of a number/timer habit's amount, by an end date ("read 20
//   books by December", "run 100 km by the end of the year");
// - a challenge: done every due day for N days ("a 30-day no-sugar challenge"). A missed day
//   doesn't end it: it keeps counting and is achieved only with no misses. Paused and
//   skipped days aren't due, so they never count against it (occursOn).
// Counting starts the day the goal is made unless the user names another day. Progress,
// pace and achieved/missed are worked out here each time, never stored. One active goal per
// item; finished ones stay. Pure: no Drive, no clock.
import type { AppData, Goal, Habit, RecurringTask } from "../types/models.ts";
import { addDays, daysBetween, isArchived, occursOn } from "./recurrence.ts";
import { getHistory } from "./history.ts";
import { isHabitEntryComplete } from "./habitStats.ts";
import { formatDate } from "./confirmations.ts";
import { addPackItem, invalidReason, type PackItem } from "./pack.ts";
import { findSameName } from "./itemSelection.ts";
import { compareForDay } from "./dayParts.ts";

export type GoalItem = Habit | RecurringTask;
export type GoalStatus = "upcoming" | "active" | "achieved" | "missed";

/** Longest challenge, and furthest end date, so a goal stays a goal rather than a forever. */
export const GOAL_MAX_DAYS = 366;

export interface GoalProgress {
  goal: Goal;
  itemName: string;
  itemKind: GoalItem["kind"];
  status: GoalStatus;
  /** Done days, or the amount logged, in the goal's window up to today. */
  done: number;
  target: number;
  /** "days", a value habit's unit, "min" for a timer habit, or the goal's own unit ("books"). */
  unit: string;
  /** Challenges: due days in the window so far, missed ones, and due days still to come. */
  due?: number;
  missed?: number;
  remainingDue?: number;
  /** Calendar days left, today included; 0 once finished. */
  daysLeft: number;
  /** Active totals: what's still needed, about how much a week, whether it's on pace, and whether the schedule still allows it. */
  pace?: { needed: number; perWeek: number; onTrack: boolean; reachable: boolean };
}

const itemsOf = (data: AppData): GoalItem[] => [...data.habits, ...data.recurringTasks];

function itemOf(data: AppData, goal: Goal): GoalItem | undefined {
  return itemsOf(data).find((item) => item.id === goal.itemId);
}

function isAmountItem(item: GoalItem): item is Habit {
  return item.kind === "habit" && (item.completionType === "value" || item.completionType === "timer");
}

function unitOf(goal: Goal, item: GoalItem): string {
  if (goal.measure === "amount" && item.kind === "habit") return item.completionType === "timer" ? "min" : (item.unit ?? "");
  return goal.unit?.trim() || (goal.kind === "challenge" ? "days" : "times");
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Done on `date`: a habit's entry complete, a recurring task's entry there at all. */
function doneOn(data: AppData, item: GoalItem, date: string): boolean {
  const entry = data.completionLog.find((e) => e.itemId === item.id && e.date === date);
  return item.kind === "habit" ? isHabitEntryComplete(item, entry) : entry !== undefined;
}

/** Due days from `from` to `to` an item could still be done on. */
function dueDaysBetween(item: GoalItem, from: string, to: string): number {
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) if (occursOn(item, date)) count += 1;
  return count;
}

/** Where a goal stands today. Pass `data` as the app shows it. */
export function goalProgress(data: AppData, goal: Goal, today: string): GoalProgress | undefined {
  const item = itemOf(data, goal);
  if (!item) return undefined;
  const base = { goal, itemName: item.name, itemKind: item.kind, target: goal.target, unit: unitOf(goal, item) };
  const upTo = goal.to < today ? goal.to : today;
  const started = goal.from <= today;
  const daysLeft = goal.to < today ? 0 : daysBetween(today < goal.from ? goal.from : today, goal.to) + 1;

  if (goal.kind === "challenge") {
    const history = started ? getHistory(data, goal.from, upTo, today, [item], { keepEmpty: true }).items[0] : undefined;
    const done = history?.done ?? 0;
    const missed = history?.missed ?? 0;
    const open = history ? history.due - history.done - history.missed : 0;
    // Due days after today, plus today's if it's still open.
    const ahead = goal.to > today ? dueDaysBetween(item, started ? addDays(today, 1) : goal.from, goal.to) : 0;
    const status: GoalStatus = !started ? "upcoming" : goal.to < today ? (missed === 0 ? "achieved" : "missed") : "active";
    return { ...base, status, done, due: done + missed + open, missed, remainingDue: ahead + open, daysLeft };
  }

  let done = 0;
  if (started) {
    if (goal.measure === "amount") {
      done = round(data.completionLog.filter((e) => e.itemId === item.id && e.date >= goal.from && e.date <= upTo).reduce((sum, e) => sum + (e.value ?? 0), 0));
    } else {
      for (let date = goal.from; date <= upTo; date = addDays(date, 1)) if (doneOn(data, item, date)) done += 1;
    }
  }
  const status: GoalStatus = done >= goal.target ? "achieved" : goal.to < today ? "missed" : started ? "active" : "upcoming";
  if (status !== "active" && status !== "upcoming") return { ...base, status, done, daysLeft: status === "achieved" ? daysLeft : 0 };

  const needed = round(goal.target - done);
  const perWeek = round((needed / Math.max(daysLeft, 1)) * 7);
  const total = daysBetween(goal.from, goal.to) + 1;
  const elapsed = started ? daysBetween(goal.from, today) : 0; // whole days before today
  const onTrack = done >= Math.floor((goal.target * elapsed) / total);
  // "days" goals need a due day per done day; an amount can always be caught up.
  const firstLeft = !started ? goal.from : doneOn(data, item, today) ? addDays(today, 1) : today;
  const reachable = goal.measure === "amount" || dueDaysBetween(item, firstLeft, goal.to) >= needed;
  return { ...base, status, done, daysLeft, pace: { needed, perWeek, onTrack, reachable } };
}

/** The item's goal that isn't finished, if any (one per item). */
export function activeGoalOf(data: AppData, itemId: string, today: string): Goal | undefined {
  return (data.goals ?? []).find((goal) => {
    if (goal.itemId !== itemId) return false;
    const status = goalProgress(data, goal, today)?.status;
    return status === "active" || status === "upcoming";
  });
}

/** Every goal, active ones first in the app's item order, then finished ones, latest first. */
export function goalsOverview(data: AppData, today: string): { active: GoalProgress[]; finished: GoalProgress[] } {
  const all = (data.goals ?? []).flatMap((goal) => goalProgress(data, goal, today) ?? []);
  const items = new Map(itemsOf(data).map((item) => [item.id, item]));
  const byItem = (a: GoalProgress, b: GoalProgress) => compareForDay(items.get(a.goal.itemId)!, items.get(b.goal.itemId)!);
  return {
    active: all.filter((p) => p.status === "active" || p.status === "upcoming").sort(byItem),
    finished: all.filter((p) => p.status === "achieved" || p.status === "missed").sort((a, b) => b.goal.to.localeCompare(a.goal.to)),
  };
}

// --- wording -------------------------------------------------------------------------------

function amount(n: number, unit: string): string {
  return unit ? `${n} ${unit}` : String(n);
}

/** "20 books by Thu 31 Dec", "a 30-day challenge (to Fri 27 Nov)" */
export function describeGoalTarget(goal: Goal, unit: string, today: string): string {
  if (goal.kind === "challenge") return `a ${goal.target}-day challenge, ${formatDate(goal.from, today)} to ${formatDate(goal.to, today)}`;
  const since = goal.from === goal.createdOn ? "" : `, counting from ${formatDate(goal.from, today)}`;
  return `${amount(goal.target, unit)} by ${formatDate(goal.to, today)}${since}`;
}

/** One line on where a goal stands, for the item page, the Goals tab and the replies. */
export function describeProgress(p: GoalProgress, today: string): string {
  const { goal } = p;
  if (p.status === "upcoming") return `Starts ${formatDate(goal.from, today)}.`;
  if (goal.kind === "challenge") {
    const missed = p.missed ? `, ${p.missed} missed` : "";
    if (p.status === "achieved") return `Achieved: every due day done (${p.done} of ${p.due}).`;
    if (p.status === "missed") return `Finished with ${p.done} of ${p.due} due days done${missed}.`;
    const left = p.daysLeft === 1 ? "last day today" : `${p.daysLeft} days left`;
    return `${p.done} of ${p.due} due days done so far${missed}; ${left}.`;
  }
  if (p.status === "achieved") return `Achieved: ${amount(p.done, p.unit)}, goal ${amount(p.target, p.unit)}.`;
  if (p.status === "missed") return `Ended at ${p.done} of ${amount(p.target, p.unit)}.`;
  const left = p.daysLeft === 1 ? "last day today" : `${p.daysLeft} days left`;
  const pace = p.pace!;
  const how = !pace.reachable
    ? "not reachable on its current schedule"
    : pace.onTrack
      ? "on track"
      : `behind: about ${pace.perWeek} a week from now`;
  return `${p.done} of ${amount(p.target, p.unit)}; ${left}, ${how}.`;
}

function goalLine(p: GoalProgress, today: string): string {
  return `"${p.itemName}": ${describeGoalTarget(p.goal, p.unit, today)}. ${describeProgress(p, today)}`;
}

/** The reply to "how are my goals?" (or one item's). */
export function describeGoals(data: AppData, today: string, itemId?: string): string {
  const { active, finished } = goalsOverview(data, today);
  const pick = (list: GoalProgress[]) => (itemId ? list.filter((p) => p.goal.itemId === itemId) : list);
  const now = pick(active);
  const done = pick(finished).slice(0, itemId ? 3 : 5);
  if (!now.length && !done.length) {
    return itemId ? "That item has no goal yet." : 'You have no goals yet. Set one by saying, for example, "read 20 books by December" or "start a 30-day no-sugar challenge".';
  }
  const lines: string[] = [];
  if (now.length) lines.push(...now.map((p) => goalLine(p, today)));
  else lines.push("No goal running right now.");
  if (done.length) lines.push(`Finished: ${done.map((p) => `"${p.itemName}" ${p.status === "achieved" ? "achieved" : "not reached"} (${describeGoalTarget(p.goal, p.unit, today)})`).join("; ")}.`);
  return lines.join("\n");
}

// --- changes ---------------------------------------------------------------------------------

export interface GoalInput {
  kind: "total" | "challenge";
  /** total: how many or how much; challenge: how many days. */
  target?: number;
  measure?: "days" | "amount";
  unit?: string;
  /** total: the last day. */
  by?: string;
  /** First day counted; default today. */
  from?: string;
}

export type GoalPlan =
  | { status: "rejected"; message: string }
  | { status: "needs_confirm"; question: string }
  | { status: "ok"; apply: (data: AppData) => AppData; message: (saved: AppData) => string };

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The goal as it would be stored for `item`, or why not. Shared by a new goal and a change. */
function shapeGoal(item: GoalItem, input: GoalInput, today: string): { goal: Omit<Goal, "id" | "itemId" | "createdOn"> } | { message: string } {
  const from = input.from ?? today;
  if (!isDate(from)) return { message: "I couldn't work out which day the goal should count from." };
  if (input.kind === "challenge") {
    const days = Math.round(input.target ?? 0);
    if (days < 1) return { message: "How many days should the challenge last?" };
    if (days > GOAL_MAX_DAYS) return { message: `A challenge can last at most ${GOAL_MAX_DAYS} days.` };
    if (item.recurrence.type === "timesPerPeriod") {
      return { message: `"${item.name}" is done a number of times a week or month, with no set days, so a challenge can't tell which day was missed. A total works instead, e.g. "${item.name} 24 times by" a date.` };
    }
    const to = addDays(from, days - 1);
    if (to < today) return { message: "That challenge would already be over. Goals look forward: start it today or later." };
    return { goal: { kind: "challenge", target: days, measure: "days", from, to } };
  }
  const target = input.target ?? 0;
  if (!(target > 0)) return { message: "What's the target: how many, or how much?" };
  if (!isDate(input.by)) return { message: "By when? A goal needs an end date." };
  if (input.by < today) return { message: "That date has already passed. Goals look forward: pick today or a later day." };
  if (input.by < from) return { message: "The end date is before the day it starts counting." };
  if (daysBetween(today, input.by) > GOAL_MAX_DAYS) return { message: `Set the end date at most a year ahead (${GOAL_MAX_DAYS} days).` };
  const measure = input.measure ?? (isAmountItem(item) ? "amount" : "days");
  if (measure === "amount" && !isAmountItem(item)) {
    return { message: `"${item.name}" has no amount to add up, so its goal counts the days it's done ("${item.name}" ${target} times).` };
  }
  const unit = measure === "days" ? input.unit?.trim() || undefined : undefined;
  return { goal: { kind: "total", target, measure, ...(unit ? { unit } : {}), from, to: input.by } };
}

function refuseFor(item: GoalItem, today: string): string | undefined {
  if (isArchived(item, today)) return `"${item.name}" is archived. Bring it back first, then set the goal.`;
  return undefined;
}

function goalSetMessage(saved: AppData, itemId: string, today: string, extra = ""): string {
  const goal = activeGoalOf(saved, itemId, today) ?? [...(saved.goals ?? [])].reverse().find((g) => g.itemId === itemId);
  const p = goal && goalProgress(saved, goal, today);
  if (!p) return "The goal was set.";
  const counting = goal!.kind === "total" && goal!.measure === "days" ? ` Each day "${p.itemName}" is done counts as one${goal!.unit ? ` (${goal!.unit})` : ""}.` : "";
  return `Goal set for "${p.itemName}": ${describeGoalTarget(p.goal, p.unit, today)}.${counting} ${describeProgress(p, today)}${extra}`;
}

/**
 * A new goal on an existing item. With one already running, asks first unless `replace`;
 * replacing removes the old one.
 */
export function planSetGoal(data: AppData, item: GoalItem, input: GoalInput, today: string, replace = false): GoalPlan {
  const refusal = refuseFor(item, today);
  if (refusal) return { status: "rejected", message: refusal };
  const shaped = shapeGoal(item, input, today);
  if ("message" in shaped) return { status: "rejected", message: shaped.message };
  const current = activeGoalOf(data, item.id, today);
  if (current && !replace) {
    const p = goalProgress(data, current, today)!;
    const proposed: Goal = { ...shaped.goal, id: "", itemId: item.id, createdOn: today };
    return {
      status: "needs_confirm",
      question: `"${item.name}" already has a goal: ${describeGoalTarget(current, p.unit, today)} (${describeProgress(p, today)}) An item has one goal at a time. Replace it with ${describeGoalTarget(proposed, unitOf(proposed, item), today)}?`,
    };
  }
  const goal: Omit<Goal, "id"> = { ...shaped.goal, itemId: item.id, createdOn: today };
  return {
    status: "ok",
    apply: (fresh) => {
      const kept = (fresh.goals ?? []).filter((g) => !(current && g.id === current.id));
      return { ...fresh, goals: [...kept, { ...goal, id: crypto.randomUUID() }] };
    },
    message: (saved) => goalSetMessage(saved, item.id, today, current ? " (The old goal was removed.)" : ""),
  };
}

/**
 * A goal on an item that doesn't exist yet, made in the same step. A challenge's item ends
 * with the challenge. When the user already has an item by that name, the goal goes on it.
 */
export function planGoalWithNewItem(data: AppData, newItem: PackItem, input: GoalInput, today: string, replace = false): GoalPlan {
  if (newItem.kind === "singleTask") return { status: "rejected", message: "A goal goes on a habit or a recurring task, not a one-off task." };
  const name = newItem.name?.trim() ?? "";
  const same = findSameName([...data.habits, ...data.recurringTasks, ...data.singleTasks], name, today);
  if (same.length === 1 && same[0].kind !== "singleTask") return planSetGoal(data, same[0], input, today, replace);
  if (same.length) return { status: "rejected", message: `You already have "${same[0].name}". Say which item the goal is for.` };
  const problem = invalidReason({ ...newItem, name });
  if (problem) return { status: "rejected", message: `I couldn't make "${name || "the item"}" for the goal: ${problem}.` };
  // Only what shapeGoal reads: the name, kind, tracking and repeat rule.
  const draft = { kind: newItem.kind, name, recurrence: newItem.recurrence!, completionType: newItem.completionType ?? "yesno", unit: newItem.unit } as GoalItem;
  const shaped = shapeGoal(draft, input, today);
  if ("message" in shaped) return { status: "rejected", message: shaped.message };
  const challenge = shaped.goal.kind === "challenge";
  return {
    status: "ok",
    apply: (fresh) => {
      const before = new Set(itemsOf(fresh).map((item) => item.id));
      const start = shaped.goal.from > today ? shaped.goal.from : undefined;
      const added = addPackItem(fresh, { ...newItem, name }, today, start, challenge ? shaped.goal.to : undefined);
      const made = itemsOf(added).find((item) => !before.has(item.id));
      if (!made) return fresh;
      // Counting can't start before the item does.
      const from = shaped.goal.from < made.startDate ? made.startDate : shaped.goal.from;
      const goal: Goal = { ...shaped.goal, from, id: crypto.randomUUID(), itemId: made.id, createdOn: today, ...(challenge ? { endsItem: true } : {}) };
      return { ...added, goals: [...(added.goals ?? []), goal] };
    },
    message: (saved) => {
      const made = itemsOf(saved).find((item) => item.name === name && (saved.goals ?? []).some((g) => g.itemId === item.id));
      if (!made) return "The goal was set.";
      const kind = made.kind === "habit" ? "habit" : "recurring task";
      const ends = challenge ? ` It ends with the challenge on ${formatDate(made.endDate!, today)}.` : "";
      return `Added the ${kind} "${made.name}".${ends} ${goalSetMessage(saved, made.id, today)}`;
    },
  };
}

export interface GoalChange {
  target?: number;
  by?: string;
  /** Challenges: the new length in days. */
  days?: number;
  unit?: string;
}

/** Changes the item's running goal: its target, end date or a challenge's length. */
export function planChangeGoal(data: AppData, item: GoalItem, change: GoalChange, today: string): GoalPlan {
  const goal = activeGoalOf(data, item.id, today);
  if (!goal) return { status: "rejected", message: `"${item.name}" has no goal running. Set one instead.` };
  const input: GoalInput =
    goal.kind === "challenge"
      ? { kind: "challenge", target: change.days ?? change.target ?? goal.target, from: goal.from }
      : { kind: "total", target: change.target ?? goal.target, by: change.by ?? goal.to, measure: goal.measure, unit: change.unit ?? goal.unit, from: goal.from };
  // Counting from a past day is fine for a goal already running: it was set from then.
  const shaped = shapeGoal(item, input, goal.from < today ? goal.from : today);
  if ("message" in shaped) return { status: "rejected", message: shaped.message };
  if (shaped.goal.to < today) return { status: "rejected", message: "That would end the goal before today. Goals look forward: pick today or a later day." };
  const next: Goal = { ...goal, ...shaped.goal };
  return {
    status: "ok",
    apply: (fresh) => {
      const goals = (fresh.goals ?? []).map((g) => (g.id === goal.id ? next : g));
      // A challenge's own item ends with it, wherever its end moves.
      const moveEnd = <T extends GoalItem>(i: T): T => (goal.endsItem && i.id === item.id && i.endDate === goal.to ? { ...i, endDate: next.to } : i);
      return { ...fresh, goals, habits: fresh.habits.map(moveEnd), recurringTasks: fresh.recurringTasks.map(moveEnd) };
    },
    message: (saved) => {
      const p = goalProgress(saved, next, today);
      const ends = goal.endsItem && goal.to !== next.to ? ` "${item.name}" now ends on ${formatDate(next.to, today)} too.` : "";
      return p ? `Changed the goal for "${item.name}": ${describeGoalTarget(next, p.unit, today)}. ${describeProgress(p, today)}${ends}` : "The goal was changed.";
    },
  };
}

/** Removes the item's running goal. The item stays as it is (an item made for a challenge keeps its end date). */
export function planRemoveGoal(data: AppData, item: GoalItem, today: string): GoalPlan {
  const goal = activeGoalOf(data, item.id, today);
  if (!goal) return { status: "rejected", message: `"${item.name}" has no goal running.` };
  const ends = goal.endsItem && item.endDate === goal.to ? ` "${item.name}" still ends on ${formatDate(goal.to, today)}; say "remove its end date" to keep it going.` : "";
  return {
    status: "ok",
    apply: (fresh) => ({ ...fresh, goals: (fresh.goals ?? []).filter((g) => g.id !== goal.id) }),
    message: () => `Removed the goal on "${item.name}". Its history and stats are untouched.${ends}`,
  };
}

/** A goal's progress as JSON for the connector: the app's own numbers and wording. */
export function goalView(p: GoalProgress, today: string) {
  return {
    item: p.itemName,
    kind: p.goal.kind,
    target: p.target,
    unit: p.unit,
    from: p.goal.from,
    to: p.goal.to,
    status: p.status,
    done: p.done,
    ...(p.due !== undefined ? { due: p.due, missed: p.missed, remainingDue: p.remainingDue } : {}),
    daysLeft: p.daysLeft,
    ...(p.pace ? { pace: p.pace } : {}),
    summary: describeProgress(p, today),
  };
}
