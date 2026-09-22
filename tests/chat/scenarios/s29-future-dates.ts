// §29: completion status can't be changed for a day that hasn't happened yet — logging
// progress or ticking a habit's checklist on a future date is refused outright. A one-off
// task is the deliberate exception: it can be done early, but only after confirming, and
// confirming moves it to today so the record says when it really happened.
//
// "Renew passport" in the baseline fixture is dated 2030-01-05 for this, and the dates
// below are computed from the real today, since the runner's clock is the real clock.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { addDays } from "../../../src/lib/recurrence.ts";
import { all, check, todayISO } from "./helpers.ts";

const NOT_HAPPENED = /hasn't happened yet/;
const TOMORROW = addDays(todayISO(), 1);

/** Nothing at all was written to the log — a refusal must not persist a half-change. */
const nothingLogged = (data: AppData) =>
  check(data.completionLog.length === 0, `completionLog should still be empty, got ${data.completionLog.length} entries`);

const passport = (data: AppData) => data.singleTasks.find((task) => task.id === "passport");

export const scenarios: Scenario[] = [
  {
    name: "s29-log-future-day-refused",
    fixture: "baseline",
    turns: [
      {
        user: `log 20 push-ups for ${TOMORROW}`,
        expect: { reply: NOT_HAPPENED, data: nothingLogged },
      },
    ],
  },
  {
    // The same request for today still works — §29 must not break ordinary logging.
    name: "s29-log-today-still-works",
    fixture: "baseline",
    turns: [
      {
        user: "log 20 push-ups",
        expect: {
          notReply: NOT_HAPPENED,
          data: (data) =>
            check(
              data.completionLog.some((entry) => entry.date === todayISO() && entry.value === 20),
              `expected 20 logged for today, got ${JSON.stringify(data.completionLog)}`,
            ),
        },
      },
    ],
  },
  {
    name: "s29-future-task-asks-then-moves",
    fixture: "baseline",
    turns: [
      {
        user: "mark renew passport as done",
        // Asks instead of acting, and nothing changes until the answer comes.
        expect: {
          reply: /move it to today/,
          data: (data) =>
            all(
              check(passport(data)?.done === false, "the task should not be done yet"),
              check(passport(data)?.startDate === "2030-01-05", "the task should not have moved yet"),
            ),
        },
      },
      {
        user: "yes",
        expect: {
          data: (data) =>
            all(
              check(passport(data)?.done === true, "the task should be done after confirming"),
              check(
                passport(data)?.startDate === todayISO(),
                `the task should have moved to today, got ${passport(data)?.startDate}`,
              ),
            ),
        },
      },
    ],
  },
  {
    name: "s29-future-task-declined",
    fixture: "baseline",
    turns: [
      { user: "mark renew passport as done", expect: { reply: /move it to today/ } },
      {
        user: "no",
        expect: {
          data: (data) =>
            all(
              check(passport(data)?.done === false, "the task should still not be done"),
              check(passport(data)?.startDate === "2030-01-05", "the task should have stayed in the future"),
            ),
        },
      },
    ],
  },
];
