// §42: a Recurring Task's checklist, as it looks on one occurrence. Each occurrence has
// its own list, derived from the stored items rather than copied per date:
//
// - carryOver (the default): an item belongs to every occurrence from its `addedOn` until
//   the day it's ticked (`doneOn`). So unticked items simply keep showing up at the next
//   occurrence, and ticked ones stay behind on the day they were ticked — no rollover job.
// - sameList: the stored items are a routine; which of them are ticked is kept per date in
//   `checklistDoneByDate`, so every occurrence starts with all items unticked.
//
// Either way an item added on some date never shows on earlier occurrences, and one removed
// on some date (§56, `removedOn`) keeps showing on the occurrences before it.
import type { ChecklistItem, ChecklistMode, RecurringTask } from "../types/models";

export function checklistModeOf(task: RecurringTask): ChecklistMode {
  return task.checklistMode ?? "carryOver";
}

function belongsFrom(item: ChecklistItem, dateISO: string): boolean {
  return item.addedOn === undefined || item.addedOn <= dateISO;
}

function belongsOn(item: ChecklistItem, dateISO: string): boolean {
  return belongsFrom(item, dateISO) && (item.removedOn === undefined || dateISO < item.removedOn);
}

// Items from before §42 carry `checked: true` without a `doneOn`: they were ticked at
// some unknown point in the past, so they count as done before any day asked about.
function carryOverDoneOn(item: ChecklistItem): string | undefined {
  return item.doneOn ?? (item.checked ? "" : undefined);
}

/** The checklist to show for `dateISO`, with `checked` resolved for that date. Undefined when the task has no checklist. */
export function recurringTaskChecklistOn(task: RecurringTask, dateISO: string): ChecklistItem[] | undefined {
  if (!task.checklist) return undefined;
  if (checklistModeOf(task) === "sameList") {
    const ticked = new Set(task.checklistDoneByDate?.[dateISO] ?? []);
    return task.checklist
      .filter((item) => belongsOn(item, dateISO))
      .map((item) => ({ id: item.id, text: item.text, checked: ticked.has(item.id) }));
  }
  return task.checklist
    .filter((item) => {
      const doneOn = carryOverDoneOn(item);
      return belongsOn(item, dateISO) && (doneOn === undefined || doneOn >= dateISO);
    })
    .map((item) => ({ id: item.id, text: item.text, checked: carryOverDoneOn(item) === dateISO }));
}

export function isRecurringTaskChecklistItemChecked(task: RecurringTask, itemId: string, dateISO: string): boolean {
  return !!recurringTaskChecklistOn(task, dateISO)?.find((item) => item.id === itemId)?.checked;
}

export function withRecurringTaskChecklistItemChecked(
  task: RecurringTask,
  itemId: string,
  checked: boolean,
  dateISO: string,
): RecurringTask {
  if (!task.checklist) return task;
  if (checklistModeOf(task) === "sameList") {
    const ids = (task.checklistDoneByDate?.[dateISO] ?? []).filter((id) => id !== itemId);
    const doneByDate = { ...task.checklistDoneByDate };
    if (checked) doneByDate[dateISO] = [...ids, itemId];
    else if (ids.length > 0) doneByDate[dateISO] = ids;
    else delete doneByDate[dateISO];
    return { ...task, checklistDoneByDate: doneByDate };
  }
  return {
    ...task,
    checklist: task.checklist.map((item) => {
      if (item.id !== itemId) return item;
      // Unticking is only meaningful on the day it was ticked (on a later day the item
      // isn't listed any more); it puts the item back on every occurrence from addedOn.
      if (!checked) return { ...item, checked: false, doneOn: undefined };
      return { ...item, checked: false, doneOn: dateISO };
    }),
  };
}

export function withRecurringTaskChecklistItemAdded(task: RecurringTask, text: string, dateISO: string): RecurringTask {
  const item: ChecklistItem = { id: crypto.randomUUID(), text, checked: false, addedOn: dateISO };
  return { ...task, checklist: [...(task.checklist ?? []), item] };
}

/**
 * §56: what a removal on `dateISO` can name — that day's list, plus items only added for a
 * later day (from a future day's view), which aren't on any list yet.
 */
export function removableRecurringTaskChecklistItems(task: RecurringTask, dateISO: string): ChecklistItem[] {
  const later = (task.checklist ?? [])
    .filter((item) => !belongsFrom(item, dateISO))
    .map((item) => ({ id: item.id, text: item.text, checked: false }));
  return [...(recurringTaskChecklistOn(task, dateISO) ?? []), ...later];
}

/**
 * §56: takes an item off the list from `dateISO` on, in either mode. Earlier occurrences
 * keep it, with their ticks, so the past doesn't change; an item that never showed before
 * `dateISO` (added that day or later) is dropped outright.
 */
export function withRecurringTaskChecklistItemRemoved(task: RecurringTask, itemId: string, dateISO: string): RecurringTask {
  if (!task.checklist) return task;
  return {
    ...task,
    checklist: task.checklist.flatMap((item) => {
      if (item.id !== itemId) return [item];
      if (item.addedOn !== undefined && item.addedOn >= dateISO) return [];
      if (item.removedOn !== undefined && item.removedOn <= dateISO) return [item];
      return [{ ...item, removedOn: dateISO }];
    }),
  };
}

/** §56: back to a plain task — the list, its mode and every occurrence's ticks all go. */
export function withoutChecklist(task: RecurringTask): RecurringTask {
  return { ...task, checklist: undefined, checklistMode: undefined, checklistDoneByDate: undefined };
}

/**
 * Switches mode, keeping what's current from `todayISO` on. Older days' checklist history
 * is not preserved across a switch (rare, and said in the reply):
 * - to sameList: the routine is the items still on the list from today; today's ticks stay.
 * - to carryOver: every routine item is pending again, except those ticked today.
 * A task without a checklist gets an empty one: asking for a mode implies a checklist.
 */
export function withChecklistMode(task: RecurringTask, mode: ChecklistMode, todayISO: string): RecurringTask {
  if (!task.checklist) return { ...task, checklist: [], checklistMode: mode, checklistDoneByDate: undefined };
  if (checklistModeOf(task) === mode) return { ...task, checklistMode: mode };
  const current = recurringTaskChecklistOn(task, todayISO) ?? [];
  const byId = new Map(task.checklist.map((item) => [item.id, item]));
  // Items added after today (from a future day's view) stay too, in their order.
  const later = task.checklist.filter((item) => !belongsFrom(item, todayISO));
  const kept = [...current.map((item) => ({ stored: byId.get(item.id)!, checked: item.checked })), ...later.map((stored) => ({ stored, checked: false }))];
  const plain = (stored: ChecklistItem): ChecklistItem => ({
    id: stored.id,
    text: stored.text,
    checked: false,
    ...(stored.addedOn !== undefined ? { addedOn: stored.addedOn } : {}),
    ...(stored.removedOn !== undefined ? { removedOn: stored.removedOn } : {}),
  });
  if (mode === "sameList") {
    const tickedToday = kept.filter((k) => k.checked).map((k) => k.stored.id);
    return {
      ...task,
      checklistMode: mode,
      checklist: kept.map((k) => plain(k.stored)),
      checklistDoneByDate: tickedToday.length > 0 ? { [todayISO]: tickedToday } : undefined,
    };
  }
  return {
    ...task,
    checklistMode: mode,
    checklist: kept.map((k) => (k.checked ? { ...plain(k.stored), doneOn: todayISO } : plain(k.stored))),
    checklistDoneByDate: undefined,
  };
}
