import type { Category, CompletionLogEntry, Habit, RecurringTask, SingleTask } from "../types/models";
import { useState } from "react";
import { completionsInPeriod, getHabitsForDate, getRecurringTasksForDate, isFutureDate } from "../lib/recurrence";
import { isSingleTaskActiveOn } from "../lib/dataStore";
import { checklistItemsForEntry, checklistProgress, isHabitEntryComplete } from "../lib/habitStats";
import CategoryIcon from "./CategoryIcon";
import Checklist from "./Checklist";
import { CompletionControl, YesNoCheckbox } from "./CompletionControl";
import { formatDurationMinutes } from "../lib/duration";

type DayItem =
  | { kind: "habit"; item: Habit }
  | { kind: "singleTask"; item: SingleTask }
  | { kind: "recurringTask"; item: RecurringTask };

interface DayViewProps {
  selectedDate: string;
  todayISO: string;
  habits: Habit[];
  singleTasks: SingleTask[];
  recurringTasks: RecurringTask[];
  completionLog: CompletionLogEntry[];
  categories: Category[];
  onToggleHabit: (habitId: string) => void;
  onToggleTask: (taskId: string) => void;
  onToggleRecurringTask: (taskId: string) => void;
  onToggleHabitChecklistItem: (habitId: string, itemId: string) => void;
  /** §29: completing a future-dated one-off task, which also moves it to today. */
  onCompleteFutureTask: (taskId: string) => void;
}

function getItemsForDate(
  habits: Habit[],
  singleTasks: SingleTask[],
  recurringTasks: RecurringTask[],
  dateISO: string,
): DayItem[] {
  const habitItems: DayItem[] = getHabitsForDate(habits, dateISO).map((item) => ({ kind: "habit", item }));
  const taskItems: DayItem[] = singleTasks
    .filter((task) => isSingleTaskActiveOn(task, dateISO))
    .map((item) => ({ kind: "singleTask", item }));
  const recurringTaskItems: DayItem[] = getRecurringTasksForDate(recurringTasks, dateISO).map((item) => ({
    kind: "recurringTask",
    item,
  }));
  return [...habitItems, ...taskItems, ...recurringTaskItems].sort(
    (a, b) => b.item.priority - a.item.priority || a.item.name.localeCompare(b.item.name),
  );
}

export default function DayView({
  selectedDate,
  todayISO,
  habits,
  singleTasks,
  recurringTasks,
  completionLog,
  categories,
  onToggleHabit,
  onToggleTask,
  onToggleRecurringTask,
  onToggleHabitChecklistItem,
  onCompleteFutureTask,
}: DayViewProps) {
  const items = getItemsForDate(habits, singleTasks, recurringTasks, selectedDate);
  // §29: a day that hasn't happened yet is read-only for completion. One-off tasks are the
  // exception — they can be done early, after confirming the move to today.
  const isFuture = isFutureDate(selectedDate, todayISO);
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nothing for this date — ask the assistant to add a habit or task.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {isFuture && (
        <p className="text-xs text-amber-300/80">
          This day hasn't happened yet — you can plan here, but completion can only be ticked on the day itself.
        </p>
      )}
      <ul className="flex flex-col gap-2">
      {items.map((entry) => {
        if (entry.kind === "habit") {
          return (
            <HabitRow
              key={entry.item.id}
              habit={entry.item}
              selectedDate={selectedDate}
              completionLog={completionLog}
              categories={categories}
              readOnly={isFuture}
              onToggle={onToggleHabit}
              onToggleChecklistItem={onToggleHabitChecklistItem}
            />
          );
        }
        if (entry.kind === "recurringTask") {
          return (
            <RecurringTaskRow
              key={entry.item.id}
              task={entry.item}
              selectedDate={selectedDate}
              completionLog={completionLog}
              categories={categories}
              readOnly={isFuture}
              onToggle={onToggleRecurringTask}
            />
          );
        }
        return (
          <TaskRow
            key={entry.item.id}
            task={entry.item}
            categories={categories}
            isFuture={isFuture}
            confirming={confirmingTaskId === entry.item.id}
            onToggle={onToggleTask}
            onAskConfirm={() => setConfirmingTaskId(entry.item.id)}
            onCancelConfirm={() => setConfirmingTaskId(null)}
            onConfirm={() => {
              setConfirmingTaskId(null);
              onCompleteFutureTask(entry.item.id);
            }}
          />
        );
      })}
      </ul>
    </div>
  );
}

const FUTURE_TITLE = "This day hasn't happened yet";

function HabitRow({
  habit,
  selectedDate,
  completionLog,
  categories,
  readOnly,
  onToggle,
  onToggleChecklistItem,
}: {
  habit: Habit;
  selectedDate: string;
  completionLog: CompletionLogEntry[];
  categories: Category[];
  readOnly: boolean;
  onToggle: (habitId: string) => void;
  onToggleChecklistItem: (habitId: string, itemId: string) => void;
}) {
  const category = categories.find((c) => c.id === habit.categoryId);
  const entry = completionLog.find((e) => e.itemId === habit.id && e.date === selectedDate);
  const isDone = isHabitEntryComplete(habit, entry);
  const checklistItems = habit.completionType === "checklist" ? checklistItemsForEntry(habit, entry) : [];
  const progress = habit.completionType === "checklist" ? checklistProgress(habit, entry) : null;
  return (
    <li
      className={`flex gap-3 rounded-md bg-slate-800 px-3 py-2 ${
        habit.completionType === "checklist" ? "flex-col" : "items-center"
      }`}
    >
      <div className="flex w-full items-center gap-3">
        <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
        <div className={`flex-1 ${isDone ? "text-slate-500 line-through" : ""}`}>
          <div>{habit.name}</div>
          {habit.description && <div className="text-xs text-slate-500">{habit.description}</div>}
          {habit.recurrence.type === "timesPerPeriod" && (
            <div className="text-xs text-violet-300">
              {completionsInPeriod(completionLog, habit.id, selectedDate, habit.recurrence.period)}/
              {habit.recurrence.count} this {habit.recurrence.period}
            </div>
          )}
        </div>
        {habit.completionType === "yesno" ? (
          <YesNoCheckbox
            checked={isDone}
            onChange={() => onToggle(habit.id)}
            disabled={readOnly}
            title={readOnly ? FUTURE_TITLE : undefined}
          />
        ) : habit.completionType === "value" || habit.completionType === "timer" ? (
          <CompletionControl>
            <span className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300">
              {habit.completionType === "timer" ? (
                <>
                  {entry?.value !== undefined ? formatDurationMinutes(entry.value) : "—"}
                  {habit.target !== undefined ? ` / ${formatDurationMinutes(habit.target)}` : ""}
                </>
              ) : (
                <>
                  {entry?.value ?? "—"}
                  {habit.target !== undefined ? ` / ${habit.target}` : ""}
                  {habit.unit ? ` ${habit.unit}` : ""}
                </>
              )}
            </span>
          </CompletionControl>
        ) : progress ? (
          <CompletionControl>
            <span className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300">
              {progress.checked}/{progress.total}
            </span>
          </CompletionControl>
        ) : null}
      </div>
      {habit.completionType === "checklist" && (
        <Checklist
          items={checklistItems}
          onToggle={(itemId) => onToggleChecklistItem(habit.id, itemId)}
          disabled={readOnly}
          title={readOnly ? FUTURE_TITLE : undefined}
        />
      )}
    </li>
  );
}

function RecurringTaskRow({
  task,
  selectedDate,
  completionLog,
  categories,
  readOnly,
  onToggle,
}: {
  task: RecurringTask;
  selectedDate: string;
  completionLog: CompletionLogEntry[];
  categories: Category[];
  readOnly: boolean;
  onToggle: (taskId: string) => void;
}) {
  const category = categories.find((c) => c.id === task.categoryId);
  const isDone = completionLog.some((entry) => entry.itemId === task.id && entry.date === selectedDate);
  return (
    <li className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
      <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
      <div className={`flex-1 ${isDone ? "text-slate-500 line-through" : ""}`}>
        <div>{task.name}</div>
        {task.description && <div className="text-xs text-slate-500">{task.description}</div>}
        {task.recurrence.type === "timesPerPeriod" && (
          <div className="text-xs text-violet-300">
            {completionsInPeriod(completionLog, task.id, selectedDate, task.recurrence.period)}/
            {task.recurrence.count} this {task.recurrence.period}
          </div>
        )}
      </div>
      <YesNoCheckbox
        checked={isDone}
        onChange={() => onToggle(task.id)}
        disabled={readOnly}
        title={readOnly ? FUTURE_TITLE : undefined}
      />
    </li>
  );
}

// §29: a one-off task can honestly be done early, so instead of blocking the tick on a
// future day it asks — and says that yes moves the task to today, which is also why it
// then disappears from the day being viewed.
function TaskRow({
  task,
  categories,
  isFuture,
  confirming,
  onToggle,
  onAskConfirm,
  onCancelConfirm,
  onConfirm,
}: {
  task: SingleTask;
  categories: Category[];
  isFuture: boolean;
  confirming: boolean;
  onToggle: (taskId: string) => void;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  const category = categories.find((c) => c.id === task.categoryId);
  const askFirst = isFuture && !task.done;
  return (
    <li className="flex flex-col gap-2 rounded-md bg-slate-800 px-3 py-2">
      <div className="flex w-full items-center gap-3">
        <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
        <div className={`flex-1 ${task.done ? "text-slate-500 line-through" : ""}`}>
          <div>{task.name}</div>
          {task.description && <div className="text-xs text-slate-500">{task.description}</div>}
        </div>
        <YesNoCheckbox
          checked={task.done}
          onChange={() => (askFirst ? onAskConfirm() : onToggle(task.id))}
        />
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-2 text-xs text-slate-300">
          <span>This task is in the future. Mark it complete and move it to today?</span>
          <button
            onClick={onConfirm}
            className="rounded-md bg-violet-500 px-2 py-1 text-white hover:bg-violet-400"
          >
            Yes
          </button>
          <button onClick={onCancelConfirm} className="rounded-md bg-slate-700 px-2 py-1 hover:bg-slate-600">
            No
          </button>
        </div>
      )}
    </li>
  );
}
