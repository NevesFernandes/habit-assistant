import { useState } from "react";
import type { Habit, RecurringTask } from "../types/models";
import { archiveGap, isArchived, todayISO } from "../lib/recurrence";
import { describeUnarchive } from "../lib/confirmations";

/**
 * §77: an item page's end date. On an archived item it carries "Bring back", which saves
 * straight away (archiving again undoes it) and leaves the confirmation in the row's place.
 */
export default function ArchiveRow({ item, onUnarchive }: { item: Habit | RecurringTask; onUnarchive: (id: string) => void }) {
  const [broughtBack, setBroughtBack] = useState<string | null>(null);

  if (broughtBack) return <p className="text-sm text-emerald-400">{broughtBack}</p>;
  if (!item.endDate) return null;

  const archived = isArchived(item);
  function bringBack() {
    const today = todayISO();
    setBroughtBack(describeUnarchive(item.name, archiveGap(item, undefined, today), today));
    onUnarchive(item.id);
  }

  return (
    <div>
      <div className="text-xs text-slate-500">{archived ? "Archived since" : "End date"}</div>
      <div className="flex items-center gap-3">
        <span>{item.endDate}</span>
        {archived && (
          <button onClick={bringBack} className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
            Bring back
          </button>
        )}
      </div>
    </div>
  );
}
