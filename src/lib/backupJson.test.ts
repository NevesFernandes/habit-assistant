// §82 in Roadmap.md: the JSON backup — what each section carries, what "planned only" leaves
// out, and how Merge and Replace import it back. Plain-assert style, run under tsx.
// Run: npm run test:backupJson
import assert from "node:assert/strict";
import {
  applyBackup,
  backupText,
  BACKUP_SECTIONS,
  buildBackup,
  changedAnything,
  describeImport,
  parseBackup,
  sectionCounts,
  type BackupFile,
  type BackupSection,
} from "./backupJson.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { DEFAULT_CATEGORIES, emptyAppData, type AppData, type Habit, type RecurringTask, type SingleTask } from "../types/models.ts";

const TODAY = "2026-11-10";
const ALL = [...BACKUP_SECTIONS];

const readHabit: Habit = {
  kind: "habit", id: "h-read", name: "Read", categoryId: "c-mine", dayPart: "bedtime",
  startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno",
  statsFrom: "2026-10-15", pauses: [{ from: "2026-11-20", resumeOn: "2026-11-22" }],
};
const oldHabit: Habit = {
  kind: "habit", id: "h-old", name: "Old", categoryId: "health", startDate: "2026-01-01", endDate: "2026-03-01",
  recurrence: { type: "daily" }, completionType: "yesno",
};
const shopping: RecurringTask = {
  kind: "recurringTask", id: "t-shop", name: "Shopping", startDate: "2026-10-01", recurrence: { type: "daysOfWeek", days: [6] },
  checklist: [
    { id: "i-milk", text: "Milk", checked: false, addedOn: "2026-10-01", doneOn: "2026-10-04" },
    { id: "i-eggs", text: "Eggs", checked: false, addedOn: "2026-10-01" },
    { id: "i-gone", text: "Gone", checked: false, addedOn: "2026-10-01", removedOn: "2026-10-11" },
  ],
};
const openTask: SingleTask = { kind: "singleTask", id: "s-open", name: "Call mum", startDate: TODAY, done: false, persistency: true };
const doneTask: SingleTask = { kind: "singleTask", id: "s-done", name: "Pay rent", startDate: "2026-11-01", done: true, persistency: true, doneOn: "2026-11-01" };

function source(): AppData {
  return {
    ...emptyAppData(),
    categories: [...DEFAULT_CATEGORIES, { id: "c-mine", name: "Reading", icon: "book", isDefault: false }],
    habits: [readHabit, oldHabit],
    recurringTasks: [shopping],
    singleTasks: [openTask, doneTask],
    completionLog: [
      { id: "e1", itemId: "h-read", date: "2026-11-08" },
      { id: "e2", itemId: "h-read", date: "2026-11-09" },
      { id: "e3", itemId: "h-old", date: "2026-02-01" },
      { id: "e4", itemId: "t-shop", date: "2026-11-07" },
    ],
    notes: [
      { id: "n1", itemId: "h-read", date: "2026-11-09", text: "50 pages" },
      { id: "n2", itemId: "s-done", date: "2026-11-01", text: "by transfer" },
    ],
    goals: [{ id: "g1", itemId: "h-read", kind: "challenge", target: 30, measure: "days", from: "2026-11-01", to: "2026-11-30", createdOn: "2026-11-01" }],
    weekStartsOn: 1,
    // Account- and device-bound: never in a backup.
    sharedKeyMessageCount: 12,
    byokSettings: { activeProvider: "groq", keys: { groq: { apiKey: "secret-key" } } },
    ttsEnabledByDevice: { dev: true },
    ttsEnabledDefault: true,
    timeZone: "Europe/Lisbon",
    undo: {} as AppData["undo"],
  };
}

const roundTrip = (file: BackupFile): BackupFile => {
  const parsed = parseBackup(backupText(file));
  assert.ok("file" in parsed, "a built backup parses");
  return parsed.file;
};
const sortById = <T extends { id: string }>(list: T[] = []) => [...list].sort((a, b) => a.id.localeCompare(b.id));

// --- Everything: export into an empty account brings back the same data. ---
{
  const file = roundTrip(buildBackup(source(), ALL, TODAY));
  const text = backupText(file);
  for (const secret of ["secret-key", "sharedKeyMessageCount", "ttsEnabled", "Europe/Lisbon", "undo"]) {
    assert.ok(!text.includes(secret), `a backup never carries ${secret}`);
  }
  const { data, summary } = applyBackup(emptyAppData(), file, ALL, "merge", TODAY);
  const src = source();
  assert.deepEqual(sortById(data.habits), sortById(src.habits));
  assert.deepEqual(data.recurringTasks, src.recurringTasks);
  assert.deepEqual(sortById(data.singleTasks), sortById(src.singleTasks));
  assert.deepEqual(sortById(data.completionLog), sortById(src.completionLog));
  assert.deepEqual(sortById(data.notes), sortById(src.notes));
  assert.deepEqual(data.goals, src.goals);
  assert.equal(data.weekStartsOn, 1);
  assert.equal(data.categories.find((c) => c.id === "c-mine")?.name, "Reading");
  assert.equal(data.sharedKeyMessageCount, undefined);
  assert.equal(data.byokSettings, undefined);
  assert.equal(summary.added.habits, 2);
  assert.equal(summary.notes, 2);

  // Importing the same file again with Merge changes nothing.
  const again = applyBackup(data, file, ALL, "merge", TODAY);
  assert.equal(changedAnything(again.summary), false, describeImport(again.summary, true));
  assert.deepEqual(again.data, data);
}

// --- Planned only is a fresh start. ---
{
  const file = roundTrip(buildBackup(source(), ["habits", "recurringTasks", "singleTasksOpen"], TODAY));
  const habit = file.sections.habits!.items.find((h) => h.id === "h-read")!;
  assert.equal(habit.statsFrom, undefined, "no stats reset date");
  assert.deepEqual(habit.pauses, readHabit.pauses, "pauses are plan, kept");
  const task = file.sections.recurringTasks!.items[0];
  assert.deepEqual(task.checklist!.map((i) => i.id), ["i-eggs"], "ticked and removed checklist items left out");
  assert.equal(file.sections.habitHistory, undefined);
  assert.deepEqual(file.sections.singleTasksOpen!.items.map((t) => t.id), ["s-open"]);
  assert.deepEqual(file.categoriesUsed.map((c) => c.id), ["c-mine"], "a category the items use comes along");

  const { data, summary } = applyBackup(emptyAppData(), file, ["habits"], "merge", TODAY);
  assert.equal(data.habits.find((h) => h.id === "h-read")!.categoryId, "c-mine");
  assert.equal(summary.categoriesAdded, 1);
  assert.equal(data.completionLog.length, 0);
}

// --- Merging a plan onto an item that has history keeps that history. ---
{
  const file = roundTrip(buildBackup(source(), ["recurringTasks", "habits"], TODAY));
  file.sections.recurringTasks!.items[0].name = "Groceries";
  const { data } = applyBackup(source(), file, ["recurringTasks", "habits"], "merge", TODAY);
  const task = data.recurringTasks[0];
  assert.equal(task.name, "Groceries");
  assert.deepEqual(task.checklist!.map((i) => i.id).sort(), ["i-eggs", "i-gone", "i-milk"], "own ticked/removed items kept");
  assert.equal(task.checklist!.find((i) => i.id === "i-eggs")!.addedOn, "2026-10-01");
  assert.equal(data.habits.find((h) => h.id === "h-read")!.statsFrom, "2026-10-15", "own stats reset kept");
}

// --- Archived items can be left out, with their history and goals. ---
{
  assert.equal(sectionCounts(source(), TODAY, { includeArchived: false }).habits, 1);
  const file = buildBackup(source(), ALL, TODAY, { includeArchived: false });
  assert.deepEqual(file.sections.habits!.items.map((h) => h.id), ["h-read"]);
  assert.ok(!file.sections.habitHistory!.log.some((e) => e.itemId === "h-old"));
  assert.equal(file.archivedLeftOut, true);
}

// --- History without its items: skipped and counted. ---
{
  const file = roundTrip(buildBackup(source(), ["habitHistory", "goals"], TODAY));
  const { data, summary } = applyBackup(emptyAppData(), file, ["habitHistory", "goals"], "merge", TODAY);
  assert.equal(data.completionLog.length, 0);
  assert.deepEqual(summary.skipped.map((s) => [s.section, s.count]), [["habitHistory", 3], ["goals", 1]]);
  assert.match(describeImport(summary, true), /Skips 3 from habit history: their habits aren't in your data/);
}

// --- Replace: a section is cleared first, and removed items take their history along. ---
{
  const target = source();
  target.habits = [...target.habits, { ...oldHabit, id: "h-extra", name: "Extra", endDate: undefined }];
  target.completionLog = [...target.completionLog, { id: "e9", itemId: "h-extra", date: "2026-11-09" }];
  target.notes = [...(target.notes ?? []), { id: "n9", itemId: "h-extra", date: "2026-11-09", text: "x" }];
  const file = roundTrip(buildBackup(source(), ["habits"], TODAY));
  const { data, summary } = applyBackup(target, file, ["habits"], "replace", TODAY);
  assert.deepEqual(data.habits.map((h) => h.id).sort(), ["h-old", "h-read"]);
  assert.ok(!data.completionLog.some((e) => e.itemId === "h-extra"), "its history went with it");
  assert.ok(!(data.notes ?? []).some((n) => n.itemId === "h-extra"), "its notes too");
  assert.ok(data.completionLog.some((e) => e.itemId === "h-read"), "kept items keep their history");
  assert.equal(summary.removed.habits, 1);
  assert.deepEqual(data.singleTasks, target.singleTasks, "unpicked sections untouched");
}
{
  // Replace history: entries not in the file go; other kinds' history stays.
  const file = roundTrip(buildBackup(source(), ["habitHistory"], TODAY));
  file.sections.habitHistory!.log = file.sections.habitHistory!.log.filter((e) => e.id !== "e2");
  const { data, summary } = applyBackup(source(), file, ["habitHistory"], "replace", TODAY);
  assert.ok(!data.completionLog.some((e) => e.id === "e2"));
  assert.ok(data.completionLog.some((e) => e.id === "e4"), "recurring task history untouched");
  assert.equal(summary.removed.habitHistory, 1);
}
{
  // Replace one-off tasks still to do leaves the done ones alone.
  const target = source();
  target.singleTasks = [...target.singleTasks, { ...openTask, id: "s-other", name: "Other" }];
  const { data } = applyBackup(target, roundTrip(buildBackup(source(), ["singleTasksOpen"], TODAY)), ["singleTasksOpen"], "replace", TODAY);
  assert.deepEqual(data.singleTasks.map((t) => t.id).sort(), ["s-done", "s-open"]);
}

// --- Categories: same name maps onto the existing one; unknown falls back. ---
{
  const target = emptyAppData();
  target.categories = [...DEFAULT_CATEGORIES, { id: "c-other-id", name: "reading", icon: "book", isDefault: false }];
  const file = roundTrip(buildBackup(source(), ["habits", "categories"], TODAY));
  const { data } = applyBackup(target, file, ["habits"], "merge", TODAY);
  assert.equal(data.categories.filter((c) => c.name.toLowerCase() === "reading").length, 1, "no duplicate category");
  assert.equal(data.habits.find((h) => h.id === "h-read")!.categoryId, "c-other-id");

  file.sections.habits!.items[0] = { ...file.sections.habits!.items[0], categoryId: "nowhere" };
  const fallback = applyBackup(emptyAppData(), file, ["habits"], "merge", TODAY).data;
  assert.equal(fallback.habits[0].categoryId, "other", "a habit with an unknown category lands in Other");
}

// --- Goals: one running goal per item. ---
{
  const file = roundTrip(buildBackup(source(), ["goals"], TODAY));
  file.sections.goals!.goals[0] = { ...file.sections.goals!.goals[0], id: "g-new" };
  const merged = applyBackup(source(), file, ["goals"], "merge", TODAY);
  assert.deepEqual(merged.data.goals!.map((g) => g.id), ["g1"]);
  assert.equal(merged.summary.skipped[0].reason, "that item or category already has a running goal");
  const replaced = applyBackup(source(), file, ["goals"], "replace", TODAY);
  assert.deepEqual(replaced.data.goals!.map((g) => g.id), ["g-new"]);
}

// --- Bad files are refused whole. ---
{
  const good = backupText(buildBackup(source(), ALL, TODAY));
  assert.ok("error" in parseBackup("not json"));
  assert.ok("error" in parseBackup(JSON.stringify({ format: "something-else", version: 1, sections: {} })));
  const newer = JSON.parse(good);
  newer.version = 99;
  assert.match((parseBackup(JSON.stringify(newer)) as { error: string }).error, /newer version/);
  const broken = JSON.parse(good);
  broken.sections.habits.items[0].startDate = "yesterday";
  assert.match((parseBackup(JSON.stringify(broken)) as { error: string }).error, /damaged.*Habits/);
}

// --- Only picked sections that the file has are applied. ---
{
  const file = roundTrip(buildBackup(source(), ["weekStart"], TODAY));
  const picked: BackupSection[] = ["weekStart", "habits"];
  const { data, summary } = applyBackup(emptyAppData(), file, picked, "replace", TODAY);
  assert.equal(data.weekStartsOn, 1);
  assert.equal(summary.weekStartChanged, true);
  assert.equal(data.habits.length, 0, "a section the file doesn't hold is never cleared");
}

// --- The app's chat: export carries the file on the reply; import points to Settings. ---
{
  let input: Record<string, unknown> = { action: "export", sections: ["habits", "nonsense"] };
  const session = new ChatSession({
    getData: () => source(),
    persist: async () => {
      throw new Error("a backup never saves");
    },
    callAgent: async (messages) => ({ toolCall: { id: String(messages.length), name: "backupData", input } as AgentToolCall & { id: string } }),
    todayISO: () => TODAY,
  });
  const last = () => session.messages.filter((m) => m.role === "assistant").pop()!;
  await session.send("export my habits");
  const reply = last();
  assert.equal(reply.content, "Your backup: habits (2), the category of your own these use. Tap Download to save it. It never holds API keys; to bring it into an account, use Settings → Backup.");
  assert.ok(reply.role === "assistant" && reply.download);
  assert.equal(reply.download!.filename, "habit-assistant-2026-11-10.json");
  const parsed = parseBackup(reply.download!.text);
  assert.ok("file" in parsed && Object.keys(parsed.file.sections).join() === "habits", "unknown section names ignored");

  input = { action: "export", includeArchived: false };
  await session.send("back up everything except archived");
  assert.match(last().content!, /^Your backup: habits \(1\), .*Archived items are left out\./);

  input = { action: "import" };
  await session.send("import my backup");
  assert.match(last().content!, /^To import a backup, open Settings/);
  assert.equal(last().role === "assistant" && last().download, undefined);
}

console.log("backupJson: all passed");
