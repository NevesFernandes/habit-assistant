import { useState } from "react";
import type { Category, CompletionLogEntry, Habit } from "../types/models";
import { aggregateCategoryStats, habitCalendar } from "../lib/habitStats";
import { addDays, todayISO } from "../lib/recurrence";
import CategoryIcon from "./CategoryIcon";
import StatTile from "./StatTile";
import Meter from "./Meter";
import CalendarHeatmap from "./CalendarHeatmap";

// §17 in Roadmap.md: an overview of the numbers HabitsView/CategoriesView already compute
// per-item, plus the one real chart (a calendar heatmap). Habits + Categories only — no
// Recurring Task/Single Task stats exist to show here, see CLAUDE.md.
interface DashboardProps {
  habits: Habit[];
  categories: Category[];
  completionLog: CompletionLogEntry[];
  onViewCategories: () => void;
}

const HEATMAP_WINDOW_DAYS = 364;

export default function Dashboard({ habits, categories, completionLog, onViewCategories }: DashboardProps) {
  const today = todayISO();
  const sortedHabits = habits.slice().sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(sortedHabits[0]?.id ?? null);
  const selectedHabit = sortedHabits.find((h) => h.id === selectedHabitId) ?? sortedHabits[0];

  if (habits.length === 0) {
    return <p className="text-sm text-slate-500">No habits yet — stats will show up here once you have some.</p>;
  }

  const overall = aggregateCategoryStats(habits, completionLog, today);
  const categoryBreakdown = categories
    .map((category) => ({
      category,
      stats: aggregateCategoryStats(
        habits.filter((h) => h.categoryId === category.id),
        completionLog,
        today,
      ),
    }))
    .filter((row) => row.stats.habitCount > 0)
    .sort((a, b) => b.stats.habitCount - a.stats.habitCount);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 rounded-md bg-slate-800 px-4 py-4 sm:flex-row sm:justify-between">
        <Meter percentage={overall.completionPercentage} label={`${overall.habitCount} habit${overall.habitCount === 1 ? "" : "s"}`} />
        <div className="flex gap-4">
          <StatTile value={overall.completionsThisWeek} label="This week" />
          <StatTile value={overall.completionsThisMonth} label="This month" />
          <StatTile value={overall.completionsThisYear} label="This year" />
          <StatTile value={overall.completionsAllTime} label="All-time" />
        </div>
      </div>

      {categoryBreakdown.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">By category</div>
          <ul className="flex flex-col gap-1">
            {categoryBreakdown.map(({ category, stats }) => (
              <li key={category.id}>
                <button
                  onClick={onViewCategories}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-700"
                >
                  <CategoryIcon name={category.icon} className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{category.name}</span>
                  <span className="text-xs text-slate-500">{stats.habitCount} habit{stats.habitCount === 1 ? "" : "s"}</span>
                  <span className="w-10 text-right font-medium">{stats.completionPercentage}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completion history</div>
          <select
            value={selectedHabit?.id ?? ""}
            onChange={(event) => setSelectedHabitId(event.target.value)}
            className="rounded-md bg-slate-900 px-2 py-1 text-sm"
          >
            {sortedHabits.map((habit) => (
              <option key={habit.id} value={habit.id}>
                {habit.name}
              </option>
            ))}
          </select>
        </div>
        {selectedHabit && (
          <CalendarHeatmap days={habitCalendar(selectedHabit, completionLog, addDays(today, -HEATMAP_WINDOW_DAYS), today)} />
        )}
      </div>
    </div>
  );
}
