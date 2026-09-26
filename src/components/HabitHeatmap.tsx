import type { CompletionLogEntry, Habit } from "../types/models";
import { habitCalendar, heatmapWindow } from "../lib/habitStats";
import { formatDate } from "../lib/confirmations";
import CalendarHeatmap from "./CalendarHeatmap";

// §37: one habit's heatmap, shared by the stats tab (Dashboard) and the habit's own page
// (HabitsView) so the two never drift apart. Picks the date range (§36's heatmapWindow)
// and says when a not-yet-started habit begins, instead of drawing an empty grid.
export default function HabitHeatmap({
  habit,
  completionLog,
  todayISO,
}: {
  habit: Habit;
  completionLog: CompletionLogEntry[];
  todayISO: string;
}) {
  const range = heatmapWindow(habit, todayISO);
  if (!range) {
    return <p className="text-sm text-slate-500">Starts {formatDate(habit.startDate, todayISO)} — history shows up from then.</p>;
  }
  return <CalendarHeatmap days={habitCalendar(habit, completionLog, range.from, range.to)} todayISO={todayISO} />;
}
