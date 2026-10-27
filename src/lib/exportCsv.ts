// §72: a period's history as a CSV file, one row per item per day, for the app's chat (a
// Download button) and the Claude connector (the same text, for Claude to save) alike. Only
// days where something applies, as in history; never a day after today, since an export is
// a record. Pure: no Drive, no DOM.
import type { AppData } from "../types/models.ts";
import { getHistory, HISTORY_MAX_DAYS, historyRangeDays } from "./history.ts";
import { dayPartLabel } from "./dayParts.ts";

export const EXPORT_COLUMNS = ["date", "item", "kind", "category", "part of day", "status", "value", "goal", "unit", "checklist", "note"];

const KIND_LABELS = { habit: "habit", recurringTask: "recurring task", singleTask: "one-off task" } as const;
const STATUS_LABELS = { done: "done", missed: "missed", open: "to do today", upcoming: "coming up", paused: "paused", skipped: "skipped", not_due: "not due" } as const;

export interface CsvExport {
  from: string;
  /** The period's end, never after today. */
  to: string;
  filename: string;
  rows: number;
  /** Without a byte-order mark; the app adds one for Excel. */
  csv: string;
}

/** A refusal for a period an export can't cover, or undefined when it's fine. */
export function exportRefusal(from: string, to: string, today: string): string | undefined {
  if (to < from) return "That period ends before it starts.";
  if (from > today) return "That period hasn't started yet, so there's nothing to export.";
  if (historyRangeDays(from, to < today ? to : today) > HISTORY_MAX_DAYS) return `That's more than a year. Export at most ${HISTORY_MAX_DAYS} days at a time.`;
  return undefined;
}

function cell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The CSV for `from` to `to` (cut at today). Pass `data` as the app shows it, one-off tasks
 * already carried over to today. The caller checks the period with exportRefusal first.
 */
export function buildExportCsv(data: AppData, from: string, to: string, today: string): CsvExport {
  const end = to < today ? to : today;
  const history = getHistory(data, from, end, today, undefined, { allDays: true });
  const items = new Map([...data.habits, ...data.recurringTasks, ...data.singleTasks].map((item) => [item.id, item]));
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const day of history.days ?? []) {
    for (const entry of day.items) {
      const item = items.get(entry.id);
      const category = data.categories.find((c) => c.id === item?.categoryId)?.name;
      lines.push(
        [
          day.date,
          entry.name,
          KIND_LABELS[entry.kind],
          category,
          item?.dayPart ? dayPartLabel(item.dayPart) : undefined,
          STATUS_LABELS[entry.status],
          entry.value,
          entry.target,
          entry.unit,
          entry.checklist ? `${entry.checklist.checked}/${entry.checklist.total}` : undefined,
          entry.note,
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return {
    from,
    to: end,
    filename: from === end ? `habit-assistant-${from}.csv` : `habit-assistant-${from}-to-${end}.csv`,
    rows: lines.length - 1,
    csv: lines.join("\r\n") + "\r\n",
  };
}
