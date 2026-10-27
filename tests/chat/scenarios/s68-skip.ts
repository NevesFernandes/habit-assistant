// §68: skip one day of a habit, today or later; never the past; undo with "unskip".
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check, todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    {
      kind: "habit",
      id: "gym",
      name: "Gym",
      categoryId: "sports",
      dayPart: "morning",
      startDate: addDays(TODAY, -10),
      recurrence: { type: "daily" },
      completionType: "yesno",
    },
  ],
});

const skippedOn = (data: AppData, date: string) => !!data.habits[0].pauses?.some((p) => p.skip && p.from === date);

export const scenarios: Scenario[] = [
  {
    name: "s68-skip-today-then-undo",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "I'm sick, skip gym today",
        expect: { toolCall: "skipDay", bucket: /schedule/, reply: /Skipped "Gym" today/, data: (d) => check(skippedOn(d, TODAY), "not skipped") },
      },
      {
        user: "actually unskip gym",
        expect: { toolCall: "skipDay", reply: /back on/, data: (d) => check(!skippedOn(d, TODAY), "still skipped") },
      },
    ],
  },
  {
    name: "s68-no-skipping-the-past",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "skip gym yesterday",
        expect: { reply: /only skip today or a later day/, data: (d) => check(!d.habits[0].pauses?.length, "a pause was stored") },
      },
    ],
  },
];
