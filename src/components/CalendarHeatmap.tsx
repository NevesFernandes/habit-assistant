import { useLayoutEffect, useRef } from "react";
import type { HabitCalendarDay } from "../lib/habitStats";
import { dayOfWeek } from "../lib/recurrence";
import { formatDate } from "../lib/confirmations";

// GitHub-style calendar heatmap — the one real chart in §17's dashboard (see Roadmap.md;
// hand-rolled rather than a library, per the user-confirmed 2026-09-02 decision). Takes
// pre-computed day data rather than a Habit/completionLog directly, so this stays a dumb
// rendering component with no scheduling/date-walking logic of its own — see
// habitStats.ts's habitCalendar and heatmapWindow for where that lives.
interface CalendarHeatmapProps {
  days: HabitCalendarDay[]; // ascending by date, one entry per calendar day
  todayISO: string;
}

const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
// Rows follow dayOfWeek's 0=Sunday convention (startOfWeek in recurrence.ts).
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// §36: "not due" sits one step above the slate-800 card so it's visible without competing,
// and "missed" is a red that reads as red on that card, not as another near-black.
const NOT_DUE = "fill-slate-700";
const MISSED = "fill-rose-800";
const PARTIAL = ["fill-violet-900", "fill-violet-700", "fill-violet-500"];
const DONE = "fill-violet-400";
// Today, nothing logged yet: still open, so not drawn as a miss.
const OPEN_TODAY = "fill-transparent stroke-violet-400";

function cellClass(day: HabitCalendarDay, todayISO: string): string {
  if (!day.scheduled) return NOT_DUE;
  if (day.ratio <= 0) return day.date === todayISO ? OPEN_TODAY : MISSED;
  if (day.ratio < 0.34) return PARTIAL[0];
  if (day.ratio < 0.67) return PARTIAL[1];
  if (day.ratio < 1) return PARTIAL[2];
  return DONE;
}

function cellTitle(day: HabitCalendarDay, todayISO: string): string {
  const date = formatDate(day.date, todayISO);
  if (!day.scheduled) return `${date} — not due`;
  if (day.ratio <= 0) return `${date} — ${day.date === todayISO ? "not done yet" : "missed"}`;
  return `${date} — ${Math.round(day.ratio * 100)}%`;
}

export default function CalendarHeatmap({ days, todayISO }: CalendarHeatmapProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstDate = days[0]?.date;

  // Open on the most recent weeks (the right edge), and again whenever another habit's
  // window is shown.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [firstDate, days.length]);

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

  const width = weeks.length * PITCH;
  const height = 7 * PITCH;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-end gap-1">
        <div ref={scrollRef} className="min-w-0 overflow-x-auto">
          <svg width={width} height={height} className="block">
            {weeks.map((week, weekIdx) =>
              (week ?? []).map(
                (day, row) =>
                  day && (
                    <rect
                      key={day.date}
                      x={weekIdx * PITCH + 0.5}
                      y={row * PITCH + 0.5}
                      width={CELL - 1}
                      height={CELL - 1}
                      rx={2}
                      className={cellClass(day, todayISO)}
                    >
                      <title>{cellTitle(day, todayISO)}</title>
                    </rect>
                  ),
              ),
            )}
          </svg>
        </div>
        {/* Outside the scroll area, so it stays put while the grid scrolls. */}
        <svg width={10} height={height} className="block shrink-0" aria-hidden>
          {WEEKDAY_LABELS.map((label, row) => (
            <text key={row} x={1} y={row * PITCH + CELL - 2} fontSize={9} className="fill-slate-500">
              {label}
            </text>
          ))}
        </svg>
      </div>
      <Legend />
    </div>
  );
}

function Swatch({ className }: { className: string }) {
  return (
    <svg width={CELL} height={CELL} className="shrink-0" aria-hidden>
      <rect x={0.5} y={0.5} width={CELL - 1} height={CELL - 1} rx={2} className={className} />
    </svg>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <li className="flex items-center gap-1">
        <Swatch className={NOT_DUE} /> Not due
      </li>
      <li className="flex items-center gap-1">
        <Swatch className={MISSED} /> Missed
      </li>
      <li className="flex items-center gap-1">
        {PARTIAL.map((className) => (
          <Swatch key={className} className={className} />
        ))}{" "}
        Partial
      </li>
      <li className="flex items-center gap-1">
        <Swatch className={DONE} /> Done
      </li>
      <li className="flex items-center gap-1">
        <Swatch className={OPEN_TODAY} /> Today
      </li>
    </ul>
  );
}
