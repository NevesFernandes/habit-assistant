// §51: follow-up replies. A reply to the "which one?" list may pick several items, handled
// by the app with no model call; and a short reply that does reach the model is sent with
// the tools its question needs, not the full list (too large for Groq's free tier).
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, describeRule, habitById, isWeekdays } from "./helpers.ts";

const FROM_REPLY = /^modify \(from reply\)$/;
const paused = (data: AppData, id: string) => (habitById(data, id)?.pauses ?? []).length > 0;

export const scenarios: Scenario[] = [
  {
    name: "s51-pick-both",
    fixture: "baseline",
    turns: [
      {
        user: "change read to monday, wednesday and friday",
        expect: {
          toolCall: ["updateHabit", "updateRecurringTask"],
          reply: [/I found 2 habits matching "read"/i, /several numbers, or "all"/],
        },
      },
      {
        user: "Both, 1 and 2",
        expect: {
          noModelCall: true,
          reply: /Updated "Read":[\s\S]*Updated "Read":/,
          data: (data) =>
            all(
              ...["read-1", "read-2"].map((id) =>
                check(isWeekdays(habitById(data, id)!.recurrence, [1, 3, 5]), `${id} should be Mon/Wed/Fri, got ${describeRule(habitById(data, id)!.recurrence)}`),
              ),
              check(isWeekdays(habitById(data, "technical-reading")!.recurrence, [1, 2, 3, 4, 5]), "Technical Reading should be untouched"),
            ),
        },
      },
    ],
  },
  {
    name: "s51-pick-all-pause",
    fixture: "baseline",
    turns: [
      {
        user: "pause my drink water habit",
        expect: { toolCall: "pauseHabit", reply: /I found 2 habits matching/ },
      },
      {
        user: "all of them",
        expect: {
          noModelCall: true,
          reply: /Paused "Drink water"[\s\S]*Paused "Drink water"/,
          data: (data) =>
            all(
              check(paused(data, "water-nutrition"), "water-nutrition should be paused"),
              check(paused(data, "water-sports"), "water-sports should be paused"),
              check(!paused(data, "water-test"), "Test: Drink water should be untouched"),
            ),
        },
      },
    ],
  },
  {
    // A reply the app can't resolve itself goes to the model — with the edit tools only.
    name: "s51-described-pick-uses-edit-tools",
    fixture: "baseline",
    turns: [
      {
        user: "move drink water to the evening",
        expect: { toolCall: "updateHabit", reply: /I found 2 habits matching/ },
      },
      {
        user: "the one in Nutrition",
        expect: {
          toolCall: "updateHabit",
          bucket: FROM_REPLY,
          reply: /Part of day: Not placed yet → Evening/,
          data: (data) =>
            all(
              check(habitById(data, "water-nutrition")?.dayPart === "evening", `water-nutrition is in ${habitById(data, "water-nutrition")?.dayPart}`),
              check(habitById(data, "water-sports")?.dayPart === undefined, "water-sports should be untouched"),
            ),
        },
      },
    ],
  },
  {
    // "Need any changes?" invites a correction, which is an edit of what was just created.
    name: "s51-correction-after-create-uses-edit-tools",
    fixture: "empty",
    turns: [
      {
        user: "add a habit to stretch",
        expect: { toolCall: "createHabit", reply: /Need any changes\?/ },
      },
      {
        user: "no, only on weekdays",
        expect: {
          toolCall: "updateHabit",
          bucket: FROM_REPLY,
          data: (data) => {
            const habit = data.habits[0];
            return all(
              check(data.habits.length === 1, `expected 1 habit, found ${data.habits.length}`),
              check(!!habit && isWeekdays(habit.recurrence, [1, 2, 3, 4, 5]), `expected weekdays, got ${habit && describeRule(habit.recurrence)}`),
            );
          },
        },
      },
    ],
  },
];
