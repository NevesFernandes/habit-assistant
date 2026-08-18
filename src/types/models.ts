// Data model for the Habit Assistant. See CLAUDE.md for the product rationale.
//
// Only SingleTask is wired end-to-end in this first scaffold. Habit and
// RecurringTask are typed now so the recurrence engine and Drive file shape
// don't need to be reshaped later.

export interface Category {
  id: string;
  name: string;
  icon: string; // an emoji for v1 — cheap, no asset pipeline needed
  isDefault: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

interface BaseItem {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  priority: number;
  startDate: string; // ISO date, defaults to today
  endDate?: string; // ISO date
}

// v1 recurrence types. Extend this union with nthWeekdayOfMonth,
// specificDatesOfYear, and onOffCycle in the fast-follow-up pass —
// see the "Periodicity" section of CLAUDE.md for the full target list.
export type RecurrenceRule =
  | { type: "daily" }
  | { type: "daysOfWeek"; days: number[] } // 0 = Sunday .. 6 = Saturday
  | { type: "intervalDays"; interval: number }
  | { type: "timesPerPeriod"; period: "week" | "month"; count: number };

export type CompletionType = "yesno" | "value" | "timer" | "checklist";

export interface Habit extends BaseItem {
  kind: "habit";
  categoryId: string; // required for Habits specifically, to enable category aggregate stats later
  recurrence: RecurrenceRule;
  completionType: CompletionType;
  checklist?: ChecklistItem[]; // only meaningful when completionType === "checklist"
}

export interface RecurringTask extends BaseItem {
  kind: "recurringTask";
  recurrence: RecurrenceRule;
  checklist?: ChecklistItem[];
}

export interface SingleTask extends BaseItem {
  kind: "singleTask";
  done: boolean;
  checklist?: ChecklistItem[];
}

export interface CompletionLogEntry {
  id: string;
  itemId: string;
  date: string; // ISO date of the occurrence this entry covers
  value?: number; // used when the habit's completionType is "value" or "timer"
}

export interface AppData {
  categories: Category[];
  habits: Habit[];
  recurringTasks: RecurringTask[];
  singleTasks: SingleTask[];
  completionLog: CompletionLogEntry[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "quit-bad-habit", name: "Quit a bad habit", icon: "🚫", isDefault: true },
  { id: "study", name: "Study", icon: "🎓", isDefault: true },
  { id: "sports", name: "Sports", icon: "🏃", isDefault: true },
  { id: "social", name: "Social", icon: "💬", isDefault: true },
  { id: "finance", name: "Finance", icon: "💲", isDefault: true },
  { id: "health", name: "Health", icon: "➕", isDefault: true },
  { id: "work", name: "Work", icon: "💼", isDefault: true },
  { id: "nutrition", name: "Nutrition", icon: "🍴", isDefault: true },
  { id: "home", name: "Home", icon: "🏠", isDefault: true },
  { id: "outdoor", name: "Outdoor", icon: "🏞️", isDefault: true },
  { id: "other", name: "Other", icon: "◻️", isDefault: true },
];

export function emptyAppData(): AppData {
  return {
    categories: DEFAULT_CATEGORIES,
    habits: [],
    recurringTasks: [],
    singleTasks: [],
    completionLog: [],
  };
}
