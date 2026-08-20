import type { Category, CompletionLogEntry, Habit, SingleTask } from "../types/models";
import { completionsInPeriod, getHabitsForDate } from "../lib/recurrence";
import { isSingleTaskActiveOn } from "../lib/dataStore";

type DayItem = { kind: "habit"; item: Habit } | { kind: "singleTask"; item: SingleTask };

interface DayViewProps {
  selectedDate: string;
  habits: Habit[];
  singleTasks: SingleTask[];
  completionLog: CompletionLogEntry[];
  categories: Category[];
  onToggleHabit: (habitId: string) => void;
  onToggleTask: (taskId: string) => void;
}

function getItemsForDate(habits: Habit[], singleTasks: SingleTask[], dateISO: string): DayItem[] {
  const habitItems: DayItem[] = getHabitsForDate(habits, dateISO).map((item) => ({ kind: "habit", item }));
  const taskItems: DayItem[] = singleTasks
    .filter((task) => isSingleTaskActiveOn(task, dateISO))
    .map((item) => ({ kind: "singleTask", item }));
  return [...habitItems, ...taskItems].sort(
    (a, b) => b.item.priority - a.item.priority || a.item.name.localeCompare(b.item.name),
  );
}

export default function DayView({
  selectedDate,
  habits,
  singleTasks,
  completionLog,
  categories,
  onToggleHabit,
  onToggleTask,
}: DayViewProps) {
  const items = getItemsForDate(habits, singleTasks, selectedDate);

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nothing for this date — ask the assistant to add a habit or task.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((entry) =>
        entry.kind === "habit" ? (
          <HabitRow
            key={entry.item.id}
            habit={entry.item}
            selectedDate={selectedDate}
            completionLog={completionLog}
            categories={categories}
            onToggle={onToggleHabit}
          />
        ) : (
          <TaskRow key={entry.item.id} task={entry.item} categories={categories} onToggle={onToggleTask} />
        ),
      )}
    </ul>
  );
}

function HabitRow({
  habit,
  selectedDate,
  completionLog,
  categories,
  onToggle,
}: {
  habit: Habit;
  selectedDate: string;
  completionLog: CompletionLogEntry[];
  categories: Category[];
  onToggle: (habitId: string) => void;
}) {
  const category = categories.find((c) => c.id === habit.categoryId);
  const isDone = completionLog.some((entry) => entry.itemId === habit.id && entry.date === selectedDate);
  return (
    <li className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
      <span aria-hidden>{category?.icon ?? "◻️"}</span>
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
        <input type="checkbox" checked={isDone} onChange={() => onToggle(habit.id)} className="h-4 w-4" />
      ) : (
        <button
          onClick={() => onToggle(habit.id)}
          className={`shrink-0 rounded-md px-2 py-1 text-xs ${
            isDone ? "bg-violet-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {isDone ? "Done" : "Mark done"}
        </button>
      )}
    </li>
  );
}

function TaskRow({
  task,
  categories,
  onToggle,
}: {
  task: SingleTask;
  categories: Category[];
  onToggle: (taskId: string) => void;
}) {
  const category = categories.find((c) => c.id === task.categoryId);
  return (
    <li className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
      <span aria-hidden>{category?.icon ?? "◻️"}</span>
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => onToggle(task.id)}
        className="h-4 w-4"
      />
      <div className={`flex-1 ${task.done ? "text-slate-500 line-through" : ""}`}>
        <div>{task.name}</div>
        {task.description && <div className="text-xs text-slate-500">{task.description}</div>}
      </div>
    </li>
  );
}
