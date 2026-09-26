// §41: marking a habit or recurring task done / not done through chat, with replies that
// spell out what was recorded. Dates are computed from the real today, since the runner's
// clock is the real clock. Fixture: markDone.json.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { addDays, dayOfWeek } from "../../../src/lib/recurrence.ts";
import { all, check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
// "Run" is due Sun/Tue/Thu/Sat; the latest past Mon/Wed/Fri is a day it isn't due.
const RUN_OFF_DAY = (() => {
  let date = YESTERDAY;
  while (![1, 3, 5].includes(dayOfWeek(date))) date = addDays(date, -1);
  return date;
})();

const entry = (data: AppData, itemId: string, date = TODAY) =>
  data.completionLog.find((e) => e.itemId === itemId && e.date === date);
const logged = (data: AppData, itemId: string, date = TODAY) =>
  check(!!entry(data, itemId, date), `expected ${itemId} logged for ${date}, got ${JSON.stringify(data.completionLog)}`);
const nothingLogged = (data: AppData) =>
  check(data.completionLog.length === 0, `completionLog should be empty, got ${JSON.stringify(data.completionLog)}`);

const SET_HABIT = "setHabitDone";

export const scenarios: Scenario[] = [
  {
    name: "s41-mark-gym-done",
    fixture: "markDone",
    turns: [
      {
        user: "mark gym done",
        expect: { toolCall: SET_HABIT, reply: [/Marked "Gym" complete for today/, /Current streak: 1 day/], data: (d) => logged(d, "gym") },
      },
    ],
  },
  {
    name: "s41-went-to-the-gym",
    fixture: "markDone",
    turns: [{ user: "I went to the gym today", expect: { toolCall: SET_HABIT, data: (d) => logged(d, "gym") } }],
  },
  {
    name: "s41-checklist-habit-yesterday",
    fixture: "markDone",
    turns: [
      {
        user: "I did my morning routine yesterday",
        expect: {
          toolCall: SET_HABIT,
          reply: /by marking all checklist items done: Stretch, Journal/,
          data: (d) =>
            all(
              logged(d, "routine", YESTERDAY),
              check(
                (entry(d, "routine", YESTERDAY)?.checklist ?? []).every((item) => item.checked),
                "every checklist item should be ticked",
              ),
            ),
        },
      },
    ],
  },
  {
    name: "s41-numeric-full-goal",
    fixture: "markDone",
    turns: [
      {
        user: "mark drink water as done",
        expect: {
          toolCall: SET_HABIT,
          reply: /with 8 glasses, its full goal/,
          data: (d) => check(entry(d, "water")?.value === 8, `expected 8 glasses, got ${entry(d, "water")?.value}`),
        },
      },
    ],
  },
  {
    name: "s41-timer-full-goal",
    fixture: "markDone",
    turns: [
      {
        user: "I meditated today",
        expect: {
          toolCall: SET_HABIT,
          reply: /with 10 min, its full goal/,
          data: (d) => check(entry(d, "meditate")?.value === 10, `expected 10 minutes, got ${entry(d, "meditate")?.value}`),
        },
      },
    ],
  },
  {
    // A stated amount must still log that amount, not the full goal.
    name: "s41-amount-still-logs-amount",
    fixture: "markDone",
    turns: [
      {
        user: "I drank 6 glasses of water",
        expect: {
          toolCall: "logHabitProgress",
          data: (d) => check(entry(d, "water")?.value === 6, `expected 6 glasses, got ${entry(d, "water")?.value}`),
        },
      },
    ],
  },
  {
    name: "s41-future-day-refused",
    fixture: "markDone",
    turns: [{ user: `mark gym done for ${TOMORROW}`, expect: { reply: /hasn't happened yet/, data: nothingLogged } }],
  },
  {
    name: "s41-not-due-day-refused",
    fixture: "markDone",
    turns: [{ user: `mark run done for ${RUN_OFF_DAY}`, expect: { reply: /isn't due/, data: nothingLogged } }],
  },
  {
    name: "s41-undo",
    fixture: "markDone",
    turns: [
      { user: "mark gym done", expect: { toolCall: SET_HABIT, data: (d) => logged(d, "gym") } },
      { user: "actually I didn't go, undo that", expect: { reply: /Marked "Gym" not done for today/, data: nothingLogged } },
    ],
  },
  {
    name: "s41-recurring-task",
    fixture: "markDone",
    turns: [
      {
        user: "I watered the plants",
        expect: { toolCall: "setRecurringTaskDone", reply: /Marked "Water the plants" done for today/, data: (d) => logged(d, "plants") },
      },
    ],
  },
  {
    // One-off tasks keep their own done/not-done path.
    name: "s41-single-task-still-works",
    fixture: "markDone",
    turns: [
      {
        user: "mark buy milk done",
        expect: {
          data: (d) => check(d.singleTasks.find((t) => t.id === "milk")?.done === true, "Buy milk should be done"),
        },
      },
    ],
  },
];
