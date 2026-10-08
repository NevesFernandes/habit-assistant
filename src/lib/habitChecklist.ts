// §56: a Checklist habit's steps, as they stood on a given day. `Habit.checklist` is the
// template each occurrence starts from; a step removed through chat stays in it with a
// `removedOn` date, so earlier days that were never touched (no completion-log snapshot)
// still show it. Type-only imports, so it's runnable under node for tests.
import type { ChecklistItem, Habit } from "../types/models.ts";

type WithChecklist = Pick<Habit, "checklist">;

/** The steps the habit has now — what a new occurrence starts with. A removal is never dated in the future. */
export function currentHabitChecklist(habit: WithChecklist): ChecklistItem[] {
  return (habit.checklist ?? []).filter((item) => item.removedOn === undefined);
}

/** The steps the habit had on `dateISO`, removed ones included up to the day before their removal. */
export function habitChecklistOn(habit: WithChecklist, dateISO: string): ChecklistItem[] {
  return (habit.checklist ?? []).filter((item) => item.removedOn === undefined || dateISO < item.removedOn);
}
