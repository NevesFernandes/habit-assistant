// §28: pausing a habit stops its occurrences without archiving it, either until a known
// resume date or open-endedly. "Journal" in the baseline fixture is daily and uniquely
// named, so these test pausing rather than item matching.
import type { AppData, Habit } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { addDays, occursOn } from "../../../src/lib/recurrence.ts";
import { all, check, todayISO } from "./helpers.ts";

const LAST_MONTH = addDays(todayISO(), -30);
const NEXT_MONTH = addDays(todayISO(), 30);

const journal = (data: AppData): Habit | undefined => data.habits.find((habit) => habit.id === "journal");
const pauses = (data: AppData) => journal(data)?.pauses ?? [];

/** Days between two ISO dates, for judging a resume date the model worked out itself. */
function daysApart(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}

export const scenarios: Scenario[] = [
  {
    name: "s28-pause-for-a-window",
    fixture: "baseline",
    turns: [
      {
        user: "pause my journal habit for the next two weeks",
        expect: {
          reply: /Paused "Journal"/,
          data: (data) => {
            const [pause, ...rest] = pauses(data);
            if (!pause) return "no pause was stored";
            const back = pause.resumeOn;
            return all(
              check(rest.length === 0, "only one pause should be stored"),
              check(pause.from <= todayISO(), `pause should start today, got ${pause.from}`),
              check(!!back, "a two-week pause should have a resume date"),
              // The model resolves "two weeks" itself, so allow a day either side.
              check(
                !!back && daysApart(todayISO(), back) >= 13 && daysApart(todayISO(), back) <= 16,
                `resume date should be about 14 days out, got ${back}`,
              ),
              check(!!journal(data) && !occursOn(journal(data)!, addDays(todayISO(), 3)), "should not be due mid-pause"),
            );
          },
        },
      },
    ],
  },
  {
    name: "s28-pause-open-ended",
    fixture: "baseline",
    turns: [
      {
        user: "put my journal habit on hold indefinitely",
        expect: {
          reply: /Paused "Journal"/,
          data: (data) => {
            const pause = pauses(data)[0];
            if (!pause) return "no pause was stored";
            return all(
              check(pause.resumeOn === undefined, `an open-ended pause has no resume date, got ${pause.resumeOn}`),
              check(!!journal(data) && !occursOn(journal(data)!, todayISO()), "should not be due today"),
              check(!!journal(data) && !occursOn(journal(data)!, addDays(todayISO(), 200)), "should stay paused"),
            );
          },
        },
      },
    ],
  },
  {
    name: "s28-resume-brings-it-back",
    fixture: "baseline",
    turns: [
      { user: "pause my journal habit", expect: { reply: /Paused "Journal"/ } },
      {
        user: "actually, resume my journal habit",
        expect: {
          data: (data) =>
            check(!!journal(data) && occursOn(journal(data)!, todayISO()), "the habit should be due again today"),
        },
      },
    ],
  },
  {
    // Same invariant, phrased with an explicit past ISO date to give the model every
    // chance to actually send one — this is what exercises the app's own guard, rather
    // than relying on the model's good judgement.
    name: "s28-no-backdated-pause-explicit",
    fixture: "baseline",
    turns: [
      {
        user: `pause my journal habit from ${LAST_MONTH} until ${NEXT_MONTH}`,
        expect: {
          data: (data) => {
            const pause = pauses(data)[0];
            return check(
              !pause || pause.from >= todayISO(),
              `a pause must not start in the past, got ${pause?.from}`,
            );
          },
        },
      },
    ],
  },
  {
    // A pause must never cover days that have already happened (§29's rule). Either the
    // model declines to backdate or the app refuses — both are fine, a stored past-dated
    // pause is not.
    name: "s28-no-backdated-pause",
    fixture: "baseline",
    turns: [
      {
        user: "pause my journal habit starting last Monday",
        expect: {
          data: (data) => {
            const pause = pauses(data)[0];
            return check(
              !pause || pause.from >= todayISO(),
              `a pause must not start in the past, got ${pause?.from}`,
            );
          },
        },
      },
    ],
  },
];
