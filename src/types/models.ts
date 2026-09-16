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

// BYOK settings, synced across devices via AppData.byokSettings — see §30 in
// Roadmap.md and CLAUDE.md's "Cost model / provider strategy". Defined here
// (not in src/lib/settingsStore.ts, the only other place it's used) because
// models.ts is a leaf module every lib/*.ts file imports one-way from, never
// the reverse.
export type ByokProvider = "anthropic" | "groq" | "gemini";

export interface SyncedByokSettings {
  activeProvider: ByokProvider | null;
  keys: Partial<Record<ByokProvider, { apiKey: string; model?: string }>>;
  sttUsesOwnKey?: boolean;
}

export interface Habit extends BaseItem {
  kind: "habit";
  categoryId: string; // required for Habits specifically, to enable category aggregate stats later
  recurrence: RecurrenceRule;
  completionType: CompletionType;
  checklist?: ChecklistItem[]; // only meaningful when completionType === "checklist"
  target?: number; // meaningful when completionType is "value" or "timer"; timer's target is always minutes
  unit?: string; // meaningful when completionType is "value", e.g. "glasses", "pages" — free text
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
  // The task's first-ever startDate, untouched by rolloverPersistentTasks bumping
  // startDate forward — lets the UI show a rolled-over task's true original due date.
  // Optional: tasks created before this field existed won't have it.
  originalStartDate?: string;
}

export interface CompletionLogEntry {
  id: string;
  itemId: string;
  date: string; // ISO date of the occurrence this entry covers
  value?: number; // used when the habit's completionType is "value" or "timer"
  checklist?: ChecklistItem[]; // per-date snapshot of items+checked state; used when the habit's completionType is "checklist"
}

export interface AppData {
  categories: Category[];
  habits: Habit[];
  recurringTasks: RecurringTask[];
  singleTasks: SingleTask[];
  completionLog: CompletionLogEntry[];
  // Shared-trial messages used so far, client-trusted honor-system counter — see §20 in Roadmap.md.
  sharedKeyMessageCount?: number;
  // BYOK settings synced across devices, plain text (no passphrase encryption —
  // see §30 in Roadmap.md and CLAUDE.md for why). Reflected into localStorage
  // only at sign-in (src/lib/settingsStore.ts's importState/exportState),
  // never mid-session, to avoid clobbering an in-flight Settings.tsx save.
  byokSettings?: SyncedByokSettings;
  // Whether spoken replies are on, per device — keyed by a random id each
  // device generates and caches once (src/lib/ttsPreference.ts). Unlike
  // byokSettings above, this is a per-key map, not a whole-blob sync: each
  // device remembers its own choice under this account, rather than one
  // toggle changing it everywhere.
  ttsEnabledByDevice?: Record<string, boolean>;
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
