// §54: every item belongs to a part of the day instead of carrying a priority number. The
// assistant uses the part the user names, picks one itself otherwise (and the reply says it
// was assumed), and existing items can be moved or flagged important through chat.
import type { AppData } from "../../../src/types/models.ts";
import { isDayPart, isImportant } from "../../../src/lib/dayParts.ts";
import type { Scenario } from "../types.ts";
import { all, check, todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    { kind: "habit", id: "h-read", name: "Read", categoryId: "study", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "morning" },
    { kind: "habit", id: "h-gym", name: "Gym", categoryId: "sports", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "afternoon" },
    { kind: "habit", id: "h-floss", name: "Floss", categoryId: "health", startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno", dayPart: "bedtime", important: true },
    // From before §54: no part, and an old priority number.
    { kind: "habit", id: "h-old", name: "Journal", categoryId: "other", priority: 1, startDate: TODAY, recurrence: { type: "daily" }, completionType: "yesno" },
  ],
  singleTasks: [
    { kind: "singleTask", id: "t-bank", name: "Call the bank", startDate: TODAY, done: false, persistency: true, dayPart: "workDay" },
  ],
});

const habit = (data: AppData, id: string) => data.habits.find((h) => h.id === id);
const intact = (data: AppData) =>
  check(data.habits.length === 4 && data.singleTasks.length === 1, `an item went missing or was added: ${data.habits.length} habits, ${data.singleTasks.length} tasks`);

export const scenarios: Scenario[] = [
  {
    name: "s54-create-stated-part",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to brush my teeth first thing when I get up",
        expect: {
          toolCall: "createHabit",
          reply: /Part of day: Wake-up/,
          notReply: /part of day Wake-up/,
          data: (data) => check(data.habits[0]?.dayPart === "wakeUp", `stored in ${data.habits[0]?.dayPart}`),
        },
      },
    ],
  },
  {
    name: "s54-create-before-bed",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to floss every night before bed",
        expect: {
          toolCall: "createHabit",
          reply: /Part of day: Bedtime/,
          data: (data) => check(data.habits[0]?.dayPart === "bedtime", `stored in ${data.habits[0]?.dayPart}`),
        },
      },
    ],
  },
  {
    // Nothing said about when: the assistant still picks a part, without asking, and the
    // reply flags it as assumed.
    name: "s54-create-assistant-picks",
    fixture: "empty",
    turns: [
      {
        user: "add a task to call the dentist tomorrow",
        expect: {
          toolCall: "createSingleTask",
          reply: [/Part of day: (Wake-up|Morning|Work day|Afternoon|Evening|Bedtime)/, /Assumed: .*part of day/],
          data: (data) => check(isDayPart(data.singleTasks[0]?.dayPart), `no part stored: ${data.singleTasks[0]?.dayPart}`),
        },
      },
    ],
  },
  {
    name: "s54-create-important",
    fixture: "empty",
    turns: [
      {
        user: "add an important task to renew my passport tomorrow morning",
        expect: {
          toolCall: "createSingleTask",
          reply: [/Part of day: Morning/, /Important: yes/],
          data: (data) =>
            all(
              check(data.singleTasks[0]?.dayPart === "morning", `stored in ${data.singleTasks[0]?.dayPart}`),
              check(data.singleTasks[0]?.important === true, "not flagged important"),
            ),
        },
      },
    ],
  },
  {
    name: "s54-move-to-evening",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "move reading to the evening",
        expect: {
          toolCall: "updateHabit",
          reply: /Part of day: Morning → Evening/,
          data: (data) => all(intact(data), check(habit(data, "h-read")?.dayPart === "evening", `Read is in ${habit(data, "h-read")?.dayPart}`)),
        },
      },
    ],
  },
  {
    // An item from before §54 gets placed.
    name: "s54-place-unplaced",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "put journal just before bed",
        expect: {
          toolCall: "updateHabit",
          reply: /Part of day: Not placed yet → Bedtime/,
          data: (data) => all(intact(data), check(habit(data, "h-old")?.dayPart === "bedtime", `Journal is in ${habit(data, "h-old")?.dayPart}`)),
        },
      },
    ],
  },
  {
    name: "s54-mark-important",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "gym is a top priority",
        expect: {
          toolCall: "updateHabit",
          reply: /Important: no → yes/,
          data: (data) =>
            all(
              intact(data),
              check(isImportant(habit(data, "h-gym")!), "Gym isn't flagged"),
              check(habit(data, "h-gym")?.dayPart === "afternoon", "Gym moved"),
            ),
        },
      },
    ],
  },
  {
    name: "s54-unmark-important",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "floss isn't that important any more",
        expect: {
          toolCall: "updateHabit",
          reply: /Important: yes → no/,
          data: (data) => all(intact(data), check(!isImportant(habit(data, "h-floss")!), "Floss is still flagged")),
        },
      },
    ],
  },
  {
    name: "s54-move-task-to-work-day",
    fixture: "empty",
    setup: (data) => {
      const next = setup(data);
      return { ...next, singleTasks: next.singleTasks.map((task) => ({ ...task, dayPart: "evening" as const })) };
    },
    turns: [
      {
        user: "I'll call the bank during work hours instead",
        expect: {
          toolCall: "updateSingleTask",
          data: (data) => all(intact(data), check(data.singleTasks[0]?.dayPart === "workDay", `the task is in ${data.singleTasks[0]?.dayPart}`)),
        },
      },
    ],
  },
];
