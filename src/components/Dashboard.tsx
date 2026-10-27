import { useState } from "react";
import type { Category, CompletionLogEntry, Habit, RecurringTask, SingleTask } from "../types/models";
import { aggregateRecurringTaskStats, asTrackable, computeSingleTaskStats } from "../lib/taskStats";
import { rolloverPersistentTasks } from "../lib/dataStore";
import { countingSince } from "../lib/statsReset";
import { formatDate } from "../lib/confirmations";
import { compareForDay } from "../lib/dayParts";
import { aggregateCategoryStats } from "../lib/habitStats";
import { todayISO } from "../lib/recurrence";
import { useWeekStart } from "../lib/weekStartContext";
import CategoryIcon from "./CategoryIcon";
import StatTile from "./StatTile";
import Meter from "./Meter";
import HabitHeatmap from "./HabitHeatmap";

// §17 in Roadmap.md: an overview of the numbers HabitsView/CategoriesView already compute
// per-item, plus the one real chart (a calendar heatmap). §63 adds recurring and one-off
// tasks as sections of their own, so chores never dilute the habit numbers.
interface DashboardProps {
  habits: Habit[];
  recurringTasks: RecurringTask[];
  singleTasks: SingleTask[];
  categories: Category[];
  completionLog: CompletionLogEntry[];
  onViewCategories: () => void;
}

export default function Dashboard({ habits, recurringTasks, singleTasks, categories, completionLog, onViewCategories }: DashboardProps) {
  const today = todayISO();
  // The heatmap picks from habits and recurring tasks; a recurring task is drawn as a yes/no habit.
  const tracked = [...habits.slice().sort(compareForDay), ...recurringTasks.slice().sort(compareForDay).map(asTrackable)];
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(tracked[0]?.id ?? null);
  const selectedHabit = tracked.find((h) => h.id === selectedHabitId) ?? tracked[0];
  const weekStartsOn = useWeekStart();

  if (habits.length === 0 && recurringTasks.length === 0 && singleTasks.length === 0) {
    return <p className="text-sm text-slate-500">Nothing yet — stats will show up here once you have habits or tasks.</p>;
  }

  const taskStats = aggregateRecurringTaskStats(recurringTasks, completionLog, today, weekStartsOn);
  // As the Today tab shows them: unfinished one-off tasks already carried over to today.
  const oneOff = computeSingleTaskStats(
    rolloverPersistentTasks({ categories, habits, recurringTasks, singleTasks, completionLog }, today).singleTasks,
    today,
    weekStartsOn,
  );

  const overall = aggregateCategoryStats(habits, completionLog, today, weekStartsOn);
  // §64: each section counts from its earliest start or reset.
  const since = (items: Parameters<typeof countingSince>[0]) => {
    const date = countingSince(items);
    return date ? <div className="text-xs text-slate-500">Counting since {formatDate(date, today)}</div> : null;
  };
  const categoryBreakdown = categories
    .map((category) => ({
      category,
      stats: aggregateCategoryStats(
        habits.filter((h) => h.categoryId === category.id),
        completionLog,
        today,
        weekStartsOn,
      ),
    }))
    .filter((row) => row.stats.habitCount > 0)
    .sort((a, b) => b.stats.habitCount - a.stats.habitCount);

  return (
    <div className="flex flex-col gap-4">
      {habits.length > 0 && since(habits)}
      {habits.length > 0 && (
        <div className="flex flex-col items-center gap-4 rounded-md bg-slate-800 px-4 py-4 sm:flex-row sm:justify-between">
          <Meter percentage={overall.completionPercentage} label={`${overall.habitCount} habit${overall.habitCount === 1 ? "" : "s"}`} />
          <div className="flex gap-4">
            <StatTile value={overall.completionsThisWeek} label="This week" />
            <StatTile value={overall.completionsThisMonth} label="This month" />
            <StatTile value={overall.completionsThisYear} label="This year" />
            <StatTile value={overall.completionsAllTime} label="All-time" />
          </div>
        </div>
      )}

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

      {recurringTasks.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recurring tasks</div>
          {since(recurringTasks)}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Meter percentage={taskStats.completionPercentage} label={`${taskStats.habitCount} task${taskStats.habitCount === 1 ? "" : "s"}`} />
            <div className="flex gap-4">
              <StatTile value={taskStats.completionsThisWeek} label="This week" />
              <StatTile value={taskStats.completionsThisMonth} label="This month" />
              <StatTile value={taskStats.completionsThisYear} label="This year" />
              <StatTile value={taskStats.completionsAllTime} label="All-time" />
            </div>
          </div>
        </div>
      )}

      {singleTasks.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">One-off tasks done</div>
          {since(singleTasks)}
          <div className="flex gap-4">
            <StatTile value={oneOff.doneThisWeek} label="This week" />
            <StatTile value={oneOff.doneThisMonth} label="This month" />
            <StatTile value={oneOff.doneThisYear} label="This year" />
            <StatTile value={oneOff.doneAllTime} label="All-time" />
          </div>
          <div className="text-sm text-slate-300">
            {oneOff.open} open today
            {oneOff.carriedOver > 0 &&
              ` · ${oneOff.carriedOver} carried over, ${oneOff.averageDaysCarried} day${oneOff.averageDaysCarried === 1 ? "" : "s"} on average`}
            {oneOff.upcoming > 0 && ` · ${oneOff.upcoming} coming up`}
          </div>
        </div>
      )}

      {tracked.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-slate-800 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completion history</div>
            <select
              value={selectedHabit?.id ?? ""}
              onChange={(event) => setSelectedHabitId(event.target.value)}
              className="rounded-md bg-slate-900 px-2 py-1 text-sm"
            >
              {tracked.map((habit) => (
                <option key={habit.id} value={habit.id}>
                  {habit.name}
                </option>
              ))}
            </select>
          </div>
          {selectedHabit && <HabitHeatmap habit={selectedHabit} completionLog={completionLog} todayISO={today} />}
        </div>
      )}
    </div>
  );
}
