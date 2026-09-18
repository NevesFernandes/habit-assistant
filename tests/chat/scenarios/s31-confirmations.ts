// §31: creation replies describe what was actually stored, and flag assumed defaults.
import type { Scenario } from "../types.ts";
import { all, check, describeRule, isWeekdays } from "./helpers.ts";

export const scenarios: Scenario[] = [
  {
    name: "s31-bare-habit-assumes-defaults",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to read",
        expect: {
          toolCall: "createHabit",
          reply: [/^Added habit "/, /Assumed: every day/, /Need any changes\?/],
          data: (data) => {
            const habit = data.habits[0];
            return all(
              check(data.habits.length === 1, `expected 1 habit, found ${data.habits.length}`),
              check(habit?.recurrence.type === "daily", `expected daily, got ${habit && describeRule(habit.recurrence)}`),
              check(habit?.completionType === "yesno", `expected yesno, got ${habit?.completionType}`),
            );
          },
        },
      },
    ],
  },
  {
    name: "s31-named-weekdays-stay-weekdays",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to go running on Tuesday, Thursday, Saturday and Sunday",
        expect: {
          toolCall: "createHabit",
          reply: /Repeats: every Sun, Tue, Thu, Sat/,
          data: (data) => {
            const habit = data.habits[0];
            return check(
              !!habit && isWeekdays(habit.recurrence, [0, 2, 4, 6]),
              `expected Sun/Tue/Thu/Sat, got ${habit && describeRule(habit.recurrence)}`,
            );
          },
        },
      },
    ],
  },
  {
    name: "s31-value-habit-with-goal",
    fixture: "empty",
    turns: [
      {
        user: "drink 8 glasses of water every day",
        expect: {
          toolCall: "createHabit",
          reply: /Tracking: number — goal 8 glasses/,
          notReply: /Assumed: every day/,
          data: (data) => {
            const habit = data.habits[0];
            return all(
              check(habit?.completionType === "value", `expected value tracking, got ${habit?.completionType}`),
              check(habit?.target === 8, `expected target 8, got ${habit?.target}`),
            );
          },
        },
      },
    ],
  },
];
