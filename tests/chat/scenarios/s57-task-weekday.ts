// §57: a one-off task's day given by weekday ("a task for next Thursday") is created on
// that day. createSingleTask had no startWeekday field, so the model — told never to
// work a date out of a weekday itself — sent no date and the task landed on today.
// Weekdays are picked from the real today.
import { formatDate } from "../../../src/lib/confirmations.ts";
import { addDays, dayOfWeek } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, todayISO } from "./helpers.ts";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TODAY = todayISO();
const IN_THREE_DAYS = addDays(TODAY, 3);
const IN_A_WEEK = addDays(TODAY, 7);
const TOMORROW = addDays(TODAY, 1);
const name = (dateISO: string) => WEEKDAY_NAMES[dayOfWeek(dateISO)];
const onDate = (data: AppData, expected: string) => {
  const task = data.singleTasks[0];
  return all(
    check(data.singleTasks.length === 1, `expected 1 task, found ${data.singleTasks.length}`),
    check(task?.startDate === expected, `expected ${expected}, got ${task?.startDate}`),
  );
};

export const scenarios: Scenario[] = [
  {
    // The sentence from the bug report, with its weekday moved to three days from today.
    name: "s57-next-weekday-with-category-and-one-day",
    fixture: "empty",
    turns: [
      {
        user: `add a task for next ${name(IN_THREE_DAYS)}, just that day, called ingress battle beacons, in the social category.`,
        expect: {
          toolCall: "createSingleTask",
          reply: [`Date: ${formatDate(IN_THREE_DAYS, TODAY)}`, /Category: Social/, /dropped at the end of the day/],
          notReply: [/Assumed/, /Date: today/],
          data: (data) => {
            const task = data.singleTasks[0];
            return all(
              onDate(data, IN_THREE_DAYS),
              check(task?.categoryId === "social", `expected social, got ${task?.categoryId}`),
              check(task?.persistency === false, `expected a one-day task, got persistency ${task?.persistency}`),
            );
          },
        },
      },
    ],
  },
  {
    name: "s57-on-weekday",
    fixture: "empty",
    turns: [
      {
        user: `add a task on ${name(IN_THREE_DAYS)} to call the dentist`,
        expect: {
          toolCall: "createSingleTask",
          reply: `Date: ${formatDate(IN_THREE_DAYS, TODAY)}`,
          notReply: /Assumed/,
          data: (data) => onDate(data, IN_THREE_DAYS),
        },
      },
    ],
  },
  {
    // "Next <today's weekday>" is a week out, never today.
    name: "s57-next-same-weekday-is-a-week-out",
    fixture: "empty",
    turns: [
      {
        user: `add a task for next ${name(TODAY)} to renew my passport`,
        expect: {
          toolCall: "createSingleTask",
          reply: `Date: ${formatDate(IN_A_WEEK, TODAY)}`,
          data: (data) => onDate(data, IN_A_WEEK),
        },
      },
    ],
  },
  {
    // A relative day that isn't a weekday still goes through the plain date.
    name: "s57-tomorrow-still-works",
    fixture: "empty",
    turns: [
      {
        user: "add a task to call the dentist tomorrow",
        expect: {
          toolCall: "createSingleTask",
          reply: /Date: tomorrow/,
          data: (data) => onDate(data, TOMORROW),
        },
      },
    ],
  },
];
