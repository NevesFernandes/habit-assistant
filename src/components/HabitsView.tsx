import { useState, type ReactNode } from "react";
import type { Category, CompletionLogEntry, Habit } from "../types/models";
import { describeRecurrence, isArchived, todayISO } from "../lib/recurrence";
import { computeHabitStats } from "../lib/habitStats";
import CategoryIcon from "./CategoryIcon";

interface HabitsViewProps {
  habits: Habit[];
  categories: Category[];
  completionLog: CompletionLogEntry[];
}

const COMPLETION_TYPE_LABELS: Record<Habit["completionType"], string> = {
  yesno: "Yes/No",
  value: "Numeric value",
  timer: "Timer",
  checklist: "Checklist",
};

export default function HabitsView({ habits, categories, completionLog }: HabitsViewProps) {
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);

  const selectedHabit = selectedHabitId ? habits.find((habit) => habit.id === selectedHabitId) : undefined;

  if (selectedHabit) {
    return (
      <HabitDetail
        habit={selectedHabit}
        categories={categories}
        completionLog={completionLog}
        onBack={() => setSelectedHabitId(null)}
      />
    );
  }

  const sortedHabits = habits
    .slice()
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  if (sortedHabits.length === 0) {
    return <p className="text-sm text-slate-500">No habits yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {sortedHabits.map((habit) => {
        const category = categories.find((c) => c.id === habit.categoryId);
        return (
          <li key={habit.id}>
            <button
              onClick={() => setSelectedHabitId(habit.id)}
              className="flex w-full items-center gap-3 rounded-md bg-slate-800 px-3 py-2 text-left hover:bg-slate-700"
            >
              <CategoryIcon name={category?.icon} className="h-4 w-4 shrink-0" />
              <div className="flex-1">
                <div>
                  {habit.name}
                  {isArchived(habit) && <span className="ml-2 text-xs text-amber-400">Archived</span>}
                </div>
                {habit.description && <div className="text-xs text-slate-500">{habit.description}</div>}
                <div className="text-xs text-slate-500">{describeRecurrence(habit.recurrence)}</div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HabitDetail({
  habit,
  categories,
  completionLog,
  onBack,
}: {
  habit: Habit;
  categories: Category[];
  completionLog: CompletionLogEntry[];
  onBack: () => void;
}) {
  const category = categories.find((c) => c.id === habit.categoryId);
  const archived = isArchived(habit);
  const stats = computeHabitStats(habit, completionLog, todayISO());
  const streakUnit = habit.recurrence.type === "timesPerPeriod" ? "time" : "day";
  const formatStreak = (n: number) => `${n} ${streakUnit}${n === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="self-start rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
      >
        ← Back to habits
      </button>

      <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 text-lg font-medium">
          <CategoryIcon name={category?.icon} className="h-5 w-5 shrink-0" />
          {habit.name}
        </div>

        {habit.description && (
          <DetailRow label="Description">
            <span>{habit.description}</span>
          </DetailRow>
        )}

        <DetailRow label="Category">
          <span>{category?.name ?? "None"}</span>
        </DetailRow>

        <DetailRow label="Priority">
          <span>{habit.priority}</span>
        </DetailRow>

        <DetailRow label="Start date">
          <span>{habit.startDate}</span>
        </DetailRow>

        {habit.endDate && (
          <DetailRow label={archived ? "Archived since" : "End date"}>
            <span>{habit.endDate}</span>
          </DetailRow>
        )}

        <DetailRow label="Recurrence">
          <span>{describeRecurrence(habit.recurrence)}</span>
        </DetailRow>

        <DetailRow label="Completion type">
          <span>{COMPLETION_TYPE_LABELS[habit.completionType]}</span>
        </DetailRow>

        {habit.completionType === "checklist" && habit.checklist && habit.checklist.length > 0 && (
          <DetailRow label="Checklist items">
            <ul className="list-disc pl-5">
              {habit.checklist.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </DetailRow>
        )}

        <div className="mt-1 border-t border-slate-700 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Statistics
        </div>

        <DetailRow label="Current streak">
          <span>{formatStreak(stats.currentStreak)}</span>
        </DetailRow>

        <DetailRow label="Best streak">
          <span>{formatStreak(stats.bestStreak)}</span>
        </DetailRow>

        <DetailRow label="Completion rate">
          <span>{stats.completionPercentage}%</span>
        </DetailRow>

        <DetailRow label="Completions">
          <div className="flex gap-4">
            <StatTile value={stats.completionsThisWeek} label="This week" />
            <StatTile value={stats.completionsThisMonth} label="This month" />
            <StatTile value={stats.completionsThisYear} label="This year" />
            <StatTile value={stats.completionsAllTime} label="All-time" />
          </div>
        </DetailRow>
      </div>
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-base font-medium">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
