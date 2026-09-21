// §35: word forms. The model sends the name as the user said it ("reading", "meditation"),
// which a substring match never lines up with a habit called "Read" or "Meditate".
// Measured 2026-09-21 while closing §34: "change my reading habit to mondays" silently
// updated "Technical Reading" — the wrong habit, no question asked — 3/3 times. These
// scenarios encode the wanted behaviour, so they FAIL until §35 is built.
import type { Scenario } from "../types.ts";
import { check, habitById } from "./helpers.ts";

const NOT_FOUND = /couldn't find/;

export const scenarios: Scenario[] = [
  {
    name: "s35-stem-reading-habit",
    fixture: "baseline",
    turns: [
      {
        user: "change my reading habit to mondays",
        // Two identical "Read" habits, so success here is the numbered list, not a change.
        expect: { notReply: NOT_FOUND, reply: /I found 2 habits matching/ },
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
          // "Meditate" and "Test: Meditate" are both timers: either the exact-name pick or the list is fine.
          reply: /Logged 20m|I found 2 habits matching/,
          data: (data) => check(!!habitById(data, "meditate"), "Meditate should still exist"),
        },
      },
    ],
  },
];
