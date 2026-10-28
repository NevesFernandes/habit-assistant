import { useState, type ReactNode } from "react";
import type { Category, CompletionLogEntry, Habit } from "../types/models";
import { currentPause, describeRecurrence, isArchived, todayISO, upcomingPause } from "../lib/recurrence";
import { checklistItemsForEntry, checklistProgress } from "../lib/habitStats";
import { formatDurationMinutes } from "../lib/duration";
import CategoryIcon from "./CategoryIcon";
import DayPartPicker, { ImportantMark, type PlacementPatch } from "./DayPartPicker";
import { compareForDay, isImportant } from "../lib/dayParts";
import Checklist from "./Checklist";
import ArchiveRow from "./ArchiveRow";
import ItemStats from "./ItemStats";
import type { GoalProgress } from "../lib/goals";

interface HabitsViewProps {
  /** §71: running goals, then finished ones; an item page shows the first that is its own. */
  goals: GoalProgress[];
  habits: Habit[];
  categories: Category[];
  onPlace: (id: string, patch: PlacementPatch) => void;
  onUnarchive: (id: string) => void;
  completionLog: CompletionLogEntry[];
  onToggleChecklistItem: (habitId: string, itemId: string) => void;
}

const COMPLETION_TYPE_LABELS: Record<Habit["completionType"], string> = {
  yesno: "Yes/No",
  value: "Numeric value",
  timer: "Timer",
  checklist: "Checklist",
};

export default function HabitsView({ goals, habits, categories, onPlace, onUnarchive, completionLog, onToggleChecklistItem }: HabitsViewProps) {
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);

  const selectedHabit = selectedHabitId ? habits.find((habit) => habit.id === selectedHabitId) : undefined;

  if (selectedHabit) {
    return (
      <HabitDetail
        goal={goals.find((g) => g.goal.itemId === selectedHabit.id)}
        habit={selectedHabit}
        categories={categories}
        onPlace={onPlace}
        onUnarchive={onUnarchive}
        completionLog={completionLog}
        onToggleChecklistItem={onToggleChecklistItem}
        onBack={() => setSelectedHabitId(null)}
      />
    );
  }

  const sortedHabits = habits
    .slice()
    .sort(compareForDay);

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
                  {isImportant(habit) && <ImportantMark />}
                  {isArchived(habit) && <span className="ml-2 text-xs text-amber-400">Archived</span>}
                  {!isArchived(habit) && currentPause(habit, todayISO()) && (
                    <span className="ml-2 text-xs text-sky-400">Paused</span>
                  )}
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
  goal,
  categories,
  onPlace,
  onUnarchive,
  completionLog,
  onToggleChecklistItem,
  onBack,
}: {
  habit: Habit;
  goal?: GoalProgress;
  categories: Category[];
  onPlace: (id: string, patch: PlacementPatch) => void;
  onUnarchive: (id: string) => void;
  completionLog: CompletionLogEntry[];
  onToggleChecklistItem: (habitId: string, itemId: string) => void;
  onBack: () => void;
}) {
  const category = categories.find((c) => c.id === habit.categoryId);
  const pause = currentPause(habit, todayISO()) ?? upcomingPause(habit, todayISO());
  const todayEntry = completionLog.find((e) => e.itemId === habit.id && e.date === todayISO());
  const todayChecklistItems = checklistItemsForEntry(habit, todayEntry, todayISO());
  const todayEntryProgress = checklistProgress(habit, todayEntry, todayISO());

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

        <DetailRow label="Part of day">
          <DayPartPicker item={habit} onChange={(patch) => onPlace(habit.id, patch)} />
        </DetailRow>

        <DetailRow label="Start date">
          <span>{habit.startDate}</span>
        </DetailRow>

        <ArchiveRow item={habit} onUnarchive={onUnarchive} />

        {/* §28: a pause is distinct from archiving — it ends by itself, or when asked. */}
        {pause && (
          <DetailRow label={pause.from > todayISO() ? "Pausing on" : "Paused since"}>
            <span>
              {pause.from}
              {pause.resumeOn ? ` — back on ${pause.resumeOn}` : " — until you resume it"}
            </span>
          </DetailRow>
        )}

        <DetailRow label="Recurrence">
          <span>{describeRecurrence(habit.recurrence)}</span>
        </DetailRow>

        <DetailRow label="Completion type">
          <span>{COMPLETION_TYPE_LABELS[habit.completionType]}</span>
        </DetailRow>

        {(habit.completionType === "value" || habit.completionType === "timer") && habit.target !== undefined && (
          <DetailRow label="Target">
            <span>
              {habit.completionType === "timer"
                ? formatDurationMinutes(habit.target)
                : `${habit.target}${habit.unit ? ` ${habit.unit}` : ""}`}
            </span>
          </DetailRow>
        )}

        {habit.completionType === "checklist" && (
          <DetailRow label={`Today's checklist (${todayEntryProgress.checked}/${todayEntryProgress.total})`}>
            <Checklist
              items={todayChecklistItems}
              onToggle={(itemId) => onToggleChecklistItem(habit.id, itemId)}
            />
          </DetailRow>
        )}

        <ItemStats item={habit} completionLog={completionLog} goal={goal} />
      </div>
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
