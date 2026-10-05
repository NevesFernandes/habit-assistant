// §50: a creation reply names the first day the item is actually due ("every Thursday"
// created on a Monday is first due Thursday, not today), and an edit that moves the next
// due day says so. The weekdays are picked from the real today so neither is ever today
// or tomorrow.
import { formatDate } from "../../../src/lib/confirmations.ts";
import { addDays, dayOfWeek } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, isWeekdays, todayISO } from "./helpers.ts";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TODAY = todayISO();
const FIRST = addDays(TODAY, 3);
const MOVED = addDays(TODAY, 5);
const text = (dateISO: string) => formatDate(dateISO, TODAY);

export const scenarios: Scenario[] = [
  {
    name: "s50-first-due-then-next-due",
    fixture: "empty",
    turns: [
      {
        user: `add a recurring task to take out the bins every ${WEEKDAY_NAMES[dayOfWeek(FIRST)]}`,
        expect: {
          toolCall: "createRecurringTask",
          reply: [`First due: ${text(FIRST)}`, `first due ${text(FIRST)}`],
          notReply: [/Starts:/, /starting today/],
          data: (data: AppData) => {
            const task = data.recurringTasks[0];
            return all(
              check(!!task && isWeekdays(task.recurrence, [dayOfWeek(FIRST)]), `unexpected rule: ${JSON.stringify(task?.recurrence)}`),
              check(task?.startDate === TODAY, `expected it to start today, got ${task?.startDate}`),
            );
          },
        },
      },
      {
        user: `move the bins task to ${WEEKDAY_NAMES[dayOfWeek(MOVED)]}s instead`,
        expect: {
          toolCall: "updateRecurringTask",
          reply: `Next due: ${text(FIRST)} → ${text(MOVED)}`,
          data: (data: AppData) => {
            const task = data.recurringTasks[0];
            return check(!!task && isWeekdays(task.recurrence, [dayOfWeek(MOVED)]), `unexpected rule: ${JSON.stringify(task?.recurrence)}`);
          },
        },
      },
    ],
  },
  {
    name: "s50-daily-still-starts-today",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to read every day",
        expect: {
          toolCall: "createHabit",
          reply: [/Starts: today/, /starting today/],
          notReply: /First due/,
        },
      },
    ],
  },
];
