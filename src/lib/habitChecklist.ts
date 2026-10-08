// §56: a Checklist habit's steps, as they stood on a given day. `Habit.checklist` is the
// template each occurrence starts from. A day that was ticked has its own snapshot in the
// completion log, but a day nobody touched is shown from the template — so a change to the
// steps must not rewrite the template's past. Each step therefore carries the days it
// applies to: from `addedOn` (absent = since the habit began) until `removedOn` (absent =
// still there). Changes apply from a given day on, today unless the user names an earlier
// one. Type-only imports, so it's runnable under node for tests.
import type { ChecklistItem, Habit } from "../types/models.ts";

type WithChecklist = Pick<Habit, "checklist">;
type WithSteps = Pick<Habit, "checklist" | "startDate">;

/** The steps the habit has now — what a new occurrence starts with. No change is ever dated in the future. */
export function currentHabitChecklist(habit: WithChecklist): ChecklistItem[] {
  return (habit.checklist ?? []).filter((item) => item.removedOn === undefined);
}

/** The steps the habit had on `dateISO`. */
export function habitChecklistOn(habit: WithChecklist, dateISO: string): ChecklistItem[] {
  return (habit.checklist ?? []).filter(
    (item) => (item.addedOn === undefined || item.addedOn <= dateISO) && (item.removedOn === undefined || dateISO < item.removedOn),
  );
}

// Ends a step on `fromISO`. One that never showed on an earlier day is dropped outright:
// there is no past to keep it for.
function ended(item: ChecklistItem, habit: WithSteps, fromISO: string): ChecklistItem[] {
  if ((item.addedOn ?? habit.startDate) >= fromISO) return [];
  return [{ ...item, removedOn: fromISO }];
}

function stillThereFrom(item: ChecklistItem, fromISO: string): boolean {
  return item.removedOn === undefined || item.removedOn > fromISO;
}

/** The habit's stored steps with one removed from `fromISO` on. */
export function withHabitStepRemoved(habit: WithSteps, itemId: string, fromISO: string): ChecklistItem[] {
  return (habit.checklist ?? []).flatMap((item) =>
    item.id === itemId && stillThereFrom(item, fromISO) ? ended(item, habit, fromISO) : [item],
  );
}

/**
 * The habit's stored steps once the list is `texts` from `fromISO` on. Returns the stored
 * steps and, in order, the ones that make up the new list.
 *
 * Stored order is display order on every day, so nothing already stored may move or be
 * reworded — that would change how untouched earlier days look. A step whose text is
 * unchanged stays the same step, in place, and new ones go after it. When that can't give
 * the order asked for (the user reordered the list), every step ends on `fromISO` and the
 * new list starts fresh there.
 */
export function withHabitStepsReplaced(
  habit: WithSteps,
  texts: string[],
  fromISO: string,
  newId: () => string,
): { stored: ChecklistItem[]; steps: ChecklistItem[] } {
  const all = habit.checklist ?? [];
  const fresh = (text: string): ChecklistItem => ({
    id: newId(),
    text,
    checked: false,
    ...(habit.startDate < fromISO ? { addedOn: fromISO } : {}),
  });
  const build = (reuse: boolean) => {
    const wanted = [...texts];
    const steps: ChecklistItem[] = [];
    const stored = all.flatMap((item) => {
      if (!stillThereFrom(item, fromISO)) return [item];
      const index = reuse ? wanted.indexOf(item.text) : -1;
      if (index < 0) return ended(item, habit, fromISO);
      wanted.splice(index, 1);
      const addedOn = item.addedOn !== undefined && item.addedOn > fromISO ? fromISO : item.addedOn;
      const kept: ChecklistItem = { id: item.id, text: item.text, checked: false, ...(addedOn !== undefined ? { addedOn } : {}) };
      steps.push(kept);
      return [kept];
    });
    const added = wanted.map(fresh);
    return { stored: [...stored, ...added], steps: [...steps, ...added] };
  };
  const inPlace = build(true);
  const sameOrder = inPlace.steps.length === texts.length && inPlace.steps.every((item, index) => item.text === texts[index]);
  return sameOrder ? inPlace : build(false);
}
