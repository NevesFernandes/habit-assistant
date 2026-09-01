// Data model for the Habit Assistant. See CLAUDE.md for the product rationale.
//
// Only SingleTask is wired end-to-end in this first scaffold. Habit and
// RecurringTask are typed now so the recurrence engine and Drive file shape
// don't need to be reshaped later.

export interface Category {
  id: string;
  name: string;
  icon: string; // a lucide-react icon name (kebab-case, key into ICON_REGISTRY — see src/lib/icons.ts)
  isDefault: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface BaseItem {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  priority: number;
  startDate: string; // ISO date, defaults to today
  endDate?: string; // ISO date
}

// See the "Periodicity" section of CLAUDE.md for the product rationale
// behind each variant.
export type RecurrenceRule =
  | { type: "daily" }
  | { type: "daysOfWeek"; days: number[] } // 0 = Sunday .. 6 = Saturday
  | { type: "intervalDays"; interval: number }
  | { type: "timesPerPeriod"; period: "week" | "month"; count: number }
  | { type: "nthWeekdayOfMonth"; nth: "first" | "second" | "third" | "fourth" | "fifth" | "last"; weekday: number }
  | { type: "specificDatesOfYear"; dates: string[] } // "MM-DD", no year
  | { type: "onOffCycle"; onDays: number; offDays: number };

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
  persistency: boolean; // true: rolls forward to today on next app open if still incomplete; false: dies uncompleted at end of startDate
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
  { id: "quit-bad-habit", name: "Quit a bad habit", icon: "ban", isDefault: true },
  { id: "study", name: "Study", icon: "graduation-cap", isDefault: true },
  { id: "sports", name: "Sports", icon: "dumbbell", isDefault: true },
  { id: "social", name: "Social", icon: "users", isDefault: true },
  { id: "finance", name: "Finance", icon: "dollar-sign", isDefault: true },
  { id: "health", name: "Health", icon: "heart-pulse", isDefault: true },
  { id: "work", name: "Work", icon: "briefcase", isDefault: true },
  { id: "nutrition", name: "Nutrition", icon: "utensils", isDefault: true },
  { id: "home", name: "Home", icon: "home", isDefault: true },
  { id: "outdoor", name: "Outdoor", icon: "trees", isDefault: true },
  { id: "other", name: "Other", icon: "square", isDefault: true },
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
