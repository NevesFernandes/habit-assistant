import { useState } from "react";
import type { ChecklistItem } from "../types/models";

interface ChecklistProps {
  items: ChecklistItem[];
  onToggle: (itemId: string) => void;
  onAdd?: (text: string) => void; // omit to disable "add item" UI — a Habit's completion-type role has no add interaction
}

export default function Checklist({ items, onToggle, onAdd }: ChecklistProps) {
  const [draft, setDraft] = useState("");

  function submitDraft() {
    const text = draft.trim();
    if (!text || !onAdd) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 && onAdd && <p className="text-xs text-slate-500">No items yet.</p>}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => onToggle(item.id)}
              className="h-4 w-4 shrink-0"
            />
            <span className={item.checked ? "text-slate-500 line-through" : ""}>{item.text}</span>
          </li>
        ))}
      </ul>
      {onAdd && (
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitDraft()}
            placeholder="Add item…"
            className="flex-1 rounded-md bg-slate-700 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={submitDraft}
            className="shrink-0 rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
