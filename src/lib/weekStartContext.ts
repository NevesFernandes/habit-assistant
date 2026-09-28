// §43: the user's first day of the week (AppData.weekStartsOn), provided once by App.tsx
// so every view that buckets days into weeks reads the same setting without it being
// threaded through each component's props.
import { createContext, useContext } from "react";
import type { WeekStart } from "../types/models";

export const WeekStartContext = createContext<WeekStart>(0);

export function useWeekStart(): WeekStart {
  return useContext(WeekStartContext);
}
