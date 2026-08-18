import type { Category, CompletionLogEntry, Habit } from "../types/models";
import { completionsInPeriod, getHabitsForDate } from "../lib/recurrence";

interface HabitDayViewProps {
  selectedDate: string;
  habits: Habit[];
  completionLog: CompletionLogEntry[];
  categories: Category[];
  onToggle: (habitId: string) => void;
}

export default function HabitDayView({
  selectedDate,
  habits,
  completionLog,
  categories,
  onToggle,
}: HabitDayViewProps) {
  const occurrences = getHabitsForDate(habits, selectedDate);

  if (occurrences.length === 0) {
    return <p className="text-sm text-slate-500">No habits today — ask the assistant to add one.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {occurrences.map((habit) => {
        const category = categories.find((c) => c.id === habit.categoryId);
        const isDone = completionLog.some(
          (entry) => entry.itemId === habit.id && entry.date === selectedDate,
        );
        return (
          <li key={habit.id} className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
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
              <input
                type="checkbox"
                checked={isDone}
                onChange={() => onToggle(habit.id)}
                className="h-4 w-4"
              />
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
      })}
    </ul>
  );
}
