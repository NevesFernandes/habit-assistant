// Phase 4's decisions: checklists, pause/resume/archive, delete and stats. As in
// writeTools.ts, the changes are dataStore's own functions and the rules are the chat
// engine's (§28 pause, §29 future dates, §42 per-day lists, §56 removing), so the app and
// the connector can't disagree. Pure: no Drive, no clock; `todayISO` is the user's.
import { weekStartOf, type AppData, type ChecklistItem, type Habit, type RecurringTask } from "../types/models.ts";
import {
  addCategory,
  addRecurringTaskChecklistItem,
  addSingleTaskChecklistItem,
  deleteHabits,
  deleteRecurringTasks,
  deleteSingleTasks,
  pauseItem,
  removeHabitChecklistItem,
  removeRecurringTaskChecklist,
  removeRecurringTaskChecklistItem,
  removeSingleTaskChecklist,
  removeSingleTaskChecklistItem,
  resolveCategoryId,
  resumeItem,
  setHabitChecklistItemChecked,
  setRecurringTaskChecklistItemChecked,
  setSingleTaskChecklistItemChecked,
  updateHabit,
  updateRecurringTask,
} from "../lib/dataStore.ts";
import { currentPause, isFutureDate, isPaused, upcomingPause } from "../lib/recurrence.ts";
import { habitChecklistOn, currentHabitChecklist } from "../lib/habitChecklist.ts";
import { recurringTaskChecklistOn, removableRecurringTaskChecklistItems } from "../lib/recurringChecklist.ts";
import { describeArchive, describeDeleteQuestion, describePause, describeResume, formatDate } from "../lib/confirmations.ts";
import { aggregateCategoryStats, computeHabitStats } from "../lib/habitStats.ts";
import { hasChecklist, resolveChecklistItemMatches } from "../lib/itemSelection.ts";
import { itemsOf, type AnyItem, type ItemKind, type Refusal } from "./writeTools.ts";

/** A change that's allowed: `apply` replays on a conflict (§21), `describe` reads the saved result. */
export interface Change {
  status: "ok";
  apply: (data: AppData) => AppData;
  describe: (saved: AppData) => { message: string; ownerId?: string; date?: string };
}

export type Plan = Refusal | { status: "needs_confirm"; question: string } | Change;

const quoted = (texts: string[]) => texts.map((text) => `"${text}"`);
/** "milk" / "milk" and "bread" / "milk", "eggs" and "bread", as the app writes it */
function quotedAnd(texts: string[]): string {
  const list = quoted(texts);
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// --- checklist --------------------------------------------------------------------------

export type ChecklistOp = "add" | "tick" | "untick" | "remove" | "remove_all";

/** Which items a checklist operation can act on: adding is for tasks (a habit's steps change through update_item); the rest need a list. */
export const canTakeChecklistOp = (op: ChecklistOp) => (item: AnyItem) => (op === "add" ? item.kind !== "habit" : hasChecklist(item));

export function checklistIneligible(op: ChecklistOp, items: AnyItem[]): Refusal {
  const item = items[0];
  if (op === "add" && item.kind === "habit") {
    return {
      status: "rejected",
      message: `"${item.name}" is a habit: its steps change with update_item's newChecklistItems (the whole new list), from today on.`,
    };
  }
  return { status: "rejected", message: `"${item.name}" doesn't have a checklist.` };
}

function texts(items: string[] | undefined): string[] {
  return (items ?? []).map((text) => text.trim()).filter((text) => text.length > 0);
}

/** Each fragment on its own: the ones found act, the rest are reported (the engine's §56 rule for removing, used for ticking too). */
function matchAll(listed: ChecklistItem[], fragments: string[], ownerName: string): { found: ChecklistItem[]; problems: string[] } {
  const found: ChecklistItem[] = [];
  const problems: string[] = [];
  for (const fragment of fragments) {
    const matches = resolveChecklistItemMatches(listed, fragment);
    if (matches.length === 0) problems.push(`I couldn't find "${fragment}" on "${ownerName}".`);
    else if (matches.length > 1) {
      problems.push(`More than one item on "${ownerName}" matches "${fragment}": ${quoted(matches.map((item) => item.text)).join(", ")}. Which one did you mean?`);
    } else if (!found.some((item) => item.id === matches[0].id)) found.push(matches[0]);
  }
  return { found, problems };
}

export function planChecklist(
  owner: AnyItem,
  op: ChecklistOp,
  input: { items?: string[]; date?: string; confirm?: boolean },
  todayISO: string,
): Plan {
  const fragments = texts(input.items);
  const dateISO = input.date ?? todayISO;

  if (op === "add") {
    if (fragments.length === 0) return { status: "need_info", message: "Ask the user what to add to the list." };
    const addOne = (data: AppData, text: string) =>
      owner.kind === "recurringTask" ? addRecurringTaskChecklistItem(data, owner.id, text, todayISO) : addSingleTaskChecklistItem(data, owner.id, text);
    return {
      status: "ok",
      apply: (data) => fragments.reduce(addOne, data),
      describe: () => ({ message: `Added ${quotedAnd(fragments)} to "${owner.name}".`, ownerId: owner.id, date: todayISO }),
    };
  }

  if (op === "remove_all") {
    if (owner.kind === "habit") {
      return {
        status: "rejected",
        message: `"${owner.name}" is a habit tracked with its checklist, so the checklist can't be removed on its own. You can take single steps off it, or change how it's tracked (for example "track ${owner.name} as yes/no").`,
      };
    }
    const items = owner.kind === "recurringTask" ? removableRecurringTaskChecklistItems(owner, todayISO) : (owner.checklist ?? []);
    if (items.length > 0 && !input.confirm) {
      const count = items.length === 1 ? "1 item" : `${items.length} items`;
      return {
        status: "needs_confirm",
        question: `Remove the checklist from "${owner.name}"? It has ${count} (${items.map((item) => item.text).join(", ")}), which will be deleted too. The task itself stays.`,
      };
    }
    return {
      status: "ok",
      apply: (data) => (owner.kind === "recurringTask" ? removeRecurringTaskChecklist(data, owner.id) : removeSingleTaskChecklist(data, owner.id)),
      describe: () => ({ message: `Removed the checklist from "${owner.name}". The task itself is unchanged.`, ownerId: owner.id, date: todayISO }),
    };
  }

  if (fragments.length === 0) return { status: "need_info", message: "Ask the user which item on the list they mean." };

  if (op === "remove") {
    // From today on, unless the user named an earlier day; a one-off task has one list.
    const from = owner.kind === "singleTask" ? todayISO : dateISO;
    if (isFutureDate(from, todayISO)) {
      return { status: "rejected", message: `I can only take items off "${owner.name}" from today or an earlier day, not from ${formatDate(from, todayISO)}.` };
    }
    const listed =
      owner.kind === "recurringTask"
        ? removableRecurringTaskChecklistItems(owner, from)
        : owner.kind === "habit"
          ? currentHabitChecklist(owner)
          : (owner.checklist ?? []);
    const { found, problems } = matchAll(listed, fragments, owner.name);
    if (found.length === 0) return { status: "rejected", message: problems.join(" ") };
    if (owner.kind === "habit" && found.length === listed.length) {
      return {
        status: "rejected",
        message: `"${owner.name}" is tracked with its checklist, so it needs at least one step. To stop tracking it that way, change how it's tracked instead (for example "track ${owner.name} as yes/no").`,
      };
    }
    const removeOne = (data: AppData, item: ChecklistItem) =>
      owner.kind === "habit"
        ? removeHabitChecklistItem(data, owner.id, item.id, from)
        : owner.kind === "recurringTask"
          ? removeRecurringTaskChecklistItem(data, owner.id, item.id, from)
          : removeSingleTaskChecklistItem(data, owner.id, item.id);
    const left = listed.filter((item) => !found.includes(item)).map((item) => item.text);
    return {
      status: "ok",
      apply: (data) => found.reduce(removeOne, data),
      describe: () => ({
        message: [
          `Removed ${quotedAnd(found.map((item) => item.text))} from "${owner.name}"${from < todayISO ? `, from ${formatDate(from, todayISO)} on` : ""}.`,
          left.length > 0 ? `Still on the list: ${left.join(", ")}.` : "The list is now empty.",
          ...problems,
        ].join(" "),
        ownerId: owner.id,
        date: from,
      }),
    };
  }

  // tick / untick: that day's list (§42: an item ticked off on an earlier trip is gone from it).
  const checked = op === "tick";
  // §29: a habit's ticks are that day's completion, so a future day is refused, as for set_done.
  if (owner.kind === "habit" && isFutureDate(dateISO, todayISO)) {
    return { status: "rejected", message: `I can't change "${owner.name}" for ${formatDate(dateISO, todayISO)}: that day hasn't happened yet.` };
  }
  const listed =
    owner.kind === "habit"
      ? habitChecklistOn(owner, dateISO)
      : owner.kind === "recurringTask"
        ? (recurringTaskChecklistOn(owner, dateISO) ?? [])
        : (owner.checklist ?? []);
  const { found, problems } = matchAll(listed, fragments, owner.name);
  if (found.length === 0) return { status: "rejected", message: problems.join(" ") };
  const setOne = (data: AppData, item: ChecklistItem) =>
    owner.kind === "habit"
      ? setHabitChecklistItemChecked(data, owner.id, item.id, checked, dateISO)
      : owner.kind === "recurringTask"
        ? setRecurringTaskChecklistItemChecked(data, owner.id, item.id, checked, dateISO)
        : setSingleTaskChecklistItemChecked(data, owner.id, item.id, checked);
  return {
    status: "ok",
    apply: (data) => found.reduce(setOne, data),
    describe: () => ({
      message: [`${checked ? "Checked off" : "Unchecked"} ${quotedAnd(found.map((item) => item.text))} on "${owner.name}".`, ...problems].join(" "),
      ownerId: owner.id,
      date: owner.kind === "singleTask" ? owner.startDate : dateISO,
    }),
  };
}

// --- schedule ---------------------------------------------------------------------------

export type ScheduleOp = "pause" | "resume" | "archive";

/** §28: a pause runs from today or later (a backdated one would turn missed days into days never due), and ends after it starts. */
export function planSchedule(item: Habit | RecurringTask, op: ScheduleOp, input: { from?: string; resumeOn?: string }, todayISO: string): Plan {
  if (op === "pause") {
    const from = input.from ?? todayISO;
    if (isFutureDate(todayISO, from)) {
      return { status: "rejected", message: `I can only pause from today onwards: ${formatDate(from, todayISO)} has already happened.` };
    }
    if (input.resumeOn && input.resumeOn <= from) {
      return {
        status: "rejected",
        message: `That pause would end before it starts: ${formatDate(input.resumeOn, todayISO)} isn't after ${formatDate(from, todayISO)}.`,
      };
    }
    const pause = { from, ...(input.resumeOn ? { resumeOn: input.resumeOn } : {}) };
    return {
      status: "ok",
      apply: (data) => pauseItem(data, item.kind, item.id, pause, todayISO),
      describe: () => ({ message: describePause(item.name, pause, todayISO), ownerId: item.id }),
    };
  }
  if (op === "resume") {
    if (!isPaused(item, todayISO) && !upcomingPause(item, todayISO)) {
      return { status: "rejected", message: `"${item.name}" isn't paused: it's already running.` };
    }
    const wasUpcoming = !currentPause(item, todayISO);
    return {
      status: "ok",
      apply: (data) => resumeItem(data, item.kind, item.id, todayISO),
      describe: () => ({
        message: wasUpcoming ? `Cancelled the upcoming pause on "${item.name}": it stays due as normal.` : describeResume(item.name),
        ownerId: item.id,
      }),
    };
  }
  // Archive is an end date of today, as in the app: history kept, no more occurrences.
  return {
    status: "ok",
    apply: (data) =>
      item.kind === "habit"
        ? updateHabit(data, item.id, { newEndDate: todayISO }, todayISO)
        : updateRecurringTask(data, item.id, { newEndDate: todayISO }, todayISO),
    describe: (saved) => {
      const after = itemsOf(saved).find((entry) => entry.id === item.id) ?? item;
      return { message: describeArchive(after), ownerId: item.id };
    },
  };
}

// --- delete -----------------------------------------------------------------------------

const NOUNS: Record<ItemKind, string> = { habit: "habit", recurringTask: "recurring task", singleTask: "task" };

/**
 * Asks first, with details, unless `confirm` (the user said yes to that question). As in the
 * app, one one-off task picked by its name goes without asking: it has no history to lose.
 */
export function planDelete(data: AppData, items: AnyItem[], byName: boolean, confirm: boolean, todayISO: string): Plan {
  const kinds = new Set(items.map((item) => item.kind));
  const noun = kinds.size === 1 ? NOUNS[items[0].kind] : "item";
  const tracked = items.some((item) => item.kind !== "singleTask");
  const quick = byName && items.length === 1 && items[0].kind === "singleTask";
  if (!confirm && !quick) {
    return { status: "needs_confirm", question: describeDeleteQuestion(noun, tracked, items, data.categories, todayISO) };
  }
  const ids = items.map((item) => item.id);
  return {
    status: "ok",
    apply: (d) => deleteSingleTasks(deleteRecurringTasks(deleteHabits(d, ids), ids), ids),
    describe: () => ({ message: `Deleted ${quoted(items.map((item) => item.name)).join(", ")}.` }),
  };
}

// --- stats ------------------------------------------------------------------------------

/** One habit's numbers, as its page in the app shows them. "N times a week/month" habits count streaks in periods, not days. */
export function habitStats(data: AppData, habit: Habit, todayISO: string) {
  const stats = computeHabitStats(habit, data.completionLog, todayISO, weekStartOf(data));
  const streakUnit = habit.recurrence.type === "timesPerPeriod" ? habit.recurrence.period : "day";
  return { id: habit.id, name: habit.name, streakUnit, ...stats };
}

/** The stats tab: overall, per category (habits only; tasks have no stats), and the same per category when asked for one. */
export function categoryStats(data: AppData, categoryId: string | undefined, todayISO: string) {
  const habits = categoryId === undefined ? data.habits : data.habits.filter((habit) => habit.categoryId === categoryId);
  return aggregateCategoryStats(habits, data.completionLog, todayISO, weekStartOf(data));
}

export function overallStats(data: AppData, todayISO: string) {
  return {
    overall: categoryStats(data, undefined, todayISO),
    categories: data.categories
      .map((category) => ({ category: category.name, ...categoryStats(data, category.id, todayISO) }))
      .filter((row) => row.habitCount > 0)
      .sort((a, b) => b.habitCount - a.habitCount),
  };
}

// --- more_actions ----------------------------------------------------------------------
// §61: claude.ai keeps the tool list it fetched when the user connected, and there's no way
// for users to refresh it short of reconnecting. So the tool list is fixed at launch, and
// anything added later becomes an action here: Claude lists the actions (with their rules)
// at run time and runs one. Never put a destructive action here; it would share this tool's
// "always allow" with everything else (deletes stay in delete_items).

export interface MoreAction {
  description: string;
  args: Record<string, string>;
  run: (data: AppData, args: Record<string, unknown>, todayISO: string) => { result: Record<string, unknown> } | Refusal | Change;
}

export const MORE_ACTIONS: Record<string, MoreAction> = {
  list_categories: {
    description: "The user's categories, with how many habits and tasks use each.",
    args: {},
    run: (data) => ({
      result: {
        categories: data.categories.map((category) => ({
          name: category.name,
          custom: !category.isDefault,
          items: itemsOf(data).filter((item) => item.categoryId === category.id).length,
        })),
      },
    }),
  },
  add_category: {
    description:
      "Adds a category for habits and tasks. The app gives it a plain icon; the user can pick another in the app's Categories tab. Refused when one with that name exists.",
    args: { name: "string, required" },
    run: (data, args) => {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) return { status: "need_info", message: "Ask the user what to call the category." };
      if (resolveCategoryId(data, name)) return { status: "rejected", message: `There's already a category called "${name}".` };
      return {
        status: "ok",
        // "square" is DEFAULT_ICON_NAME in src/lib/icons.ts, which can't be imported here (it pulls in the icon library).
        apply: (d) => addCategory(d, { name, icon: "square" }),
        describe: () => ({ message: `Added the category "${name}".` }),
      };
    },
  },
};

export function describeActions() {
  return Object.entries(MORE_ACTIONS).map(([action, { description, args }]) => ({ action, description, args }));
}
