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
  // §42, Recurring Task checklists only (see src/lib/recurringChecklist.ts): the first
  // occurrence date the item belongs to, and — in "carryOver" mode — the day it was
  // ticked. There `checked` is derived per date, not stored.
  addedOn?: string;
  doneOn?: string;
  // §56, on a Recurring Task's checklist or a Checklist habit's steps (habitChecklist.ts):
  // the first date the item is gone from, after being removed. Earlier days keep showing it.
  // A habit's step uses `addedOn` the same way, for a step that joined later.
  removedOn?: string;
}

// §42: what a Recurring Task's checklist does from one occurrence to the next.
// carryOver: each occurrence has its own list; unticked items move on to the next one.
// sameList: a fixed routine; every item starts unticked each occurrence.
export type ChecklistMode = "carryOver" | "sameList";

// §54: where in the day an item belongs (src/lib/dayParts.ts has the order and labels).
export type DayPart = "wakeUp" | "morning" | "workDay" | "afternoon" | "evening" | "bedtime";

export interface BaseItem {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  // §54: display order is part of the day, then important first, then name. An item
  // saved before §54 has neither field and shows as "not placed yet".
  dayPart?: DayPart;
  important?: boolean;
  // Legacy, from before §54: an open-ended number that set sort order. Nothing writes it
  // any more; it is only read as "important" when above 1 (see isImportant).
  priority?: number;
  startDate: string; // ISO date, defaults to today
  endDate?: string; // ISO date
  // §64: stats count from here (a reset); absent = from startDate. History is never touched.
  statsFrom?: string;
  // §64: the best streak counts from here; only an explicit "including best streak" sets it.
  bestStreakFrom?: string;
  // §64: both as they were before the last reset, so "undo the reset" can put them back.
  statsUndo?: { statsFrom?: string; bestStreakFrom?: string };
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

/**
 * §28 in Roadmap.md: a stretch where a Habit or Recurring Task generates no occurrences,
 * without archiving it. `from` is the first paused day; `resumeOn` is the first day back
 * (exclusive), or undefined for an open-ended pause the user resumes by asking.
 *
 * Finished pauses are kept, never cleared on resume: a paused day counts as neither done
 * nor missed, so dropping the record would turn those days back into misses and silently
 * undo the streak the pause protected.
 */
export interface PausePeriod {
  from: string; // ISO date, always today or later when created
  resumeOn?: string; // ISO date, exclusive — the first day the item is due again
  skip?: true; // §68: a one-day pause the user asked for as "skip": shown as skipped, kept by pause/resume
}

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
  pauses?: PausePeriod[]; // §28; absent on items saved before pausing existed
}

export interface RecurringTask extends BaseItem {
  kind: "recurringTask";
  recurrence: RecurrenceRule;
  checklist?: ChecklistItem[];
  checklistMode?: ChecklistMode; // §42; absent = "carryOver"
  checklistDoneByDate?: Record<string, string[]>; // §42, "sameList" only: item ids ticked on each date
  pauses?: PausePeriod[]; // §28; absent on items saved before pausing existed
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
  // §63: the day it was marked done, for "done this week". Absent on tasks done before
  // §63 (they count in all-time only) and on tasks not done.
  doneOn?: string;
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
  // §69: read-aloud for a device with no entry above, set when the Claude connector turns it
  // on or off "everywhere" (it has no device of its own). Absent = off, as before.
  ttsEnabledDefault?: boolean;
  // §43: the day weeks begin on, synced across devices (Settings). Absent means Sunday.
  // Only where a week *starts* — weekday numbers in recurrence rules stay 0 = Sunday.
  weekStartsOn?: WeekStart;
  // §62: the IANA time zone of the device that last opened the app (e.g. "Europe/Lisbon"),
  // written by the app on sign-in when it differs. The MCP Worker runs in UTC and reads
  // "today" from it. Absent until the app first runs a version that writes it.
  timeZone?: string;
  // §67: a short note per item per day ("5 km, legs tired"), kept apart from the completion
  // log so it survives un-ticking and can sit on a missed day too. Absent = none yet.
  notes?: DayNote[];
}

export interface DayNote {
  id: string;
  itemId: string;
  date: string; // the day it's about, YYYY-MM-DD
  text: string;
}

/** 0 = Sunday, 1 = Monday — the same numbering as dayOfWeek. */
export type WeekStart = 0 | 1;

export function weekStartOf(data: Pick<AppData, "weekStartsOn">): WeekStart {
  return data.weekStartsOn ?? 0;
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
