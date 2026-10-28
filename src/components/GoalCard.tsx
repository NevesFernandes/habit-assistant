import type { GoalProgress } from "../lib/goals";
import { describeGoalTarget, describeProgress } from "../lib/goals";
import { todayISO } from "../lib/recurrence";

// §71: one goal or challenge, as the item page, the Goals tab and the stats tab show it. The
// numbers and words come from src/lib/goals.ts, the same ones chat and Claude give.
export default function GoalCard({ progress, showName = false }: { progress: GoalProgress; showName?: boolean }) {
  const today = todayISO();
  const { goal, status } = progress;
  // A challenge fills by due days done out of all its due days; a total by its target.
  const whole = goal.kind === "challenge" ? progress.done + (progress.missed ?? 0) + (progress.remainingDue ?? 0) : progress.target;
  const fraction = whole > 0 ? Math.min(1, progress.done / whole) : 0;
  const barColour = status === "achieved" ? "bg-emerald-500" : status === "missed" || progress.pace?.reachable === false || progress.missed ? "bg-amber-500" : "bg-violet-500";
  const label = { upcoming: "Starts soon", active: goal.kind === "challenge" ? "Challenge" : "Goal", achieved: "Achieved", missed: "Not reached" }[status];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">
          {showName && (
            <span className="font-medium">
              {progress.itemName}
              {progress.categoryId && <span className="font-normal text-slate-400"> (category)</span>}:{" "}
            </span>
          )}
          {describeGoalTarget(goal, progress.unit, today)}
        </span>
        <span className={`shrink-0 text-xs ${status === "achieved" ? "text-emerald-400" : status === "missed" ? "text-amber-400" : "text-slate-400"}`}>{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <div className={`h-full rounded-full ${barColour}`} style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <div className="text-xs text-slate-400">{describeProgress(progress, today)}</div>
    </div>
  );
}
