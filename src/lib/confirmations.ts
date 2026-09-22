// §31 in Roadmap.md: deterministic chat confirmations built from the item as
// it was actually *stored* — never from the tool input, and never from a
// second LLM call — so the user can spot a mis-parsed request (e.g. a
// Tue/Thu/Sat/Sun habit silently saved as "every day") and learn what
// options exist. Whatever isn't in the user's own message but ended up
// stored anyway (a default, or the model's own pick) is flagged in a short
// "Assumed: ..." hint line.
//
// The same text is also fed back to the LLM as the tool result (App.tsx's
// pushAssistantMessage), so follow-up corrections have real context.
import type { Category, Habit, PausePeriod, RecurringTask, SingleTask } from "../types/models.ts";
import type { CreateHabitInput, CreateRecurringTaskInput, CreateSingleTaskInput } from "./dataStore.ts";
import { describeRecurrence, isPaused } from "./recurrence.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysFromToday(dateISO: string, todayISO: string): number {
  const toUTC = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(dateISO) - toUTC(todayISO)) / 86_400_000);
}

/** e.g. "today (Thu 18 Sep)", "tomorrow (Fri 19 Sep)", "Mon 22 Sep" — the year only when it isn't this one. */
export function formatDate(dateISO: string, todayISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = dateISO.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${y}`;
  const label = `${weekday} ${d} ${MONTHS[m - 1]}${year}`;
  const offset = daysFromToday(dateISO, todayISO);
  if (offset === 0) return `today (${label})`;
  if (offset === 1) return `tomorrow (${label})`;
  return label;
}

/** A goal duration in plain words — "10 min", "1 h 30 min" — rather than formatDurationMinutes's stopwatch style. */
export function formatGoalMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function categoryName(categoryId: string | undefined, categories: Category[]): string {
  if (!categoryId) return "none";
  return categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function describeTracking(habit: Pick<Habit, "completionType" | "target" | "unit" | "checklist">): string {
  switch (habit.completionType) {
    case "yesno":
      return "yes/no (done or not done)";
    case "value":
      return `number — goal ${habit.target ?? "?"}${habit.unit ? ` ${habit.unit}` : ""}`;
    case "timer":
      return `timer — goal ${habit.target !== undefined ? formatGoalMinutes(habit.target) : "?"}`;
    case "checklist": {
      const items = (habit.checklist ?? []).map((item) => item.text);
      return items.length > 0 ? `checklist (${items.join(", ")})` : "checklist (no items yet)";
    }
  }
}

// "Every Mon, Wed" reads fine as a line on its own but not mid-sentence;
// lowercase the leading "Every" so it also works after "Repeats:".
function recurrenceText(item: Pick<Habit, "recurrence">): string {
  return describeRecurrence(item.recurrence).replace(/^Every\b/, "every");
}

// Assumed-field detection. Only the user's own message is evidence of what
// they asked for — the model filling in a field doesn't mean the user said it.
type AssumedField = "recurrence" | "category" | "tracking" | "startDate";

// Deliberately no "say e.g. ..." examples — the bullet labels above the hint
// already show which settings exist, so the hint just names what was assumed.
const ASSUMED_LABELS: Record<AssumedField, (value: string) => string> = {
  recurrence: (v) => v,
  category: (v) => (v === "none" ? "no category" : v),
  tracking: (v) => v,
  startDate: () => "starting today",
};

const ASSUMED_FOLLOW_UP = "Need any changes?";

// Phrases that mean the user really did ask for "every day" — anything else
// that ended up stored as daily was the model's own default.
const EXPLICIT_DAILY =
  /\b(daily|every\s*day|each\s+day|every\s+(morning|night|evening|afternoon)|each\s+(morning|night|evening)|nightly|per\s+day|a\s+day)\b/i;

function isRecurrenceAssumed(item: Pick<Habit, "recurrence">, userText: string): boolean {
  const rule = item.recurrence;
  const isDaily = rule.type === "daily" || (rule.type === "intervalDays" && rule.interval === 1);
  return isDaily && !EXPLICIT_DAILY.test(userText);
}

function mentionsCategory(categoryId: string | undefined, categories: Category[], userText: string): boolean {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return false;
  const lower = userText.toLowerCase();
  return lower.includes(category.name.toLowerCase()) || lower.includes(category.id.toLowerCase());
}

function buildHint(assumed: { field: AssumedField; value: string }[]): string | null {
  if (assumed.length === 0) return null;
  const labels = assumed.map(({ field, value }) => ASSUMED_LABELS[field](value));
  return `Assumed: ${labels.join(", ")}.\n${ASSUMED_FOLLOW_UP}`;
}

function bullets(lines: string[]): string {
  return lines.map((line) => `• ${line}`).join("\n");
}

function withHint(body: string, hint: string | null): string {
  return hint ? `${body}\n${hint}` : body;
}

function datesLines(item: { startDate: string; endDate?: string }, todayISO: string): string[] {
  const lines = [`Starts: ${formatDate(item.startDate, todayISO)}`];
  if (item.endDate) lines.push(`Ends: ${formatDate(item.endDate, todayISO)}`);
  return lines;
}

function startDateGiven(input: { startDate?: string; startWeekday?: number }): boolean {
  return input.startDate !== undefined || input.startWeekday !== undefined;
}

export function describeCreatedHabit(
  habit: Habit,
  input: CreateHabitInput,
  categories: Category[],
  userText: string,
  todayISO: string,
): string {
  const category = categoryName(habit.categoryId, categories);
  const lines = [
    `Repeats: ${recurrenceText(habit)}`,
    `Category: ${category}`,
    `Tracking: ${describeTracking(habit)}`,
    ...datesLines(habit, todayISO),
  ];
  if (habit.priority > 1) lines.push(`Priority: ${habit.priority}`);
  if (habit.description) lines.push(`Note: ${habit.description}`);

  const assumed: { field: AssumedField; value: string }[] = [];
  if (isRecurrenceAssumed(habit, userText)) assumed.push({ field: "recurrence", value: recurrenceText(habit) });
  if (!mentionsCategory(habit.categoryId, categories, userText)) assumed.push({ field: "category", value: category });
  if (input.completionType === undefined) assumed.push({ field: "tracking", value: "yes/no" });
  if (!startDateGiven(input)) assumed.push({ field: "startDate", value: "" });

  return withHint(`Added habit "${habit.name}":\n${bullets(lines)}`, buildHint(assumed));
}

export function describeCreatedRecurringTask(
  task: RecurringTask,
  input: CreateRecurringTaskInput,
  categories: Category[],
  userText: string,
  todayISO: string,
): string {
  const category = categoryName(task.categoryId, categories);
  const lines = [`Repeats: ${recurrenceText(task)}`, `Category: ${category}`, ...datesLines(task, todayISO)];
  if (task.priority > 1) lines.push(`Priority: ${task.priority}`);
  if (task.description) lines.push(`Note: ${task.description}`);

  const assumed: { field: AssumedField; value: string }[] = [];
  if (isRecurrenceAssumed(task, userText)) assumed.push({ field: "recurrence", value: recurrenceText(task) });
  if (!mentionsCategory(task.categoryId, categories, userText)) assumed.push({ field: "category", value: category });
  if (!startDateGiven(input)) assumed.push({ field: "startDate", value: "" });

  return withHint(`Added recurring task "${task.name}":\n${bullets(lines)}`, buildHint(assumed));
}

export function describeCreatedSingleTask(task: SingleTask, input: CreateSingleTaskInput, todayISO: string): string {
  const lines = [
    `Date: ${formatDate(task.startDate, todayISO)}`,
    task.persistency ? "If not done: carries over to the next day" : "If not done: dropped at the end of the day",
  ];
  if (task.priority > 1) lines.push(`Priority: ${task.priority}`);
  if (task.description) lines.push(`Note: ${task.description}`);

  const hint = input.startDate === undefined ? `Assumed: due today.\n${ASSUMED_FOLLOW_UP}` : null;
  return withHint(`Added task "${task.name}":\n${bullets(lines)}`, hint);
}

type AnyItem = Habit | RecurringTask | SingleTask;

/** Only the fields that actually differ, as "Field: before → after". */
export function describeChanges(before: AnyItem, after: AnyItem, categories: Category[], todayISO: string): string[] {
  const changes: string[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) changes.push(`${label}: ${from} → ${to}`);
  };
  const date = (iso: string | undefined) => (iso ? formatDate(iso, todayISO) : "none");

  add("Name", `"${before.name}"`, `"${after.name}"`);
  add("Note", before.description ?? "none", after.description ?? "none");
  add("Category", categoryName(before.categoryId, categories), categoryName(after.categoryId, categories));
  add("Priority", String(before.priority), String(after.priority));
  add("Starts", date(before.startDate), date(after.startDate));
  add("Ends", date(before.endDate), date(after.endDate));

  if (before.kind !== "singleTask" && after.kind !== "singleTask") {
    add("Repeats", recurrenceText(before), recurrenceText(after));
  }
  if (before.kind === "habit" && after.kind === "habit") {
    add("Tracking", describeTracking(before), describeTracking(after));
  }
  if (before.kind === "singleTask" && after.kind === "singleTask") {
    add("Status", before.done ? "done" : "not done", after.done ? "done" : "not done");
    add(
      "If not done",
      before.persistency ? "carries over" : "dropped at end of day",
      after.persistency ? "carries over" : "dropped at end of day",
    );
  }
  return changes;
}

export function describeUpdate(before: AnyItem, after: AnyItem, categories: Category[], todayISO: string): string {
  const changes = describeChanges(before, after, categories, todayISO);
  if (changes.length === 0) return `Nothing changed on "${after.name}" — it already had those settings.`;
  return `Updated "${before.name}":\n${bullets(changes)}`;
}

/**
 * §28: states the window as stored, so a misread relative phrase ("until the 15th") is
 * visible in the reply and can be corrected — same principle as §31's confirmations.
 */
export function describePause(name: string, pause: PausePeriod, todayISO: string): string {
  const from = pause.from <= todayISO ? "from today" : `from ${formatDate(pause.from, todayISO)}`;
  if (!pause.resumeOn) {
    return `Paused "${name}" ${from} — no occurrences until you ask me to resume it.`;
  }
  return `Paused "${name}" ${from} — back on ${formatDate(pause.resumeOn, todayISO)}. Paused days don't count as missed.`;
}

export function describeResume(name: string): string {
  return `Resumed "${name}" — it's due again from today.`;
}

export function describeArchive(item: AnyItem): string {
  return `Archived "${item.name}" — no more occurrences after today, and its completion history is kept.`;
}

// §32: enough detail to tell same-named items apart (category first, since
// that's what the model can pass back as a selector).
export function itemDetails(item: AnyItem, categories: Category[], todayISO: string): string {
  if (item.kind === "singleTask") {
    return [formatDate(item.startDate, todayISO), item.done ? "done" : "not done"].join(" · ");
  }
  const parts = [categoryName(item.categoryId, categories), recurrenceText(item)];
  if (item.kind === "habit") {
    parts.push(item.completionType === "yesno" ? "yes/no" : describeTracking(item).replace(" — ", ", "));
  }
  if (item.endDate && item.endDate < todayISO) parts.push("archived");
  if (isPaused(item, todayISO)) parts.push("paused");
  return parts.join(" · ");
}

/** Numbered items with their details — shared by the "which one?", duplicate, and delete questions. */
export function describeItemList(items: AnyItem[], categories: Category[], todayISO: string): string {
  return items
    .map((item, index) => `${index + 1}. "${item.name}" — ${itemDetails(item, categories, todayISO)}`)
    .join("\n");
}

/** The "which one did you mean?" question, numbered and with details so identical names can be told apart. */
export function describeCandidates(
  noun: string,
  fragment: string,
  items: AnyItem[],
  categories: Category[],
  todayISO: string,
): string {
  return `I found ${items.length} ${noun}s matching "${fragment}":\n${describeItemList(items, categories, todayISO)}\nWhich one did you mean? You can reply with its number.`;
}

/**
 * §29: asked before completing a one-off task dated in the future. Doing it early is
 * legitimate, but the record should say when it actually happened — hence the move.
 */
export function describeFutureTaskQuestion(name: string, startDateISO: string, todayISO: string): string {
  return `"${name}" is set for ${formatDate(startDateISO, todayISO)}, which hasn't happened yet. Mark it done and move it to today?`;
}

/** Asked before creating an item whose name is already in use — nothing is created until the user confirms. */
export function describeDuplicateQuestion(
  noun: string,
  name: string,
  existing: AnyItem[],
  categories: Category[],
  todayISO: string,
): string {
  const already =
    existing.length === 1
      ? `You already have a ${noun} called "${existing[0].name}" (${itemDetails(existing[0], categories, todayISO)}).`
      : `You already have ${existing.length} ${noun}s called "${name}":\n${describeItemList(existing, categories, todayISO)}\n`;
  return `${already}${existing.length === 1 ? " " : ""}Are you sure you want to create a new one with the same name?`;
}
