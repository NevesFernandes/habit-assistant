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
  unarchiveItem,
  setHabitChecklistItemChecked,
  setRecurringTaskChecklistItemChecked,
  setSingleTaskChecklistItemChecked,
  updateHabit,
  updateRecurringTask,
} from "../lib/dataStore.ts";
import { addDays, archiveGap, currentPause, daysBetween, isArchived, isFutureDate, isPaused, upcomingPause } from "../lib/recurrence.ts";
import { habitChecklistOn, currentHabitChecklist } from "../lib/habitChecklist.ts";
import { recurringTaskChecklistOn, removableRecurringTaskChecklistItems } from "../lib/recurringChecklist.ts";
import { describeArchive, describeDeleteQuestion, describePause, describeResume, describeUnarchive, formatDate } from "../lib/confirmations.ts";
import { aggregateCategoryStats, computeHabitStats } from "../lib/habitStats.ts";
import { computeRecurringTaskStats, statsByKind } from "../lib/taskStats.ts";
import { rolloverPersistentTasks } from "../lib/dataStore.ts";
import { hasChecklist, resolveChecklistItemMatches } from "../lib/itemSelection.ts";
import { itemsOf, resolveTargets, type AnyItem, type ItemKind, type Refusal } from "./writeTools.ts";
import { NOTE_MAX_LENGTH, noteOn, setDayNote } from "../lib/dayNotes.ts";
import { isISODate } from "../lib/today.ts";
import { describeSkip, describeUnskip, skipDay, skipOn, skipRefusal, unskipDay } from "../lib/skip.ts";
import { planBulk, planBulkEdit, type BulkAction, type BulkFilter } from "../lib/bulk.ts";
import { planUndo } from "../lib/undo.ts";
import { applyPack, describePackAdded, describePackPreview, planPack, type PackItem } from "../lib/pack.ts";
import { parseCompactRecurrence } from "../server/recurrenceSpec.ts";
import { buildExportCsv, EXPORT_COLUMNS, exportRefusal } from "../lib/exportCsv.ts";
import { isDayPart } from "../lib/dayParts.ts";
import { defaultMissedPeriod, describeMissedPeriod, describeNudge, getMissed } from "../lib/missed.ts";
import { HISTORY_MAX_DAYS, historyRangeDays } from "../lib/history.ts";
import { NOT_BY_CHAT, describeReadAloudEverywhere, describeWeekStart, readAloudEverywhere, withReadAloudEverywhere, withWeekStart } from "../lib/settingsByChat.ts";
import { describeUndoReset, resetTargets, undoable, undoReset, type ResetScope } from "../lib/statsReset.ts";

/** A change that's allowed: `apply` replays on a conflict (§21), `describe` reads the saved result. */
export interface Change {
  status: "ok";
  /** §70: false for the undo itself, which mustn't become the next thing to undo. */
  recordUndo?: false;
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

/** Which items a checklist operation can act on: adding is for tasks (a habit's steps change through update_items); the rest need a list. */
export const canTakeChecklistOp = (op: ChecklistOp) => (item: AnyItem) => (op === "add" ? item.kind !== "habit" : hasChecklist(item));

export function checklistIneligible(op: ChecklistOp, items: AnyItem[]): Refusal {
  const item = items[0];
  if (op === "add" && item.kind === "habit") {
    return {
      status: "rejected",
      message: `"${item.name}" is a habit: its steps change with update_items' newChecklistItems (the whole new list), from today on.`,
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
    // §77: resuming an archived item brings it back, as in the app's chat.
    if (isArchived(item, todayISO)) return planUnarchive(item, todayISO);
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

/** §77: no end date, the archived days kept as a pause, and any pause it had ended today. */
export function planUnarchive(item: Habit | RecurringTask, todayISO: string): Refusal | Change {
  if (!isArchived(item, todayISO)) {
    return {
      status: "rejected",
      message: item.endDate
        ? `"${item.name}" isn't archived: it runs until ${formatDate(item.endDate, todayISO)}. To keep it going, remove the end date (update_items, newEndDate "").`
        : `"${item.name}" isn't archived.`,
    };
  }
  const gap = archiveGap(item, undefined, todayISO);
  return {
    status: "ok",
    apply: (data) => resumeItem(unarchiveItem(data, item.kind, item.id, todayISO), item.kind, item.id, todayISO),
    describe: () => ({ message: describeUnarchive(item.name, gap, todayISO), ownerId: item.id }),
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

/** §63: a recurring task's stats are a yes/no habit's; a one-off task has its own few facts. */
export function itemStats(data: AppData, item: AnyItem, todayISO: string) {
  if (item.kind === "habit") return { kind: item.kind, ...habitStats(data, item, todayISO) };
  if (item.kind === "recurringTask") {
    const streakUnit = item.recurrence.type === "timesPerPeriod" ? item.recurrence.period : "day";
    return { kind: item.kind, id: item.id, name: item.name, streakUnit, ...computeRecurringTaskStats(item, data.completionLog, todayISO, weekStartOf(data)) };
  }
  const first = item.originalStartDate ?? item.startDate;
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    done: item.done,
    ...(item.doneOn ? { doneOn: item.doneOn } : {}),
    due: item.startDate,
    ...(!item.done && first < todayISO ? { daysCarriedOver: daysBetween(first, todayISO) } : {}),
  };
}

/** §63: the task sections of the stats tab, for everything or one category. */
export function taskStats(data: AppData, todayISO: string, categoryId?: string) {
  const { recurringTasks, singleTasks } = statsByKind(rolloverPersistentTasks(data, todayISO), todayISO, weekStartOf(data), categoryId);
  const { habitCount: taskCount, ...recurring } = recurringTasks;
  return { recurringTasks: { taskCount, ...recurring }, singleTasks };
}

/** The stats tab: overall, per category (habits; tasks come apart, see taskStats), and the same per category when asked for one. */
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

/** §68: one excused day, today or later, through schedule's frozen `skip` op. */
export function planSkip(data: AppData, item: Habit | RecurringTask, dateISO: string, todayISO: string): Plan {
  const refusal = skipRefusal(data, item, dateISO, todayISO);
  if (refusal) return { status: "rejected", message: refusal };
  return {
    status: "ok",
    apply: (d) => skipDay(d, item, dateISO),
    describe: () => ({ message: describeSkip(item, dateISO, todayISO), ownerId: item.id, date: dateISO }),
  };
}

// --- handlers ----------------------------------------------------------------------------
// The work behind parts of several tools (categories, notes, unskip, unarchive, settings, what
// did I miss, export, packs, bulk, undo, undoing a stats reset). Until §80 Claude reached them
// through one `more_actions` tool; now the tool each belongs to calls it (server.ts's
// runHandler): a result to return as is, a refusal, or a change to save.

export interface Handler {
  run: (data: AppData, args: Record<string, unknown>, todayISO: string) => { result: Record<string, unknown> } | Refusal | Change;
}

/** §72: the most rows the connector's export returns at once; the app's has no cap. */
export const EXPORT_MAX_ROWS = 3000;

export const HANDLERS: Record<string, Handler> = {
  list_categories: {
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
  // §64: reset_stats' `undo`. It only restores counting dates; history is never touched.
  undo_reset_stats: {
    run: (data, args, todayISO) => {
      const id = typeof args.id === "string" ? args.id : undefined;
      const name = typeof args.name === "string" ? args.name : undefined;
      const type = args.type === "habit" || args.type === "recurringTask" || args.type === "singleTask" ? args.type : undefined;
      let scope: ResetScope;
      if (id || name) {
        const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name });
        if (resolved.status === "not_found") return { status: "rejected", message: resolved.message };
        if (resolved.status === "ambiguous") {
          const list = resolved.candidates.map((c) => `${c.name} (${c.type}, id ${c.id})`).join("; ");
          return { status: "need_info", message: `Several items match: ${list}. Ask which one, then call again with its id.` };
        }
        if (resolved.status !== "ok") return { status: "rejected", message: "That item has no stats." };
        scope = { kind: "item", item: resolved.items[0] };
      } else if (typeof args.category === "string") {
        const categoryId = resolveCategoryId(data, args.category);
        if (!categoryId) return { status: "rejected", message: `There's no category called "${args.category}".` };
        scope = { kind: "category", categoryId };
      } else {
        scope = { kind: "all" };
      }
      const undoing = undoable(resetTargets(data, scope, type));
      if (undoing.length === 0) return { status: "rejected", message: "There's no stats reset to undo there." };
      const ids = new Set(undoing.map((item) => item.id));
      return {
        status: "ok",
        apply: (d) => undoReset(d, ids),
        describe: (saved) => ({
          message: describeUndoReset(itemsOf(saved).filter((item) => ids.has(item.id)), scope, saved.categories, todayISO),
        }),
      };
    },
  },
  // §77: schedule's `unarchive` (its `resume` does the same for an archived item).
  unarchive: {
    run: (data, args, todayISO) => {
      const id = typeof args.id === "string" ? args.id : undefined;
      const name = typeof args.name === "string" ? args.name : undefined;
      const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name }, (item) => item.kind !== "singleTask");
      if (resolved.status === "not_found") return { status: "rejected", message: resolved.message };
      if (resolved.status === "ambiguous") {
        const list = resolved.candidates.map((c) => `${c.name} (${c.type}, id ${c.id})`).join("; ");
        return { status: "need_info", message: `Several items match: ${list}. Ask which one, then call again with its id.` };
      }
      const item = resolved.status === "ok" ? resolved.items[0] : undefined;
      if (!item || item.kind === "singleTask") return { status: "rejected", message: "Only habits and recurring tasks can be archived, so only they can come back." };
      return planUnarchive(item, todayISO);
    },
  },
  // §70: the undo tool: Claude's own last change. It only puts back the state from just before
  // that change, and refuses if anything touched those items since, so no data made afterwards
  // is lost; still marked destructive (§80), as undoing a create removes the item just created.
  undo: {
    run: (data, _args, todayISO) => {
      const plan = planUndo(data, "claude", todayISO);
      if (plan.status === "rejected") return plan;
      return { status: "ok", recordUndo: false, apply: plan.apply, describe: () => ({ message: plan.message }) };
    },
  },
  // §76: create_items with `items`. No templates: Claude builds the set, the app's rules check it.
  add_pack: {
    run: (data, args, todayISO) => {
      const raw = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
      if (raw.length === 0) return { status: "need_info", message: "Pass the items of the set in `items`." };
      const items: PackItem[] = [];
      for (const item of raw) {
        const kind = item.kind === "habit" || item.kind === "recurringTask" || item.kind === "singleTask" ? item.kind : "habit";
        let recurrence;
        if (kind !== "singleTask" && item.recurrence !== undefined) {
          const parsed = parseCompactRecurrence(typeof item.recurrence === "string" ? item.recurrence : undefined);
          if (!parsed.ok) return { status: "rejected", message: `"${String(item.name)}": ${parsed.error}. Use create_items' recurrence format.` };
          recurrence = parsed.rule;
        }
        const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : undefined);
        items.push({
          kind,
          name: text("name") ?? "",
          description: text("description"),
          categoryId: text("category"),
          dayPart: isDayPart(item.dayPart) ? item.dayPart : undefined,
          recurrence,
          completionType: ["yesno", "value", "timer", "checklist"].includes(String(item.completionType)) ? (item.completionType as PackItem["completionType"]) : undefined,
          target: typeof item.target === "number" ? item.target : undefined,
          unit: text("unit"),
          checklistItems: Array.isArray(item.checklistItems) ? item.checklistItems.filter((step): step is string => typeof step === "string") : undefined,
        });
      }
      const startDate = typeof args.startDate === "string" && isISODate(args.startDate) ? args.startDate : undefined;
      const plan = planPack(data, typeof args.name === "string" ? args.name : "", items, todayISO, startDate);
      if (args.confirm !== true || plan.items.length === 0) {
        return { result: { status: plan.items.length ? "needs_confirm" : "rejected", question: describePackPreview(plan, todayISO) } };
      }
      return { status: "ok", apply: (d) => applyPack(d, plan, todayISO), describe: () => ({ message: describePackAdded(plan, todayISO) }) };
    },
  },
  // §72: get_history with format csv, as text for Claude to save. Capped: a tool result has to stay small.
  export: {
    run: (data, args, todayISO) => {
      const from = typeof args.from === "string" && args.from ? args.from : undefined;
      const to = typeof args.to === "string" && args.to ? args.to : undefined;
      if (!from || !to) return { status: "need_info", message: 'Ask the user which period to export, e.g. "October" or "last month".' };
      if (!isISODate(from) || !isISODate(to)) return { status: "rejected", message: "from and to are YYYY-MM-DD dates." };
      const refusal = exportRefusal(from, to, todayISO);
      if (refusal) return { status: "rejected", message: refusal };
      const file = buildExportCsv(rolloverPersistentTasks(data, todayISO), from, to, todayISO);
      if (file.rows > EXPORT_MAX_ROWS) {
        return { status: "rejected", message: `That's ${file.rows} rows, more than ${EXPORT_MAX_ROWS} at once. Export a shorter period (or several), or use the export in the Habit Assistant app, which has no limit.` };
      }
      return { result: { from: file.from, to: file.to, filename: file.filename, rows: file.rows, columns: EXPORT_COLUMNS, csv: file.csv } };
    },
  },
  // §75/§78: several items by names or filters, for set_done, schedule and update_items. Never
  // a delete: those tools don't ask first.
  apply_to_many: {
    run: (data, args, todayISO) => {
      const actions: BulkAction[] = ["done", "undone", "skip", "pause", "resume"];
      const action = args.action === "edit" ? "edit" : actions.find((a) => a === args.action);
      if (!action) return { status: "need_info", message: 'Pass action: "done", "undone", "skip", "pause", "resume" or "edit".' };
      const date = (key: string) => (typeof args[key] === "string" && args[key] ? (args[key] as string) : undefined);
      for (const key of ["date", "from", "resumeOn"]) {
        const value = date(key);
        if (value && !isISODate(value)) return { status: "rejected", message: `"${value}" is not a YYYY-MM-DD date.` };
      }
      let categoryId: string | undefined;
      if (typeof args.category === "string" && args.category) {
        categoryId = resolveCategoryId(data, args.category);
        if (!categoryId) return { status: "rejected", message: `There's no category called "${args.category}".` };
      }
      if (args.dayPart !== undefined && !isDayPart(args.dayPart)) return { status: "rejected", message: "dayPart must be one of the six parts of the day." };
      const kind = args.kind === "habit" || args.kind === "recurringTask" || args.kind === "singleTask" ? args.kind : undefined;
      const names = Array.isArray(args.names) ? args.names.filter((name): name is string => typeof name === "string" && name.trim() !== "") : undefined;
      const filter: BulkFilter = { names, dayPart: isDayPart(args.dayPart) ? args.dayPart : undefined, categoryId, kind };
      let plan;
      if (action === "edit") {
        // §78: one edit on all of them.
        let recurrence;
        if (args.newRecurrence !== undefined) {
          const parsed = parseCompactRecurrence(typeof args.newRecurrence === "string" ? args.newRecurrence : undefined);
          if (!parsed.ok) return { status: "rejected", message: `${parsed.error}. Use create_items' recurrence format.` };
          recurrence = parsed.rule;
        }
        let newCategoryId: string | undefined;
        if (typeof args.newCategory === "string" && args.newCategory) {
          newCategoryId = resolveCategoryId(data, args.newCategory);
          if (!newCategoryId) return { status: "rejected", message: `There's no category called "${args.newCategory}".` };
        }
        if (args.newDayPart !== undefined && !isDayPart(args.newDayPart)) return { status: "rejected", message: "newDayPart must be one of the six parts of the day." };
        const edit = {
          dayPart: isDayPart(args.newDayPart) ? args.newDayPart : undefined,
          important: typeof args.newImportant === "boolean" ? args.newImportant : undefined,
          categoryId: newCategoryId,
          recurrence,
        };
        plan = planBulkEdit(rolloverPersistentTasks(data, todayISO), filter, edit, todayISO, args.confirm === true);
      } else {
        plan = planBulk(
          rolloverPersistentTasks(data, todayISO),
          { action, filter, date: date("date"), from: date("from"), resumeOn: date("resumeOn") },
          todayISO,
          args.confirm === true,
        );
      }
      if (plan.status === "rejected") return plan;
      if (plan.status === "ambiguous") {
        const list = plan.candidates.map((c) => `${c.name} (${c.kind}, id ${c.id})`).join("; ");
        return { status: "need_info", message: `"${plan.name}" matches several items: ${list}. Ask which one, then call again with that item's full name.` };
      }
      if (plan.status === "needs_confirm") return { result: { status: "needs_confirm", question: plan.question } };
      if (plan.targets.length === 0) return { result: { status: "ok", changed: [], message: plan.message } };
      return {
        status: "ok",
        apply: (d) => plan.apply(rolloverPersistentTasks(d, todayISO)),
        describe: () => ({ message: plan.message }),
      };
    },
  },
  // §73: get_history with view missed, with the same nudges as the app.
  missed: {
    run: (data, args, todayISO) => {
      const given = (value: unknown) => (typeof value === "string" && value ? value : undefined);
      let from = given(args.from) ?? given(args.to);
      let to = given(args.to) ?? given(args.from);
      let assumed: "thisWeek" | "lastWeek" | undefined;
      if (!from || !to) {
        ({ from, to, assumed } = defaultMissedPeriod(todayISO, weekStartOf(data)));
      } else {
        if (!isISODate(from) || !isISODate(to) || to < from) return { status: "rejected", message: "from and to are YYYY-MM-DD dates, from first." };
        if (from >= todayISO) return { status: "rejected", message: "Nothing counts as missed until the day is over; ask about yesterday or earlier." };
        if (to >= todayISO) to = addDays(todayISO, -1);
        if (historyRangeDays(from, to) > HISTORY_MAX_DAYS) return { status: "rejected", message: `At most ${HISTORY_MAX_DAYS} days at a time.` };
      }
      const missed = getMissed(rolloverPersistentTasks(data, todayISO), from, to, todayISO, assumed);
      return {
        result: {
          from: missed.from,
          to: missed.to,
          period: describeMissedPeriod(missed, todayISO),
          total: missed.total,
          items: missed.items,
          carriedOver: missed.carried,
          suggestions: missed.nudges.map(describeNudge),
        },
      };
    },
  },
  // §69: the settings tool. Claude has no device of its own, so read-aloud changes on every
  // device (and any added later).
  settings: {
    run: (data, args) => {
      const weekStart = args.weekStartsOn === "monday" ? 1 : args.weekStartsOn === "sunday" ? 0 : undefined;
      if (args.weekStartsOn !== undefined && weekStart === undefined) {
        return { status: "rejected", message: 'weekStartsOn is "sunday" or "monday"; the week can only start on one of those.' };
      }
      const readAloud = typeof args.readAloud === "boolean" ? args.readAloud : undefined;
      if (weekStart === undefined && readAloud === undefined) {
        return {
          result: {
            firstDayOfWeek: weekStartOf(data) === 1 ? "Monday" : "Sunday",
            readRepliesAloud: readAloudEverywhere(data),
            note: NOT_BY_CHAT,
          },
        };
      }
      const before = weekStartOf(data);
      return {
        status: "ok",
        apply: (d) => {
          let next = weekStart === undefined ? d : withWeekStart(d, weekStart);
          if (readAloud !== undefined) next = withReadAloudEverywhere(next, readAloud);
          return next;
        },
        describe: () => ({
          message: [
            ...(weekStart === undefined ? [] : [describeWeekStart(before, weekStart)]),
            ...(readAloud === undefined ? [] : [describeReadAloudEverywhere(readAloud)]),
          ].join(" "),
        }),
      };
    },
  },
  // §68: schedule's `unskip`.
  unskip: {
    run: (data, args, todayISO) => {
      const date = typeof args.date === "string" && args.date ? args.date : todayISO;
      if (!isISODate(date)) return { status: "rejected", message: `"${date}" is not a YYYY-MM-DD date.` };
      const id = typeof args.id === "string" ? args.id : undefined;
      const name = typeof args.name === "string" ? args.name : undefined;
      const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name }, (item) => item.kind !== "singleTask");
      if (resolved.status === "not_found") return { status: "rejected", message: resolved.message };
      if (resolved.status === "ambiguous") {
        const list = resolved.candidates.map((c) => `${c.name} (${c.type}, id ${c.id})`).join("; ");
        return { status: "need_info", message: `Several items match: ${list}. Ask which one, then call again with its id.` };
      }
      const item = resolved.status === "ok" ? resolved.items[0] : undefined;
      if (!item || item.kind === "singleTask") return { status: "rejected", message: "Only habits and recurring tasks can be skipped." };
      if (date < todayISO || !skipOn(item, date)) return { status: "rejected", message: `"${item.name}" isn't skipped on ${date}.` };
      return {
        status: "ok",
        apply: (d) => unskipDay(d, item, date),
        describe: () => ({ message: describeUnskip(item, date, todayISO), ownerId: item.id, date }),
      };
    },
  },
  // §67: the set_note tool. Notes also come with set_done and log_progress; this is for a
  // note on its own, changing one, or removing one.
  set_note: {
    run: (data, args, todayISO) => {
      const date = typeof args.date === "string" && args.date ? args.date : todayISO;
      if (!isISODate(date)) return { status: "rejected", message: `"${date}" is not a YYYY-MM-DD date.` };
      // A note isn't a tick: a future day can have one ("bring a towel").
      if (typeof args.note !== "string") return { status: "need_info", message: "Pass `note` (\"\" to remove it)." };
      const text = args.note.trim();
      if (text.length > NOTE_MAX_LENGTH) return { status: "rejected", message: `The note is over ${NOTE_MAX_LENGTH} characters; ask the user to shorten it.` };
      const id = typeof args.id === "string" ? args.id : undefined;
      const name = typeof args.name === "string" ? args.name : undefined;
      const resolved = resolveTargets(data, { ids: id ? [id] : undefined, name });
      if (resolved.status === "not_found") return { status: "rejected", message: resolved.message };
      if (resolved.status === "ambiguous") {
        const list = resolved.candidates.map((c) => `${c.name} (${c.type}, id ${c.id})`).join("; ");
        return { status: "need_info", message: `Several items match: ${list}. Ask which one, then call again with its id.` };
      }
      if (resolved.status !== "ok") return { status: "rejected", message: "That item can't take a note." };
      const item = resolved.items[0];
      const before = noteOn(data, item.id, date);
      if (!text && !before) return { status: "rejected", message: `"${item.name}" has no note on ${date}.` };
      return {
        status: "ok",
        apply: (d) => setDayNote(d, item.id, date, text),
        describe: () => ({
          message: text
            ? `Noted for "${item.name}" on ${date}: "${text}".${before ? ` It replaces "${before}".` : ""}`
            : `Removed the note from "${item.name}" on ${date}.`,
          ownerId: item.id,
          date,
        }),
      };
    },
  },
};

