import type { HabitCalendarDay } from "../lib/habitStats";
import { dayOfWeek } from "../lib/recurrence";

// GitHub-style calendar heatmap — the one real chart in §17's dashboard (see Roadmap.md;
// hand-rolled rather than a library, per the user-confirmed 2026-09-02 decision). Takes
// pre-computed day data rather than a Habit/completionLog directly, so this stays a dumb
// rendering component with no scheduling/date-walking logic of its own — see
// habitStats.ts's habitCalendar for where that lives.
interface CalendarHeatmapProps {
  days: HabitCalendarDay[]; // ascending by date, one entry per calendar day
}

const CELL = 11;
const GAP = 3;

function cellColorClass(day: HabitCalendarDay): string {
  if (!day.scheduled) return "fill-slate-800";
  if (day.ratio <= 0) return "fill-rose-950";
  if (day.ratio < 0.34) return "fill-violet-900";
  if (day.ratio < 0.67) return "fill-violet-700";
  if (day.ratio < 1) return "fill-violet-500";
  return "fill-violet-400";
}

export default function CalendarHeatmap({ days }: CalendarHeatmapProps) {
  if (days.length === 0) return null;

  // Bucket the contiguous day list into week columns (Sunday-start, matching this app's
  // 0=Sunday..6=Saturday convention everywhere else — see recurrence.ts). The first column
  // may have empty rows above its first day if the window doesn't start on a Sunday.
  const weeks: (HabitCalendarDay | undefined)[][] = [];
  let weekIndex = -1;
  days.forEach((day, i) => {
    const row = dayOfWeek(day.date);
    if (i === 0 || row === 0) weekIndex += 1;
    if (!weeks[weekIndex]) weeks[weekIndex] = [];
    weeks[weekIndex][row] = day;
  });

  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="text-slate-500">
        {weeks.map((week, weekIdx) =>
          (week ?? []).map(
            (day, row) =>
              day && (
                <rect
                  key={day.date}
                  x={weekIdx * (CELL + GAP)}
                  y={row * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  className={cellColorClass(day)}
                >
                  <title>
                    {day.date}
                    {day.scheduled ? ` — ${Math.round(day.ratio * 100)}%` : " — not scheduled"}
                  </title>
                </rect>
              ),
          ),
        )}
      </svg>
    </div>
  );
}
