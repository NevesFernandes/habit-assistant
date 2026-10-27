// §61 Phase 3/4 gates: the app's chat scenarios (tests/chat/scenarios) for what the
// connector can do, replayed as tool calls. Same fixtures, same data checks, and the same
// reply patterns wherever the reply is the app's own text (create/update confirmations,
// §29/§32 questions). Where the app's reply is the chat engine's own wording ("Marked
// "Gym" complete…"), Claude writes the reply instead, so only the status and the data are
// checked. The model's part, turning the user's words into a call, is the args here.
// Deterministic: no model, no network. Run: npm run test:mcp
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDate } from "../lib/confirmations.ts";
import { addDays, dayOfWeek, occursOn } from "../lib/recurrence.ts";
import { currentHabitChecklist, habitChecklistOn } from "../lib/habitChecklist.ts";
import { recurringTaskChecklistOn } from "../lib/recurringChecklist.ts";
import { isDayPart, isImportant } from "../lib/dayParts.ts";
import { DEFAULT_CATEGORIES, type AppData } from "../types/models.ts";
import type { TextMatch } from "../../tests/chat/types.ts";
import { all, check, describeRule, habitById, habitsNamed, isWeekdays, nextWeekday, todayISO } from "../../tests/chat/scenarios/helpers.ts";
import { callTool, memoryStore } from "./testing/fakes.ts";

interface Step {
  tool: string;
  args: Record<string, unknown>;
  expect: {
    status?: string;
    /** Every pattern must appear in the reply text the tool returned (confirmation, question, message, reason). */
    text?: TextMatch | TextMatch[];
    notText?: TextMatch | TextMatch[];
    /** The file after the step. */
    data?: (data: AppData) => true | string;
  };
}

interface ToolScenario {
  /** The tests/chat scenario this replays. */
  name: string;
  fixture: string;
  setup?: (data: AppData) => AppData;
  steps: Step[];
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Same loader as tests/chat/run.ts. The scenario helpers' today is the UTC date, so the
// stored zone is UTC and both sides agree on what today is.
function loadFixture(name: string): AppData {
  const raw = JSON.parse(fs.readFileSync(path.join(rootDir, "tests/chat/fixtures", `${name}.json`), "utf-8"));
  delete raw._comment;
  return { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [], ...raw, timeZone: "UTC" };
}

const TODAY = todayISO();
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const entry = (data: AppData, itemId: string, date = TODAY) =>
  data.completionLog.find((e) => e.itemId === itemId && e.date === date);
const logged = (itemId: string, date = TODAY) => (data: AppData) =>
  check(!!entry(data, itemId, date), `expected ${itemId} logged for ${date}, got ${JSON.stringify(data.completionLog)}`);
const nothingLogged = (data: AppData) =>
  check(data.completionLog.length === 0, `completionLog should be empty, got ${JSON.stringify(data.completionLog)}`);

// --- §41 mark done (markDone.json) --------------------------------------------------------

// "Run" is due Sun/Tue/Thu/Sat; the latest past Mon/Wed/Fri is a day it isn't due.
const RUN_OFF_DAY = (() => {
  let date = YESTERDAY;
  while (![1, 3, 5].includes(dayOfWeek(date))) date = addDays(date, -1);
  return date;
})();

const s41: ToolScenario[] = [
  { name: "s41-mark-gym-done", fixture: "markDone", steps: [{ tool: "set_done", args: { name: "gym" }, expect: { status: "ok", data: logged("gym") } }] },
  {
    name: "s41-checklist-habit-yesterday",
    fixture: "markDone",
    steps: [
      {
        tool: "set_done",
        args: { name: "morning routine", date: YESTERDAY },
        expect: {
          status: "ok",
          data: (d) =>
            all(
              logged("routine", YESTERDAY)(d),
              check((entry(d, "routine", YESTERDAY)?.checklist ?? []).every((item) => item.checked), "every checklist item should be ticked"),
            ),
        },
      },
    ],
  },
  {
    name: "s41-numeric-full-goal",
    fixture: "markDone",
    steps: [{ tool: "set_done", args: { name: "drink water" }, expect: { status: "ok", data: (d) => check(entry(d, "water")?.value === 8, `expected 8, got ${entry(d, "water")?.value}`) } }],
  },
  {
    name: "s41-timer-full-goal",
    fixture: "markDone",
    steps: [{ tool: "set_done", args: { name: "meditate" }, expect: { status: "ok", data: (d) => check(entry(d, "meditate")?.value === 10, `expected 10, got ${entry(d, "meditate")?.value}`) } }],
  },
  {
    name: "s41-amount-still-logs-amount",
    fixture: "markDone",
    steps: [{ tool: "log_progress", args: { name: "drink water", value: 6 }, expect: { status: "ok", data: (d) => check(entry(d, "water")?.value === 6, `expected 6, got ${entry(d, "water")?.value}`) } }],
  },
  {
    name: "s41-future-day-refused",
    fixture: "markDone",
    steps: [{ tool: "set_done", args: { name: "gym", date: TOMORROW }, expect: { status: "rejected", text: /hasn't happened yet/, data: nothingLogged } }],
  },
  {
    name: "s41-not-due-day-refused",
    fixture: "markDone",
    steps: [{ tool: "set_done", args: { name: "run", date: RUN_OFF_DAY }, expect: { status: "rejected", text: /isn't due/, data: nothingLogged } }],
  },
  {
    name: "s41-undo",
    fixture: "markDone",
    steps: [
      { tool: "set_done", args: { name: "gym" }, expect: { status: "ok", data: logged("gym") } },
      { tool: "set_done", args: { name: "gym", done: false }, expect: { status: "ok", data: nothingLogged } },
    ],
  },
  {
    name: "s41-recurring-task",
    fixture: "markDone",
    steps: [{ tool: "set_done", args: { name: "water the plants" }, expect: { status: "ok", data: logged("plants") } }],
  },
  {
    name: "s41-single-task-still-works",
    fixture: "markDone",
    steps: [
      {
        tool: "set_done",
        args: { name: "buy milk" },
        expect: { status: "ok", data: (d) => check(d.singleTasks.find((t) => t.id === "milk")?.done === true, "Buy milk should be done") },
      },
    ],
  },
];

// --- §29 future dates (baseline.json) ------------------------------------------------------

const passport = (data: AppData) => data.singleTasks.find((task) => task.id === "passport");
const passportUntouched = (data: AppData) =>
  all(
    check(passport(data)?.done === false, "the task should not be done"),
    check(passport(data)?.startDate === "2030-01-05", "the task should not have moved"),
  );

const s29: ToolScenario[] = [
  {
    name: "s29-log-future-day-refused",
    fixture: "baseline",
    steps: [{ tool: "log_progress", args: { name: "push-ups", value: 20, date: TOMORROW }, expect: { status: "rejected", text: /hasn't happened yet/, data: nothingLogged } }],
  },
  {
    name: "s29-log-today-still-works",
    fixture: "baseline",
    steps: [
      {
        tool: "log_progress",
        args: { name: "push-ups", value: 20 },
        expect: { status: "ok", data: (d) => check(d.completionLog.some((e) => e.date === TODAY && e.value === 20), `expected 20 today, got ${JSON.stringify(d.completionLog)}`) },
      },
    ],
  },
  {
    name: "s29-future-task-asks-then-moves",
    fixture: "baseline",
    steps: [
      { tool: "set_done", args: { name: "renew passport" }, expect: { status: "needs_confirm", text: /move it to today/, data: passportUntouched } },
      {
        tool: "set_done",
        args: { ids: ["passport"], moveToToday: true },
        expect: {
          status: "ok",
          data: (d) =>
            all(
              check(passport(d)?.done === true, "the task should be done after confirming"),
              check(passport(d)?.startDate === TODAY, `the task should have moved to today, got ${passport(d)?.startDate}`),
            ),
        },
      },
    ],
  },
  {
    // "no" is Claude not calling again: the question alone changes nothing.
    name: "s29-future-task-declined",
    fixture: "baseline",
    steps: [{ tool: "set_done", args: { name: "renew passport" }, expect: { status: "needs_confirm", data: passportUntouched } }],
  },
];

// --- §31 confirmations (empty.json) --------------------------------------------------------

const s31: ToolScenario[] = [
  {
    name: "s31-bare-habit-assumes-defaults",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "habit", name: "Read", userMessage: "add a habit to read", category: "Study", dayPart: "evening", recurrence: "daily" },
        expect: {
          status: "ok",
          text: [/^Added habit "/, /Assumed: every day/, /Need any changes\?/],
          data: (d) =>
            all(
              check(d.habits.length === 1, `expected 1 habit, found ${d.habits.length}`),
              check(d.habits[0]?.recurrence.type === "daily", `expected daily, got ${d.habits[0] && describeRule(d.habits[0].recurrence)}`),
              check(d.habits[0]?.completionType === "yesno", `expected yesno, got ${d.habits[0]?.completionType}`),
            ),
        },
      },
    ],
  },
  {
    name: "s31-named-weekdays-stay-weekdays",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "habit",
          name: "Go running",
          userMessage: "add a habit to go running on Tuesday, Thursday, Saturday and Sunday",
          category: "Sports",
          dayPart: "morning",
          recurrence: "days:tue,thu,sat,sun",
        },
        expect: {
          status: "ok",
          text: /Repeats: every Sun, Tue, Thu, Sat/,
          data: (d) => check(!!d.habits[0] && isWeekdays(d.habits[0].recurrence, [0, 2, 4, 6]), `got ${d.habits[0] && describeRule(d.habits[0].recurrence)}`),
        },
      },
    ],
  },
  {
    name: "s31-value-habit-with-goal",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "habit",
          name: "Drink water",
          userMessage: "drink 8 glasses of water every day",
          category: "Nutrition",
          dayPart: "workDay",
          recurrence: "daily",
          completionType: "value",
          target: 8,
          unit: "glasses",
        },
        expect: {
          status: "ok",
          text: /Tracking: number — goal 8 glasses/,
          notText: /Assumed: every day/,
          data: (d) => all(check(d.habits[0]?.completionType === "value", "expected value"), check(d.habits[0]?.target === 8, "expected target 8")),
        },
      },
    ],
  },
];

// --- §32 disambiguation, §34 generic words, §35 word forms (baseline.json) -------------------

const nothingRescheduled = (data: AppData) => {
  const describe = (id: string) => JSON.stringify(data.habits.find((h) => h.id === id)?.recurrence);
  return check(
    describe("technical-reading") === '{"type":"daysOfWeek","days":[1,2,3,4,5]}' && describe("read-1") === '{"type":"daily"}' && describe("read-2") === '{"type":"daily"}',
    `no habit should have been rescheduled, got ${["technical-reading", "read-1", "read-2"].map(describe).join(", ")}`,
  );
};

const s32: ToolScenario[] = [
  {
    // Two number-tracked matches; the yes/no "Drink water" (Sports) isn't offered.
    name: "s32-log-lists-only-number-habits-then-pick-by-category",
    fixture: "baseline",
    steps: [
      {
        tool: "log_progress",
        args: { name: "water", value: 6 },
        expect: {
          status: "ambiguous",
          text: [/"water-nutrition"/, /"Nutrition"/, /"Test: Drink water"/],
          notText: /water-sports/,
          data: nothingLogged,
        },
      },
      {
        tool: "log_progress",
        args: { id: "water-nutrition", value: 6 },
        expect: { status: "ok", data: (d) => check(entry(d, "water-nutrition")?.value === 6, `expected 6, got ${entry(d, "water-nutrition")?.value}`) },
      },
    ],
  },
  {
    name: "s32-exact-name-wins-and-weekday-start",
    fixture: "baseline",
    steps: [
      {
        tool: "update_item",
        args: { name: "meditate", newStartWeekday: 1, newStartWeekdayMode: "next" },
        expect: {
          status: "ok",
          text: /^Updated "Meditate":/,
          data: (d) =>
            all(
              check(habitById(d, "meditate")?.startDate === nextWeekday(1), `expected ${nextWeekday(1)}, got ${habitById(d, "meditate")?.startDate}`),
              check(habitById(d, "meditate-test")?.startDate === "2026-09-01", "Test: Meditate should be unchanged"),
            ),
        },
      },
    ],
  },
  {
    name: "s32-identical-names-pick-by-number",
    fixture: "baseline",
    steps: [
      // The model may guess the wrong kind; the habits are still found.
      { tool: "update_item", args: { name: "read", type: "recurringTask", newRecurrence: "days:mon,wed,fri" }, expect: { status: "ambiguous", text: /"read-1".*"read-2"/s, notText: /Technical Reading/, data: nothingRescheduled } },
      {
        tool: "update_item",
        args: { id: "read-2", newRecurrence: "days:mon,wed,fri" },
        expect: {
          status: "ok",
          text: /Repeats: every day → every Mon, Wed, Fri/,
          data: (d) =>
            all(
              check(isWeekdays(habitById(d, "read-2")!.recurrence, [1, 3, 5]), `read-2: ${describeRule(habitById(d, "read-2")!.recurrence)}`),
              check(habitById(d, "read-1")?.recurrence.type === "daily", "read-1 should still be daily"),
            ),
        },
      },
    ],
  },
  {
    name: "s32-duplicate-name-asks-first",
    fixture: "baseline",
    steps: [
      {
        tool: "create_item",
        args: { type: "habit", name: "Technical Reading", userMessage: "add a habit technical reading", category: "Study", dayPart: "evening", recurrence: "daily" },
        expect: { status: "needs_confirm", text: /You already have a habit called "Technical Reading".*Are you sure/s, data: (d) => check(habitsNamed(d, "technical reading").length === 1, "nothing created yet") },
      },
      {
        tool: "create_item",
        args: { type: "habit", name: "Technical Reading", userMessage: "add a habit technical reading", category: "Study", dayPart: "evening", recurrence: "daily", confirmDuplicate: true },
        expect: { status: "ok", text: /^Added habit "/, data: (d) => check(habitsNamed(d, "technical reading").length === 2, "confirmed: now 2") },
      },
    ],
  },
  {
    name: "s34-generic-dentist-task",
    fixture: "baseline",
    steps: [
      {
        tool: "set_done",
        args: { name: "my dentist task" },
        expect: { status: "ok", data: (d) => check(d.singleTasks.find((t) => t.id === "dentist")?.done === true, `"Call the dentist" should be done`) },
      },
    ],
  },
  {
    // Two "Read" habits plus "Technical Reading": the answer is the question, never a silent edit.
    name: "s35-stem-reading-habit",
    fixture: "baseline",
    steps: [{ tool: "update_item", args: { name: "reading", newRecurrence: "days:mon" }, expect: { status: "ambiguous", text: /technical-reading/, data: nothingRescheduled } }],
  },
  {
    name: "s35-stem-meditation",
    fixture: "baseline",
    steps: [{ tool: "log_progress", args: { name: "meditation", value: 20 }, expect: { status: "ambiguous", text: [/"meditate"/, /"meditate-test"/], data: nothingLogged } }],
  },
];

// --- §50 first due (empty.json) ------------------------------------------------------------

const FIRST = addDays(TODAY, 3);
const MOVED = addDays(TODAY, 5);
const dateText = (dateISO: string) => formatDate(dateISO, TODAY);

const s50: ToolScenario[] = [
  {
    name: "s50-first-due-then-next-due",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "recurringTask",
          name: "Take out the bins",
          userMessage: `add a recurring task to take out the bins every ${WEEKDAY_NAMES[dayOfWeek(FIRST)]}`,
          dayPart: "evening",
          recurrence: `days:${WEEKDAYS[dayOfWeek(FIRST)]}`,
        },
        expect: {
          status: "ok",
          text: [`First due: ${dateText(FIRST)}`, `first due ${dateText(FIRST)}`],
          notText: [/Starts:/, /starting today/],
          data: (d) =>
            all(
              check(!!d.recurringTasks[0] && isWeekdays(d.recurringTasks[0].recurrence, [dayOfWeek(FIRST)]), `rule: ${JSON.stringify(d.recurringTasks[0]?.recurrence)}`),
              check(d.recurringTasks[0]?.startDate === TODAY, `expected to start today, got ${d.recurringTasks[0]?.startDate}`),
            ),
        },
      },
      {
        tool: "update_item",
        args: { name: "bins", newRecurrence: `days:${WEEKDAYS[dayOfWeek(MOVED)]}` },
        expect: {
          status: "ok",
          text: `Next due: ${dateText(FIRST)} → ${dateText(MOVED)}`,
          data: (d) => check(!!d.recurringTasks[0] && isWeekdays(d.recurringTasks[0].recurrence, [dayOfWeek(MOVED)]), `rule: ${JSON.stringify(d.recurringTasks[0]?.recurrence)}`),
        },
      },
    ],
  },
  {
    name: "s50-daily-still-starts-today",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "habit", name: "Read", userMessage: "add a habit to read every day", category: "Study", dayPart: "evening", recurrence: "daily" },
        expect: { status: "ok", text: [/Starts: today/, /starting today/], notText: /First due/ },
      },
    ],
  },
];

// --- §53 task categories (empty.json) ------------------------------------------------------

const SELF_CARE = { id: "c-selfcare", name: "Self-care", icon: "heart", isDefault: false };

const s53: ToolScenario[] = [
  {
    name: "s53-single-task-named-category",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Pay rent", userMessage: "add a task to pay rent, Finance category", category: "Finance", dayPart: "workDay" },
        expect: { status: "ok", text: [/^Added task "/, /Category: Finance/], data: (d) => check(d.singleTasks[0]?.categoryId === "finance", `got ${d.singleTasks[0]?.categoryId}`) },
      },
    ],
  },
  {
    name: "s53-recurring-task-named-category",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "recurringTask",
          name: "Back up my laptop",
          userMessage: "add a recurring task to back up my laptop every Friday, in the Work category",
          category: "Work",
          dayPart: "workDay",
          recurrence: "days:fri",
        },
        expect: { status: "ok", text: /Category: Work/, notText: /no category/, data: (d) => check(d.recurringTasks[0]?.categoryId === "work", `got ${d.recurringTasks[0]?.categoryId}`) },
      },
    ],
  },
  {
    name: "s53-single-task-custom-category",
    fixture: "empty",
    setup: (data) => ({ ...data, categories: [...data.categories, SELF_CARE] }),
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Book a massage", userMessage: "add a task to book a massage, selfcare category", category: "selfcare", dayPart: "afternoon" },
        expect: { status: "ok", text: /Category: Self-care/, data: (d) => check(d.singleTasks[0]?.categoryId === SELF_CARE.id, `got ${d.singleTasks[0]?.categoryId}`) },
      },
    ],
  },
  {
    name: "s53-single-task-no-category",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Buy milk", userMessage: "add a task to buy milk", dayPart: "afternoon" },
        expect: { status: "ok", notText: /Category/, data: (d) => check(!!d.singleTasks[0] && d.singleTasks[0].categoryId === undefined, `got ${d.singleTasks[0]?.categoryId}`) },
      },
    ],
  },
];

// --- §54 parts of the day (empty.json) -----------------------------------------------------

const dayPartsSetup = (data: AppData): AppData => ({
  ...data,
  habits: [
    { kind: "habit", id: "h-read", name: "Read", categoryId: "study", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "morning" },
    { kind: "habit", id: "h-gym", name: "Gym", categoryId: "sports", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "afternoon" },
    { kind: "habit", id: "h-floss", name: "Floss", categoryId: "health", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "bedtime", important: true },
    { kind: "habit", id: "h-old", name: "Journal", categoryId: "other", priority: 1, startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno" },
  ],
  singleTasks: [{ kind: "singleTask", id: "t-bank", name: "Call the bank", startDate: TODAY, done: false, persistency: true, dayPart: "workDay" }],
});
const habitIn = (data: AppData, id: string) => data.habits.find((h) => h.id === id);
const fourAndOne = (data: AppData) => check(data.habits.length === 4 && data.singleTasks.length === 1, `items changed: ${data.habits.length} habits, ${data.singleTasks.length} tasks`);

const s54: ToolScenario[] = [
  {
    name: "s54-create-stated-part",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "habit", name: "Brush teeth", userMessage: "add a habit to brush my teeth first thing when I get up", category: "Health", dayPart: "wakeUp", recurrence: "daily" },
        expect: { status: "ok", text: /Part of day: Wake-up/, notText: /part of day Wake-up/, data: (d) => check(d.habits[0]?.dayPart === "wakeUp", `stored in ${d.habits[0]?.dayPart}`) },
      },
    ],
  },
  {
    name: "s54-create-before-bed",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "habit", name: "Floss", userMessage: "add a habit to floss every night before bed", category: "Health", dayPart: "bedtime", recurrence: "daily" },
        expect: { status: "ok", text: /Part of day: Bedtime/, data: (d) => check(d.habits[0]?.dayPart === "bedtime", `stored in ${d.habits[0]?.dayPart}`) },
      },
    ],
  },
  {
    name: "s54-create-assistant-picks",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Call the dentist", userMessage: "add a task to call the dentist tomorrow", dayPart: "workDay", startDate: TOMORROW },
        expect: { status: "ok", text: [/Part of day: Work day/, /Assumed: .*part of day/], data: (d) => check(isDayPart(d.singleTasks[0]?.dayPart), `no part: ${d.singleTasks[0]?.dayPart}`) },
      },
    ],
  },
  {
    name: "s54-create-important",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Renew my passport", userMessage: "add an important task to renew my passport tomorrow morning", dayPart: "morning", important: true, startDate: TOMORROW },
        expect: {
          status: "ok",
          text: [/Part of day: Morning/, /Important: yes/],
          data: (d) => all(check(d.singleTasks[0]?.dayPart === "morning", `in ${d.singleTasks[0]?.dayPart}`), check(d.singleTasks[0]?.important === true, "not important")),
        },
      },
    ],
  },
  {
    name: "s54-move-to-evening",
    fixture: "empty",
    setup: dayPartsSetup,
    steps: [
      {
        tool: "update_item",
        args: { name: "reading", newDayPart: "evening" },
        expect: { status: "ok", text: /Part of day: Morning → Evening/, data: (d) => all(fourAndOne(d), check(habitIn(d, "h-read")?.dayPart === "evening", `Read is in ${habitIn(d, "h-read")?.dayPart}`)) },
      },
    ],
  },
  {
    name: "s54-place-unplaced",
    fixture: "empty",
    setup: dayPartsSetup,
    steps: [
      {
        tool: "update_item",
        args: { name: "journal", newDayPart: "bedtime" },
        expect: { status: "ok", text: /Part of day: Not placed yet → Bedtime/, data: (d) => all(fourAndOne(d), check(habitIn(d, "h-old")?.dayPart === "bedtime", `in ${habitIn(d, "h-old")?.dayPart}`)) },
      },
    ],
  },
  {
    name: "s54-mark-important",
    fixture: "empty",
    setup: dayPartsSetup,
    steps: [
      {
        tool: "update_item",
        args: { name: "gym", newImportant: true },
        expect: {
          status: "ok",
          text: /Important: no → yes/,
          data: (d) => all(fourAndOne(d), check(isImportant(habitIn(d, "h-gym")!), "Gym isn't flagged"), check(habitIn(d, "h-gym")?.dayPart === "afternoon", "Gym moved")),
        },
      },
    ],
  },
  {
    name: "s54-unmark-important",
    fixture: "empty",
    setup: dayPartsSetup,
    steps: [
      {
        tool: "update_item",
        args: { name: "floss", newImportant: false },
        expect: { status: "ok", text: /Important: yes → no/, data: (d) => all(fourAndOne(d), check(!isImportant(habitIn(d, "h-floss")!), "Floss still flagged")) },
      },
    ],
  },
  {
    name: "s54-move-task-to-work-day",
    fixture: "empty",
    setup: (data) => {
      const next = dayPartsSetup(data);
      return { ...next, singleTasks: next.singleTasks.map((task) => ({ ...task, dayPart: "evening" as const })) };
    },
    steps: [
      {
        tool: "update_item",
        args: { name: "call the bank", newDayPart: "workDay" },
        expect: { status: "ok", data: (d) => all(fourAndOne(d), check(d.singleTasks[0]?.dayPart === "workDay", `in ${d.singleTasks[0]?.dayPart}`)) },
      },
    ],
  },
];

// --- §55 clearing fields (empty.json) ------------------------------------------------------

const clearSetup = (data: AppData): AppData => ({
  ...data,
  singleTasks: [
    { kind: "singleTask", id: "t-reply", name: "Reply to Family", description: "Ask about the summer trip", categoryId: "social", priority: 0, startDate: TODAY, done: false, persistency: true },
    { kind: "singleTask", id: "t-shop", name: "Go shopping", priority: 0, startDate: TODAY, done: false, persistency: true, checklist: [{ id: "c1", text: "milk", checked: false }] },
  ],
  recurringTasks: [
    { kind: "recurringTask", id: "r-plants", name: "Water the plants", description: "Front balcony too", categoryId: "home", priority: 1, startDate: TODAY, recurrence: { type: "daysOfWeek", days: [6] } },
  ],
  habits: [
    { kind: "habit", id: "h-run", name: "Morning run", description: "Before breakfast", categoryId: "sports", priority: 1, startDate: TODAY, endDate: addDays(TODAY, 60), recurrence: { type: "daily" }, completionType: "yesno" },
  ],
});
const replyTask = (d: AppData) => d.singleTasks.find((t) => t.id === "t-reply");
const plants = (d: AppData) => d.recurringTasks.find((t) => t.id === "r-plants");
const morningRun = (d: AppData) => d.habits.find((h) => h.id === "h-run");
const allThere = (d: AppData) =>
  check(d.singleTasks.length === 2 && d.recurringTasks.length === 1 && d.habits.length === 1, `an item went missing`);
const clear = (name: string, args: Record<string, unknown>, expect: Step["expect"]): ToolScenario => ({
  name,
  fixture: "empty",
  setup: clearSetup,
  steps: [{ tool: "update_item", args, expect: { status: "ok", ...expect } }],
});

const s55: ToolScenario[] = [
  clear("s55-remove-comments-single-task", { name: "Reply to Family", newDescription: "" }, {
    text: /Note: Ask about the summer trip → none/,
    data: (d) => all(allThere(d), check(replyTask(d)?.description === undefined, `still "${replyTask(d)?.description}"`)),
  }),
  clear("s55-clear-notes-recurring-task", { name: "water the plants", newDescription: "" }, {
    data: (d) => all(allThere(d), check(plants(d)?.description === undefined, `still "${plants(d)?.description}"`)),
  }),
  clear("s55-delete-description-habit", { name: "morning run", newDescription: "" }, {
    data: (d) => all(allThere(d), check(morningRun(d)?.description === undefined, `still "${morningRun(d)?.description}"`)),
  }),
  clear("s55-remove-end-date-habit", { name: "morning run", newEndDate: "" }, {
    text: /Ends: .* → none/,
    data: (d) => all(allThere(d), check(morningRun(d)?.endDate === undefined, `still ${morningRun(d)?.endDate}`)),
  }),
  clear("s55-remove-category-single-task", { name: "Reply to Family", newCategory: "" }, {
    text: /Category: Social → none/,
    data: (d) => all(allThere(d), check(replyTask(d)?.categoryId === undefined, `still ${replyTask(d)?.categoryId}`)),
  }),
  clear("s55-remove-category-recurring-task", { name: "water the plants", newCategory: "" }, {
    data: (d) => all(allThere(d), check(plants(d)?.categoryId === undefined, `still ${plants(d)?.categoryId}`)),
  }),
  // A habit always has a category: moved to Other, never left with none.
  clear("s55-habit-category-never-none", { name: "morning run", newCategory: "" }, {
    notText: /→ none/,
    data: (d) => all(allThere(d), check(["sports", "other"].includes(morningRun(d)?.categoryId ?? ""), `got ${morningRun(d)?.categoryId}`)),
  }),
];

// --- §57 a task's day by weekday (empty.json) ----------------------------------------------

const IN_THREE_DAYS = addDays(TODAY, 3);
const IN_A_WEEK = addDays(TODAY, 7);
const onlyTaskOn = (expected: string) => (d: AppData) =>
  all(check(d.singleTasks.length === 1, `expected 1 task, found ${d.singleTasks.length}`), check(d.singleTasks[0]?.startDate === expected, `expected ${expected}, got ${d.singleTasks[0]?.startDate}`));
const weekdayTask = (name: string, userMessage: string, weekday: number, mode: "next" | "closest", extra: Record<string, unknown> = {}) => ({
  type: "singleTask",
  name,
  userMessage,
  dayPart: "afternoon",
  startWeekday: weekday,
  startWeekdayMode: mode,
  ...extra,
});

const s57: ToolScenario[] = [
  {
    // The app's version also expects no "Assumed:" line; here the part of the day, which
    // Claude must always pick, is flagged as assumed since the message names no time. The
    // date mustn't be.
    name: "s57-next-weekday-with-category-and-one-day",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: weekdayTask(
          "Ingress battle beacons",
          `add a task for next ${WEEKDAY_NAMES[dayOfWeek(IN_THREE_DAYS)]}, just that day, called ingress battle beacons, in the social category.`,
          dayOfWeek(IN_THREE_DAYS),
          "next",
          { category: "social", carriesOver: false },
        ),
        expect: {
          status: "ok",
          text: [`Date: ${dateText(IN_THREE_DAYS)}`, /Category: Social/, /dropped at the end of the day/],
          notText: [/Assumed: .*due today/, /Date: today/],
          data: (d) =>
            all(
              onlyTaskOn(IN_THREE_DAYS)(d),
              check(d.singleTasks[0]?.categoryId === "social", `got ${d.singleTasks[0]?.categoryId}`),
              check(d.singleTasks[0]?.persistency === false, `persistency ${d.singleTasks[0]?.persistency}`),
            ),
        },
      },
    ],
  },
  {
    name: "s57-on-weekday",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: weekdayTask("Call the dentist", `add a task on ${WEEKDAY_NAMES[dayOfWeek(IN_THREE_DAYS)]} to call the dentist`, dayOfWeek(IN_THREE_DAYS), "closest"),
        expect: { status: "ok", text: `Date: ${dateText(IN_THREE_DAYS)}`, notText: /due today/, data: onlyTaskOn(IN_THREE_DAYS) },
      },
    ],
  },
  {
    name: "s57-next-same-weekday-is-a-week-out",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: weekdayTask("Renew my passport", `add a task for next ${WEEKDAY_NAMES[dayOfWeek(TODAY)]} to renew my passport`, dayOfWeek(TODAY), "next"),
        expect: { status: "ok", text: `Date: ${dateText(IN_A_WEEK)}`, data: onlyTaskOn(IN_A_WEEK) },
      },
    ],
  },
  {
    name: "s57-tomorrow-still-works",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Call the dentist", userMessage: "add a task to call the dentist tomorrow", dayPart: "workDay", startDate: TOMORROW },
        expect: { status: "ok", text: /Date: tomorrow/, data: onlyTaskOn(TOMORROW) },
      },
    ],
  },
];

// --- Phase 4: §28 pause (baseline.json) -----------------------------------------------------

const journal = (d: AppData) => d.habits.find((habit) => habit.id === "journal");
const journalPauses = (d: AppData) => journal(d)?.pauses ?? [];
const TWO_WEEKS = addDays(TODAY, 14);

const s28: ToolScenario[] = [
  {
    name: "s28-pause-for-a-window",
    fixture: "baseline",
    steps: [
      {
        tool: "schedule",
        args: { op: "pause", name: "journal", resumeOn: TWO_WEEKS },
        expect: {
          status: "ok",
          text: /Paused "Journal"/,
          data: (d) => {
            const [pause, ...rest] = journalPauses(d);
            return all(
              check(!!pause && rest.length === 0, "exactly one pause should be stored"),
              check(pause?.from === TODAY && pause?.resumeOn === TWO_WEEKS, `got ${JSON.stringify(pause)}`),
              check(!occursOn(journal(d)!, addDays(TODAY, 3)), "should not be due mid-pause"),
            );
          },
        },
      },
    ],
  },
  {
    name: "s28-pause-open-ended",
    fixture: "baseline",
    steps: [
      {
        tool: "schedule",
        args: { op: "pause", name: "journal" },
        expect: {
          status: "ok",
          text: /no occurrences until you ask me to resume it/,
          data: (d) =>
            all(
              check(journalPauses(d)[0]?.resumeOn === undefined, "an open-ended pause has no resume date"),
              check(!occursOn(journal(d)!, addDays(TODAY, 200)), "should stay paused"),
            ),
        },
      },
    ],
  },
  {
    name: "s28-resume-brings-it-back",
    fixture: "baseline",
    steps: [
      { tool: "schedule", args: { op: "pause", name: "journal" }, expect: { status: "ok" } },
      { tool: "schedule", args: { op: "resume", name: "journal" }, expect: { status: "ok", data: (d) => check(occursOn(journal(d)!, TODAY), "due again today") } },
    ],
  },
  {
    // The app's own guard, whatever the model sends.
    name: "s28-no-backdated-pause-explicit",
    fixture: "baseline",
    steps: [
      {
        tool: "schedule",
        args: { op: "pause", name: "journal", from: addDays(TODAY, -30), resumeOn: addDays(TODAY, 30) },
        expect: { status: "rejected", text: /only pause from today onwards/, data: (d) => check(journalPauses(d).length === 0, "nothing stored") },
      },
    ],
  },
];

// --- Phase 4: checklists (§39, §42, §56, multiple add, §32/§34 shopping list) ---------------

const listTexts = (checklist: { text: string }[] | undefined) =>
  (checklist ?? []).map((item) => item.text.toLowerCase()).sort().join(",");
const shopping = (d: AppData) => d.recurringTasks.find((task) => task.id === "shopping");

const checklists: ToolScenario[] = [
  {
    name: "checklist-add-two-to-new-task",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Go shopping", userMessage: "Add a go shopping task with a checklist inside.", dayPart: "afternoon", withChecklist: true },
        expect: { status: "ok", text: /Checklist: empty for now/ },
      },
      {
        tool: "checklist",
        args: { op: "add", name: "shopping list", items: ["milk", "bread"] },
        expect: { status: "ok", text: /Added "milk" and "bread"/, data: (d) => check(listTexts(d.singleTasks[0]?.checklist) === "bread,milk", `got ${listTexts(d.singleTasks[0]?.checklist)}`) },
      },
    ],
  },
  {
    name: "checklist-add-three-to-existing",
    fixture: "baseline",
    steps: [
      {
        tool: "checklist",
        args: { op: "add", name: "my weekly shopping list", items: ["eggs", "coffee", "apples"] },
        expect: { status: "ok", data: (d) => check(["apples", "coffee", "eggs"].every((item) => listTexts(shopping(d)?.checklist).includes(item)), `got ${listTexts(shopping(d)?.checklist)}`) },
      },
    ],
  },
  ...["my shopping list", "the shopping list", "weekly shopping list"].map(
    (name, index): ToolScenario => ({
      name: index === 0 ? "s32-checklist-add-to-task" : `s34-generic-${name.replace(/ /g, "-")}`,
      fixture: "baseline",
      steps: [
        {
          tool: "checklist",
          args: { op: "add", name, items: ["milk"] },
          expect: { status: "ok", text: /Added "milk" to "Weekly shopping"/, data: (d) => check(listTexts(shopping(d)?.checklist).includes("milk"), "milk missing") },
        },
      ],
    }),
  ),
  {
    name: "s39-single-task-empty-checklist",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Go Shopping", userMessage: "Add a task for Friday called Go Shopping, with a checklist inside", dayPart: "afternoon", startWeekday: 5, withChecklist: true },
        expect: { status: "ok", text: /Checklist: empty for now/, data: (d) => check(d.singleTasks[0]?.checklist?.length === 0, "expected an empty checklist") },
      },
    ],
  },
  {
    name: "s39-recurring-task-seeded-checklist",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "recurringTask",
          name: "Go shopping",
          userMessage: "add a recurring task to go shopping every Saturday, with a checklist: milk, eggs and bread",
          dayPart: "morning",
          recurrence: "days:sat",
          checklistItems: ["milk", "eggs", "bread"],
        },
        expect: { status: "ok", text: /Checklist: /, data: (d) => check(listTexts(d.recurringTasks[0]?.checklist) === "bread,eggs,milk", `got ${listTexts(d.recurringTasks[0]?.checklist)}`) },
      },
    ],
  },
  {
    name: "s39-plain-task-has-no-checklist",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "singleTask", name: "Call the dentist", userMessage: "add a task to call the dentist tomorrow", dayPart: "workDay", startDate: TOMORROW },
        expect: { status: "ok", notText: /Checklist/, data: (d) => check(d.singleTasks[0]?.checklist === undefined, "a plain task got a checklist") },
      },
    ],
  },
  {
    name: "s42-default-carry-over",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: { type: "recurringTask", name: "Go shopping", userMessage: "add a recurring task to go shopping every Saturday, with a checklist: milk and eggs", dayPart: "morning", recurrence: "days:sat", checklistItems: ["milk", "eggs"] },
        expect: {
          status: "ok",
          text: [/Checklist mode: unticked items carry over/, /Assumed: .*unticked checklist items carry over/],
          data: (d) => check((d.recurringTasks[0]?.checklistMode ?? "carryOver") === "carryOver", `got ${d.recurringTasks[0]?.checklistMode}`),
        },
      },
    ],
  },
  {
    name: "s42-create-same-list",
    fixture: "empty",
    steps: [
      {
        tool: "create_item",
        args: {
          type: "recurringTask",
          name: "Cleaning routine",
          userMessage: "add a cleaning routine every Sunday with the same checklist every week: floors, windows and bathroom",
          dayPart: "morning",
          recurrence: "days:sun",
          checklistItems: ["floors", "windows", "bathroom"],
          checklistMode: "sameList",
        },
        expect: { status: "ok", text: /Checklist mode: same list every time/, notText: /Assumed: .*checklist/, data: (d) => check(d.recurringTasks[0]?.checklistMode === "sameList", `got ${d.recurringTasks[0]?.checklistMode}`) },
      },
    ],
  },
  {
    name: "s42-switch-to-same-list",
    fixture: "baseline",
    steps: [
      {
        tool: "update_item",
        args: { name: "weekly shopping", newChecklistMode: "sameList" },
        expect: { status: "ok", text: /Checklist mode: unticked items carry over to the next time → same list every time/, data: (d) => check(shopping(d)?.checklistMode === "sameList", "not sameList") },
      },
    ],
  },
  {
    name: "s42-tick-yesterday",
    fixture: "baseline",
    steps: [
      {
        tool: "checklist",
        args: { op: "tick", name: "weekly shopping list", items: ["eggs"], date: YESTERDAY },
        expect: { status: "ok", text: /Checked off "eggs"/, data: (d) => check(shopping(d)?.checklist?.find((i) => i.id === "eggs")?.doneOn === YESTERDAY, `got ${shopping(d)?.checklist?.find((i) => i.id === "eggs")?.doneOn}`) },
      },
    ],
  },
];

// §56 (empty.json with its own setup)
const LAST_WEEK = addDays(TODAY, -7);
const removalSetup = (data: AppData): AppData => ({
  ...data,
  singleTasks: [
    {
      kind: "singleTask", id: "t-shop", name: "Go shopping", priority: 1, startDate: TODAY, done: false, persistency: true,
      checklist: [
        { id: "c1", text: "milk", checked: false },
        { id: "c2", text: "eggs", checked: false },
        { id: "c3", text: "bread", checked: false },
      ],
    },
    { kind: "singleTask", id: "t-dentist", name: "Call the dentist", priority: 1, startDate: TODAY, done: false, persistency: true },
  ],
  recurringTasks: [
    {
      kind: "recurringTask", id: "r-clean", name: "Weekly cleaning", categoryId: "home", priority: 1, startDate: TODAY,
      recurrence: { type: "daysOfWeek", days: [6] }, checklistMode: "sameList",
      checklist: [
        { id: "k1", text: "floors", checked: false },
        { id: "k2", text: "windows", checked: false },
      ],
    },
  ],
  habits: [
    {
      kind: "habit", id: "h-routine", name: "Morning routine", categoryId: "health", priority: 1, startDate: LAST_WEEK,
      recurrence: { type: "daily" }, completionType: "checklist",
      checklist: [
        { id: "s1", text: "stretch", checked: false },
        { id: "s2", text: "floss", checked: false },
        { id: "s3", text: "meditate", checked: false },
      ],
    },
  ],
});
const shopTask = (d: AppData) => d.singleTasks.find((task) => task.id === "t-shop");
const cleaning = (d: AppData) => d.recurringTasks.find((task) => task.id === "r-clean");
const routine = (d: AppData) => d.habits.find((habit) => habit.id === "h-routine");
const joined = (items: { text: string }[] | undefined) => (items ?? []).map((item) => item.text).join(",");
const removalIntact = (d: AppData) => check(d.singleTasks.length === 2 && d.recurringTasks.length === 1 && d.habits.length === 1, "an item went missing");
const removal = (name: string, steps: Step[]): ToolScenario => ({ name, fixture: "empty", setup: removalSetup, steps });

const s56: ToolScenario[] = [
  removal("s56-remove-item-single-task", [
    {
      tool: "checklist",
      args: { op: "remove", name: "my shopping list", items: ["milk"] },
      expect: { status: "ok", text: [/Removed "milk" from "Go shopping"/, /Still on the list: eggs, bread/], data: (d) => all(removalIntact(d), check(joined(shopTask(d)?.checklist) === "eggs,bread", `list is ${joined(shopTask(d)?.checklist)}`)) },
    },
  ]),
  removal("s56-remove-several-items", [
    {
      tool: "checklist",
      args: { op: "remove", name: "shopping list", items: ["eggs", "bread"] },
      expect: { status: "ok", data: (d) => all(removalIntact(d), check(joined(shopTask(d)?.checklist) === "milk", `list is ${joined(shopTask(d)?.checklist)}`)) },
    },
  ]),
  removal("s56-remove-item-recurring-task", [
    {
      tool: "checklist",
      args: { op: "remove", name: "weekly cleaning checklist", items: ["windows"] },
      expect: { status: "ok", data: (d) => all(removalIntact(d), check(joined(recurringTaskChecklistOn(cleaning(d)!, TODAY)) === "floors", "windows still on today's list")) },
    },
  ]),
  removal("s56-remove-step-from-habit", [
    {
      tool: "checklist",
      args: { op: "remove", name: "morning routine", items: ["floss"] },
      expect: {
        status: "ok",
        data: (d) =>
          all(
            removalIntact(d),
            check(joined(currentHabitChecklist(routine(d)!)) === "stretch,meditate", `steps are ${joined(currentHabitChecklist(routine(d)!))}`),
            check(joined(habitChecklistOn(routine(d)!, YESTERDAY)) === "stretch,floss,meditate", "yesterday lost a step"),
          ),
      },
    },
  ]),
  removal("s56-replace-habit-steps", [
    {
      tool: "update_item",
      args: { name: "morning routine", newChecklistItems: ["stretch", "meditate", "journal"] },
      expect: {
        status: "ok",
        text: /apply from today on/,
        data: (d) =>
          all(
            removalIntact(d),
            check(joined(currentHabitChecklist(routine(d)!)) === "stretch,meditate,journal", `steps are ${joined(currentHabitChecklist(routine(d)!))}`),
            check(joined(habitChecklistOn(routine(d)!, YESTERDAY)) === "stretch,floss,meditate", "yesterday's steps changed"),
          ),
      },
    },
  ]),
  removal("s56-remove-checklist-confirmed", [
    {
      tool: "checklist",
      args: { op: "remove_all", name: "go shopping" },
      expect: { status: "needs_confirm", text: /Remove the checklist from "Go shopping"\? It has 3 items/, data: (d) => all(removalIntact(d), check(shopTask(d)?.checklist?.length === 3, "changed before the yes")) },
    },
    {
      tool: "checklist",
      args: { op: "remove_all", id: "t-shop", confirm: true },
      expect: { status: "ok", text: /Removed the checklist from "Go shopping"/, data: (d) => all(removalIntact(d), check(shopTask(d)?.checklist === undefined, "still there")) },
    },
  ]),
  removal("s56-check-off-is-not-remove", [
    {
      tool: "checklist",
      args: { op: "tick", name: "shopping list", items: ["milk"] },
      expect: { status: "ok", data: (d) => all(removalIntact(d), check(shopTask(d)?.checklist?.length === 3 && shopTask(d)?.checklist?.[0].checked === true, "milk should be ticked and still listed")) },
    },
  ]),
];

// --- Phase 4: §32 delete (baseline.json) ------------------------------------------------------

const s32Delete: ToolScenario[] = [
  {
    name: "s32-delete-lists-details-and-unrelated-reply-cancels",
    fixture: "baseline",
    steps: [
      {
        // "my test habits": Claude finds them (find_items "test") and passes both ids.
        tool: "delete_items",
        args: { ids: ["water-test", "meditate-test"] },
        expect: {
          status: "needs_confirm",
          text: [/Are you sure you want to delete these 2 habits\?/, /1\. "Test: /, /2\. "Test: /, /completion history/],
          data: (d) => check(!!habitById(d, "water-test") && !!habitById(d, "meditate-test"), "nothing deleted before the yes"),
        },
      },
      // An unrelated reply is Claude not calling again; a yes is this call.
      {
        tool: "delete_items",
        args: { ids: ["water-test", "meditate-test"], confirm: true },
        expect: { status: "ok", data: (d) => check(!habitById(d, "water-test") && !habitById(d, "meditate-test") && !d.completionLog.some((e) => e.itemId === "water-test"), "both gone, with history") },
      },
    ],
  },
];

// --- Runner ---------------------------------------------------------------------------------

const asList = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const matches = (text: string, pattern: TextMatch) => (typeof pattern === "string" ? text.includes(pattern) : pattern.test(text));

/** What Claude would read back: the app-written texts first, then the whole result (ids, candidates). */
function replyText(body: Record<string, unknown>): string {
  const results = (body.results as Record<string, unknown>[] | undefined) ?? [];
  const texts = [body.confirmation, body.question, body.message, body.reason, ...results.flatMap((r) => [r.question, r.reason])];
  return [...texts.filter((text): text is string => typeof text === "string"), JSON.stringify(body)].join("\n");
}

const scenarios = [...s41, ...s29, ...s31, ...s32, ...s50, ...s53, ...s54, ...s55, ...s57, ...s28, ...checklists, ...s56, ...s32Delete];
const failures: string[] = [];

for (const scenario of scenarios) {
  const initial = loadFixture(scenario.fixture);
  const store = memoryStore(scenario.setup ? scenario.setup(initial) : initial);
  for (const [index, step] of scenario.steps.entries()) {
    const where = `${scenario.name} step ${index + 1} (${step.tool})`;
    const { body } = await callTool({ store }, step.tool, step.args);
    const problems: string[] = [];
    const status = body.status;
    if (step.expect.status && status !== step.expect.status) problems.push(`status ${status}, expected ${step.expect.status}`);
    const text = replyText(body);
    for (const pattern of asList(step.expect.text)) if (!matches(text, pattern)) problems.push(`missing ${pattern}`);
    for (const pattern of asList(step.expect.notText)) if (matches(text, pattern)) problems.push(`unexpected ${pattern}`);
    const dataCheck = step.expect.data?.(store.file());
    if (dataCheck !== undefined && dataCheck !== true) problems.push(dataCheck);
    if (problems.length > 0) failures.push(`${where}: ${problems.join("; ")}\n    reply: ${text.split("\n")[0]}`);
  }
}

if (failures.length > 0) {
  console.error(`mcp scenarios: ${failures.length} failed\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`mcp scenarios: all ${scenarios.length} passed`);
