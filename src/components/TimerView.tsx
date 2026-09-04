import { useState } from "react";
import type { Habit } from "../types/models";
import type { TimerMode } from "../lib/timerStore";
import type { UseTimerSession } from "../lib/useTimerSession";

interface TimerViewProps {
  habits: Habit[];
  timer: UseTimerSession;
  onSave: (habitId: string, elapsedMs: number) => Promise<boolean>;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// §19 in Roadmap.md: only Timer-type habits are anything this feature can save into.
function timerHabits(habits: Habit[]): Habit[] {
  return habits
    .filter((habit) => habit.completionType === "timer")
    .slice()
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export default function TimerView({ habits, timer, onSave }: TimerViewProps) {
  const eligibleHabits = timerHabits(habits);
  const [draftMode, setDraftMode] = useState<TimerMode>("stopwatch");
  const [draftHabitId, setDraftHabitId] = useState<string>("");
  const [draftHours, setDraftHours] = useState(0);
  const [draftMinutes, setDraftMinutes] = useState(0);
  const [draftSeconds, setDraftSeconds] = useState(0);
  const [saving, setSaving] = useState(false);

  function selectDraftHabit(habitId: string) {
    setDraftHabitId(habitId);
    if (draftMode !== "countdown") return;
    const habit = eligibleHabits.find((h) => h.id === habitId);
    if (habit?.target !== undefined) {
      setDraftHours(Math.floor(habit.target / 60));
      setDraftMinutes(Math.floor(habit.target % 60));
      setDraftSeconds(0);
    }
  }

  function handleStart() {
    const targetMs =
      draftMode === "countdown" ? (draftHours * 3600 + draftMinutes * 60 + draftSeconds) * 1000 : undefined;
    if (draftMode === "countdown" && (!targetMs || targetMs <= 0)) return;
    timer.start(draftMode, { habitId: draftHabitId || undefined, targetMs });
  }

  async function handleSave(habitId: string) {
    if (!habitId) return;
    setSaving(true);
    const ok = await onSave(habitId, timer.elapsedMs);
    setSaving(false);
    if (ok) timer.clearAfterSave();
  }

  // --- Pending (stopped, not yet saved) — the screenshot's "Last record" card ---
  if (timer.state?.kind === "pending") {
    const pending = timer.state;
    return (
      <div className="flex flex-col gap-3 rounded-md bg-slate-800 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last record</div>
        <div className="text-3xl font-medium tabular-nums">{formatDuration(pending.elapsedMs)}</div>
        <select
          value={pending.habitId ?? ""}
          onChange={(event) => timer.setPendingHabit(event.target.value || undefined)}
          className="rounded-md bg-slate-900 px-2 py-1.5 text-sm"
        >
          <option value="">No activity selected</option>
          {eligibleHabits.map((habit) => (
            <option key={habit.id} value={habit.id}>
              {habit.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            onClick={() => pending.habitId && handleSave(pending.habitId)}
            disabled={!pending.habitId || saving}
            className="flex-1 rounded-md bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={timer.discardPending}
            className="rounded-md bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
          >
            Discard
          </button>
        </div>
      </div>
    );
  }

  // --- Running or paused ---
  if (timer.state?.kind === "session") {
    const session = timer.state;
    const habit = eligibleHabits.find((h) => h.id === session.habitId);
    const display =
      session.mode === "countdown" && session.targetMs !== undefined
        ? formatDuration(Math.max(0, session.targetMs - timer.elapsedMs))
        : formatDuration(timer.elapsedMs);

    return (
      <div className="flex flex-col items-center gap-4 rounded-md bg-slate-800 px-4 py-6">
        <div className="text-xs uppercase tracking-wide text-slate-400">
          {session.mode === "countdown" ? "Countdown" : "Stopwatch"}
          {habit && ` — ${habit.name}`}
        </div>
        <div className="text-5xl font-medium tabular-nums">{display}</div>
        <div className="flex gap-2">
          {session.status === "running" ? (
            <button onClick={timer.pause} className="rounded-md bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">
              Pause
            </button>
          ) : (
            <button onClick={timer.resume} className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400">
              Resume
            </button>
          )}
          <button onClick={timer.stop} className="rounded-md bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">
            Stop
          </button>
        </div>
      </div>
    );
  }

  // --- Idle: configure and start ---
  return (
    <div className="flex flex-col gap-4 rounded-md bg-slate-800 px-4 py-4">
      <div className="flex gap-2">
        {(["stopwatch", "countdown"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setDraftMode(mode)}
            className={`flex-1 rounded-md px-3 py-2 text-sm capitalize ${
              draftMode === mode ? "bg-violet-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {draftMode === "countdown" && (
        <div className="flex items-end justify-center gap-2">
          {[
            { value: draftHours, set: setDraftHours, label: "hours" },
            { value: draftMinutes, set: setDraftMinutes, label: "minutes" },
            { value: draftSeconds, set: setDraftSeconds, label: "seconds" },
          ].map(({ value, set, label }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <input
                type="number"
                min={0}
                max={label === "hours" ? 23 : 59}
                value={value}
                onChange={(event) => set(Math.max(0, Number(event.target.value)))}
                className="w-16 rounded-md bg-slate-900 px-2 py-1.5 text-center text-lg tabular-nums"
              />
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      <select
        value={draftHabitId}
        onChange={(event) => selectDraftHabit(event.target.value)}
        className="rounded-md bg-slate-900 px-2 py-1.5 text-sm"
      >
        <option value="">No activity selected</option>
        {eligibleHabits.map((habit) => (
          <option key={habit.id} value={habit.id}>
            {habit.name}
          </option>
        ))}
      </select>

      <button
        onClick={handleStart}
        disabled={draftMode === "countdown" && draftHours === 0 && draftMinutes === 0 && draftSeconds === 0}
        className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
      >
        Start
      </button>

      {eligibleHabits.length === 0 && (
        <p className="text-xs text-slate-500">
          No Timer-type habits yet — you can still run a timer, but there'll be nothing to save it to.
        </p>
      )}
    </div>
  );
}
