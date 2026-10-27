// get_day: the Today tab as data. Same selection and order as DayView.tsx (occursOn via
// getHabitsForDate/getRecurringTasksForDate, isSingleTaskActiveOn, groupByDayPart) so the
// agent and the PWA always agree on what's due. Pure: no Drive, no clock.
import {
  weekStartOf,
  type AppData,
  type ChecklistItem,
  type CompletionLogEntry,
  type DayPart,
  type Habit,
  type RecurringTask,
  type SingleTask,
} from "../types/models.ts";
import { completionsInPeriod, getHabitsForDate, getRecurringTasksForDate, isFutureDate } from "../lib/recurrence.ts";
import { isSingleTaskActiveOn, rolloverPersistentTasks } from "../lib/dataStore.ts";
import { checklistItemsForEntry, isHabitEntryComplete } from "../lib/habitStats.ts";
import { recurringTaskChecklistOn } from "../lib/recurringChecklist.ts";
import { groupByDayPart, isImportant } from "../lib/dayParts.ts";
import { noteOn } from "../lib/dayNotes.ts";

interface ChecklistView {
  checked: number;
  total: number;
  items: { id: string; text: string; checked: boolean }[];
}

interface DayItemBase {
  id: string;
  name: string;
  important: boolean;
  category?: string;
  done: boolean;
  checklist?: ChecklistView;
  note?: string; // §67: the note on this day
}

export type DayItemView =
  | (DayItemBase & {
      kind: "habit";
      completionType: Habit["completionType"];
      value?: number; // value and timer habits: what's logged that day
      target?: number;
      unit?: string; // "minutes" for timer habits
      periodProgress?: { done: number; target: number; period: "week" | "month" }; // N times per week/month
    })
  | (DayItemBase & { kind: "recurringTask" })
  | (DayItemBase & { kind: "singleTask"; originalStartDate?: string });

export interface DayGroupView {
  part: DayPart | null; // null = not placed yet
  label: string;
  items: DayItemView[];
}

export interface DayView {
  date: string;
  /** Only known when the caller knows the user's today; drives the roll-forward and the future flag. */
  today?: string;
  isFuture?: boolean;
  groups: DayGroupView[];
}

function checklistView(items: ChecklistItem[]): ChecklistView {
  return {
    checked: items.filter((item) => item.checked).length,
    total: items.length,
    items: items.map(({ id, text, checked }) => ({ id, text, checked })),
  };
}

function categoryName(data: AppData, categoryId: string | undefined): string | undefined {
  return data.categories.find((category) => category.id === categoryId)?.name;
}

function habitView(data: AppData, habit: Habit, dateISO: string): DayItemView {
  const entry: CompletionLogEntry | undefined = data.completionLog.find((e) => e.itemId === habit.id && e.date === dateISO);
  const view: DayItemView = {
    kind: "habit",
    id: habit.id,
    name: habit.name,
    important: isImportant(habit),
    category: categoryName(data, habit.categoryId),
    done: isHabitEntryComplete(habit, entry),
    completionType: habit.completionType,
  };
  if (habit.completionType === "value" || habit.completionType === "timer") {
    view.value = entry?.value ?? 0;
    view.target = habit.target;
    view.unit = habit.completionType === "timer" ? "minutes" : habit.unit;
  }
  if (habit.completionType === "checklist") {
    view.checklist = checklistView(checklistItemsForEntry(habit, entry, dateISO));
  }
  if (habit.recurrence.type === "timesPerPeriod") {
    view.periodProgress = {
      done: completionsInPeriod(data.completionLog, habit.id, dateISO, habit.recurrence.period, weekStartOf(data)),
      target: habit.recurrence.count,
      period: habit.recurrence.period,
    };
  }
  return view;
}

function recurringTaskView(data: AppData, task: RecurringTask, dateISO: string): DayItemView {
  const items = recurringTaskChecklistOn(task, dateISO);
  return {
    kind: "recurringTask",
    id: task.id,
    name: task.name,
    important: isImportant(task),
    category: categoryName(data, task.categoryId),
    done: data.completionLog.some((entry) => entry.itemId === task.id && entry.date === dateISO),
    ...(items ? { checklist: checklistView(items) } : {}),
  };
}

function singleTaskView(data: AppData, task: SingleTask): DayItemView {
  return {
    kind: "singleTask",
    id: task.id,
    name: task.name,
    important: isImportant(task),
    category: categoryName(data, task.categoryId),
    done: task.done,
    ...(task.checklist ? { checklist: checklistView(task.checklist) } : {}),
    ...(task.originalStartDate && task.originalStartDate !== task.startDate ? { originalStartDate: task.originalStartDate } : {}),
  };
}

/** One item as it stands on `dateISO` (a one-off task: on its own day), in get_day's shape. Write tools return this, so a reply describes what was actually saved. */
export function dayItemView(data: AppData, item: Habit | RecurringTask | SingleTask, dateISO: string): DayItemView {
  const view =
    item.kind === "habit" ? habitView(data, item, dateISO) : item.kind === "recurringTask" ? recurringTaskView(data, item, dateISO) : singleTaskView(data, item);
  const note = noteOn(data, item.id, dateISO);
  return note ? { ...view, note } : view;
}

type Due =
  | { kind: "habit"; item: Habit }
  | { kind: "recurringTask"; item: RecurringTask }
  | { kind: "singleTask"; item: SingleTask };

/**
 * The items due on `dateISO`, grouped by part of the day in the app's one sort order.
 * With `todayISO`, unfinished one-off tasks are first rolled forward to today in memory,
 * as the PWA does when it opens; nothing is written back.
 */
export function getDay(data: AppData, dateISO: string, todayISO?: string): DayView {
  const view = todayISO ? rolloverPersistentTasks(data, todayISO) : data;
  const due: Due[] = [
    ...getHabitsForDate(view.habits, dateISO).map((item): Due => ({ kind: "habit", item })),
    ...view.singleTasks.filter((task) => isSingleTaskActiveOn(task, dateISO)).map((item): Due => ({ kind: "singleTask", item })),
    ...getRecurringTasksForDate(view.recurringTasks, dateISO).map((item): Due => ({ kind: "recurringTask", item })),
  ];
  const groups = groupByDayPart(due, (entry) => entry.item).map((group) => ({
    part: group.part ?? null,
    label: group.label,
    items: group.items.map((entry) => dayItemView(view, entry.item, dateISO)),
  }));
  return {
    date: dateISO,
    ...(todayISO ? { today: todayISO, isFuture: isFutureDate(dateISO, todayISO) } : {}),
    groups,
  };
}
