import type { ReactNode } from "react";
import type { CompletionLogEntry, Habit } from "../types/models";
import { computeHabitStats, statsCountFrom } from "../lib/habitStats";
import { formatDate } from "../lib/confirmations";
import { todayISO } from "../lib/recurrence";
import { useWeekStart } from "../lib/weekStartContext";
import StatTile from "./StatTile";
import HabitHeatmap from "./HabitHeatmap";
import GoalCard from "./GoalCard";
import type { GoalProgress } from "../lib/goals";

// The "Statistics" block of an item's own page: a habit's, and since §63 a recurring task's
// too (passed in as asTrackable(task)), so the two pages can't drift apart.
// §71: with the item's goal (the running one, else the last finished one) above the stats.
export default function ItemStats({ item, completionLog, goal }: { item: Habit; completionLog: CompletionLogEntry[]; goal?: GoalProgress }) {
  const weekStartsOn = useWeekStart();
  const stats = computeHabitStats(item, completionLog, todayISO(), weekStartsOn);
  const streakUnit = item.recurrence.type === "timesPerPeriod" ? "time" : "day";
  const formatStreak = (n: number) => `${n} ${streakUnit}${n === 1 ? "" : "s"}`;
  return (
    <>
      {goal && (
        <>
          <div className="mt-1 border-t border-slate-700 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {goal.goal.kind === "challenge" ? "Challenge" : "Goal"}
          </div>
          <GoalCard progress={goal} />
        </>
      )}
      <div className="mt-1 border-t border-slate-700 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Statistics
      </div>
      {/* §64: from the start date, or from the last reset (the history before it stays). */}
      <div className="text-xs text-slate-500">Counting since {formatDate(statsCountFrom(item), todayISO())}</div>

      <Row label="Current streak">
        <span>{formatStreak(stats.currentStreak)}</span>
      </Row>

      <Row label="Best streak">
        <span>{formatStreak(stats.bestStreak)}</span>
      </Row>

      <Row label="Completion rate">
        <span>{stats.completionPercentage}%</span>
      </Row>

      <Row label="Completions">
        <div className="flex gap-4">
          <StatTile value={stats.completionsThisWeek} label="This week" />
          <StatTile value={stats.completionsThisMonth} label="This month" />
          <StatTile value={stats.completionsThisYear} label="This year" />
          <StatTile value={stats.completionsAllTime} label="All-time" />
        </div>
      </Row>

      <Row label="Completion history">
        <div className="pt-1">
          <HabitHeatmap habit={item} completionLog={completionLog} todayISO={todayISO()} />
        </div>
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div>{children}</div>
    </div>
  );
}
