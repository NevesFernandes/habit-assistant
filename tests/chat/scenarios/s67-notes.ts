// §67: a note rides with "mark done"; a note naming a day goes on that day, a future one
// included; "notes" with no day is still the description (§55).
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
      id: "run",
      name: "Run",
      description: "Along the river",
      categoryId: "sports",
      dayPart: "morning",
      startDate: addDays(TODAY, -10),
      recurrence: { type: "daily" },
      completionType: "yesno",
    },
  ],
});

const noteOn = (data: AppData, date: string) => data.notes?.find((n) => n.itemId === "run" && n.date === date)?.text;

export const scenarios: Scenario[] = [
  {
    name: "s67-note-with-done",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "mark run done, 5 km, legs tired",
        expect: {
          toolCall: "setHabitDone",
          reply: /Note: "/,
          data: (data) => check(/legs tired/.test(noteOn(data, TODAY) ?? ""), `note today: ${noteOn(data, TODAY)}`),
        },
      },
    ],
  },
  {
    name: "s67-note-for-tomorrow",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "note for tomorrow's run: bring a towel",
        expect: {
          toolCall: "setNote",
          data: (data) => check(/towel/.test(noteOn(data, addDays(TODAY, 1)) ?? ""), `note tomorrow: ${noteOn(data, addDays(TODAY, 1))}`),
        },
      },
    ],
  },
  {
    name: "s67-notes-without-a-day-are-the-description",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the notes from the run habit",
        expect: {
          toolCall: "updateHabit",
          data: (data) => check(!data.habits[0].description, `description: ${data.habits[0].description}`),
        },
      },
    ],
  },
];
