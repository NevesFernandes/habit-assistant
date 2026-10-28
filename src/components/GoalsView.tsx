import type { GoalProgress } from "../lib/goals";
import GoalCard from "./GoalCard";

// §71: the View tab's Goals sub tab. Goals are set, changed and removed by chat; this lists
// them: running ones in the app's item order, then finished ones, latest first.
export default function GoalsView({ active, finished }: { active: GoalProgress[]; finished: GoalProgress[] }) {
  if (active.length === 0 && finished.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No goals yet. Set one in the chat, for example "read 20 books by December" or "start a 30-day no-sugar challenge".
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {active.map((progress) => (
            <li key={progress.goal.id} className="rounded-md bg-slate-800 px-3 py-2">
              <GoalCard progress={progress} showName />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No goal running right now.</p>
      )}
      {finished.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Finished</div>
          <ul className="flex flex-col gap-2">
            {finished.map((progress) => (
              <li key={progress.goal.id} className="rounded-md bg-slate-800/60 px-3 py-2">
                <GoalCard progress={progress} showName />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
