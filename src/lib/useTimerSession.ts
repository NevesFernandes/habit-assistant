import { useCallback, useEffect, useState } from "react";
import {
  computeElapsedMs,
  loadTimerState,
  saveTimerState,
  type RunningTimerState,
  type StoredTimerState,
  type TimerMode,
} from "./timerStore";

// Runs once, at this hook's initial-state callback — i.e. an actual page load, since the
// hook itself is called once at App.tsx's root, above where tabs (and any component that
// would otherwise hold this state) unmount/remount on tab switch. A live in-app tab switch
// never re-runs this; only a genuine reload does.
function initState(): StoredTimerState | null {
  const stored = loadTimerState();
  if (!stored) return null;
  // Decided explicitly (§19 in Roadmap.md): a reload always resumes into a paused state,
  // never fast-forwarding elapsed time based on how long the app was actually closed.
  if (stored.kind === "session" && stored.status === "running") {
    const paused: RunningTimerState = { ...stored, status: "paused", startedAtEpochMs: undefined };
    saveTimerState(paused);
    return paused;
  }
  return stored;
}

export interface UseTimerSession {
  state: StoredTimerState | null;
  elapsedMs: number;
  start: (mode: TimerMode, options: { habitId?: string; targetMs?: number }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setPendingHabit: (habitId: string | undefined) => void;
  discardPending: () => void;
  clearAfterSave: () => void;
}

export function useTimerSession(): UseTimerSession {
  const [state, setState] = useState<StoredTimerState | null>(initState);
  const [now, setNow] = useState(() => Date.now());

  const isRunning = state?.kind === "session" && state.status === "running";

  const start = useCallback((mode: TimerMode, options: { habitId?: string; targetMs?: number }) => {
    const next: RunningTimerState = {
      kind: "session",
      mode,
      status: "running",
      habitId: options.habitId,
      targetMs: options.targetMs,
      elapsedMs: 0,
      startedAtEpochMs: Date.now(),
    };
    saveTimerState(next);
    setState(next);
  }, []);

  const pause = useCallback(() => {
    setState((current) => {
      if (current?.kind !== "session" || current.status !== "running") return current;
      const paused: RunningTimerState = {
        ...current,
        status: "paused",
        elapsedMs: computeElapsedMs(current, Date.now()),
        startedAtEpochMs: undefined,
      };
      saveTimerState(paused);
      return paused;
    });
  }, []);

  const resume = useCallback(() => {
    setState((current) => {
      if (current?.kind !== "session" || current.status !== "paused") return current;
      const resumed: RunningTimerState = { ...current, status: "running", startedAtEpochMs: Date.now() };
      saveTimerState(resumed);
      return resumed;
    });
  }, []);

  const stop = useCallback(() => {
    setState((current) => {
      if (current?.kind !== "session") return current;
      const finalElapsedMs = computeElapsedMs(current, Date.now());
      const pending: StoredTimerState = { kind: "pending", elapsedMs: finalElapsedMs, habitId: current.habitId };
      saveTimerState(pending);
      return pending;
    });
  }, []);

  const setPendingHabit = useCallback((habitId: string | undefined) => {
    setState((current) => (current?.kind === "pending" ? { ...current, habitId } : current));
  }, []);

  const clearPending = useCallback(() => {
    saveTimerState(null);
    setState(null);
  }, []);

  // Live display tick — correctness comes from the wall-clock diff in computeElapsedMs, not
  // this interval's exact timing, so 250ms is just "often enough to look live."
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [isRunning]);

  // Periodic persistence while running, so an actual process kill loses at most ~1s of
  // fidelity rather than everything since the last start/pause/resume.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setState((current) => {
        if (current?.kind !== "session" || current.status !== "running" || current.startedAtEpochMs === undefined) {
          return current;
        }
        const persisted: RunningTimerState = {
          ...current,
          elapsedMs: computeElapsedMs(current, Date.now()),
          startedAtEpochMs: Date.now(),
        };
        saveTimerState(persisted);
        return persisted;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const elapsedMs =
    state?.kind === "session" ? computeElapsedMs(state, now) : state?.kind === "pending" ? state.elapsedMs : 0;

  // A countdown reaching its target just stops — silent, no sound/vibration/notification
  // (decided explicitly, separate from "no push notifications in v1" generally).
  useEffect(() => {
    if (
      state?.kind === "session" &&
      state.mode === "countdown" &&
      state.status === "running" &&
      state.targetMs !== undefined &&
      elapsedMs >= state.targetMs
    ) {
      stop();
    }
  }, [state, elapsedMs, stop]);

  return {
    state,
    elapsedMs,
    start,
    pause,
    resume,
    stop,
    setPendingHabit,
    discardPending: clearPending,
    clearAfterSave: clearPending,
  };
}
