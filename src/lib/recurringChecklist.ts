// §42: a Recurring Task's checklist, as it looks on one occurrence. Each occurrence has
// its own list, derived from the stored items rather than copied per date:
//
// - carryOver (the default): an item belongs to every occurrence from its `addedOn` until
//   the day it's ticked (`doneOn`). So unticked items simply keep showing up at the next
//   occurrence, and ticked ones stay behind on the day they were ticked — no rollover job.
// - sameList: the stored items are a routine; which of them are ticked is kept per date in
//   `checklistDoneByDate`, so every occurrence starts with all items unticked.
//
// Either way an item added on some date never shows on earlier occurrences.
import type { ChecklistItem, ChecklistMode, RecurringTask } from "../types/models";

export function checklistModeOf(task: RecurringTask): ChecklistMode {
  return task.checklistMode ?? "carryOver";
}

function belongsFrom(item: ChecklistItem, dateISO: string): boolean {
  return item.addedOn === undefined || item.addedOn <= dateISO;
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
      .filter((item) => belongsFrom(item, dateISO))
      .map((item) => ({ id: item.id, text: item.text, checked: ticked.has(item.id) }));
  }
  return task.checklist
    .filter((item) => {
      const doneOn = carryOverDoneOn(item);
      return belongsFrom(item, dateISO) && (doneOn === undefined || doneOn >= dateISO);
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
