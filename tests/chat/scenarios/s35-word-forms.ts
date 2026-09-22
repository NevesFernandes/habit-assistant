// §35: word forms. The model sends the name as the user said it ("reading", "meditation"),
// which a substring match never lines up with a habit called "Read" or "Meditate".
// Measured 2026-09-21 while closing §34: "change my reading habit to mondays" silently
// updated "Technical Reading" — the wrong habit, no question asked — 3/3 times.
// The fix offers every match, closest first, so success here is the numbered question.
import type { Scenario } from "../types.ts";
import type { AppData } from "../../../src/types/models.ts";
import { check, habitById } from "./helpers.ts";

const NOT_FOUND = /couldn't find/;

/**
 * The three "read"-ish habits still carry their fixture recurrence — the point of §35 is
 * that asking beats silently rescheduling one of them. "Technical Reading" keeps Mon-Fri
 * (the wrong edit would leave it Mon only), and both "Read" habits stay daily.
 */
const nothingRescheduled = (data: AppData) => {
  const describe = (id: string) => JSON.stringify(data.habits.find((h) => h.id === id)?.recurrence);
  return check(
    describe("technical-reading") === '{"type":"daysOfWeek","days":[1,2,3,4,5]}' &&
      describe("read-1") === '{"type":"daily"}' &&
      describe("read-2") === '{"type":"daily"}',
    `no habit should have been rescheduled, got ${["technical-reading", "read-1", "read-2"].map(describe).join(", ")}`,
  );
};

export const scenarios: Scenario[] = [
  {
    name: "s35-stem-reading-habit",
    fixture: "baseline",
    turns: [
      {
        user: "change my reading habit to mondays",
        // Two habits called "Read" plus "Technical Reading": the answer is the question,
        // not a change — and above all not a silent edit of "Technical Reading".
        expect: { notReply: NOT_FOUND, reply: /I found 3 habits matching/, data: nothingRescheduled },
      },
    ],
  },
  {
    name: "s35-stem-meditation",
    fixture: "baseline",
    turns: [
      {
        user: "log 20 minutes of meditation",
        expect: {
          notReply: NOT_FOUND,
          // "Meditate" and "Test: Meditate" are both timers, so the list is the honest answer.
          reply: /Logged 20m|I found 2 habits matching/,
          data: (data) => check(!!habitById(data, "meditate"), "Meditate should still exist"),
        },
      },
    ],
  },
];
