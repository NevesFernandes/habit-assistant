import { useEffect, useRef } from "react";
import { addDays } from "../lib/recurrence";

interface DayStripProps {
  selectedDate: string;
  onSelect: (dateISO: string) => void;
}

const DAYS_BEFORE = 7;
const DAYS_AFTER = 14;
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DayStrip({ selectedDate, onSelect }: DayStripProps) {
  const today = todayISO();
  const dates = Array.from({ length: DAYS_BEFORE + DAYS_AFTER + 1 }, (_, i) =>
    addDays(selectedDate, i - DAYS_BEFORE),
  );
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedDate]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onSelect(addDays(selectedDate, -1))}
        className="shrink-0 rounded-md bg-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-700"
        aria-label="Previous day"
      >
        ‹
      </button>

      <div
        className="flex flex-1 gap-2 overflow-x-auto px-1 py-1"
        style={{ scrollSnapType: "x mandatory", scrollBehavior: "smooth" }}
      >
        {dates.map((dateISO) => {
          const isSelected = dateISO === selectedDate;
          const date = new Date(`${dateISO}T00:00:00Z`);
          return (
            <button
              key={dateISO}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelect(dateISO)}
              style={{ scrollSnapAlign: "center" }}
              className={`flex shrink-0 flex-col items-center rounded-md px-3 py-1.5 text-sm ${
                isSelected ? "bg-violet-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              <span className="text-xs">{WEEKDAY_LABELS[date.getUTCDay()]}</span>
              <span className="font-medium">{date.getUTCDate()}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => onSelect(addDays(selectedDate, 1))}
        className="shrink-0 rounded-md bg-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-700"
        aria-label="Next day"
      >
        ›
      </button>

      {selectedDate !== today && (
        <button
          onClick={() => onSelect(today)}
          className="shrink-0 rounded-md bg-slate-800 px-2 py-1.5 text-xs text-violet-300 hover:bg-slate-700"
        >
          Today
        </button>
      )}
    </div>
  );
}
