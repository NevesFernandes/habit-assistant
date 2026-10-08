import { Star } from "lucide-react";
import type { BaseItem, DayPart } from "../types/models";
import { DAY_PARTS, isImportant } from "../lib/dayParts";

/** §54: what the picker changes — the same fields chat sets through the update tools. */
export interface PlacementPatch {
  newDayPart?: DayPart;
  newImportant?: boolean;
}

type Placed = Pick<BaseItem, "dayPart" | "important" | "priority">;

/** The marker next to an important item's name. */
export function ImportantMark() {
  return <Star className="ml-1.5 inline h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Important" />;
}

/**
 * §54: where an item sits in the day, changeable without a chat message — placing the
 * items that existed before parts of the day would otherwise take one message each.
 */
export default function DayPartPicker({ item, onChange }: { item: Placed; onChange: (patch: PlacementPatch) => void }) {
  const important = isImportant(item);
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-wrap gap-1.5">
        {DAY_PARTS.map((part) => (
          <button
            key={part.id}
            onClick={() => part.id !== item.dayPart && onChange({ newDayPart: part.id })}
            className={`rounded-md px-2 py-1 text-xs ${
              part.id === item.dayPart ? "bg-violet-500 font-medium text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {part.label}
          </button>
        ))}
      </div>
      {item.dayPart === undefined && <p className="text-xs text-slate-500">Not placed yet: pick where it belongs in your day.</p>}
      <button
        onClick={() => onChange({ newImportant: !important })}
        aria-pressed={important}
        className={`flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
          important ? "bg-amber-500/20 text-amber-300" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
        }`}
      >
        <Star className={`h-3.5 w-3.5 ${important ? "fill-amber-400 text-amber-400" : ""}`} aria-hidden />
        {important ? "Important: shown first in its part of the day" : "Mark as important"}
      </button>
    </div>
  );
}
