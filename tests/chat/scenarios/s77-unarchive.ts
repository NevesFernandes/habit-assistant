// §77: bringing an archived habit back by chat; the archived days count as paused.
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
      startDate: addDays(TODAY, -30),
      endDate: addDays(TODAY, -10),
      recurrence: { type: "daily" },
      completionType: "yesno",
    },
  ],
});

const broughtBack = (data: AppData) => !data.habits[0].endDate && !!data.habits[0].pauses?.some((p) => p.from === addDays(TODAY, -9) && p.resumeOn === TODAY);

export const scenarios: Scenario[] = [
  {
    name: "s77-unarchive",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "bring back my gym habit",
        expect: { toolCall: "resumeHabit", bucket: /schedule/, reply: /Brought back "Gym"/, data: (d) => check(broughtBack(d), "not brought back") },
      },
    ],
  },
  {
    name: "s77-remove-end-date",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the end date from gym",
        expect: { toolCall: "updateHabit", reply: /count as paused, not missed/, data: (d) => check(broughtBack(d), "archived days not kept as a pause") },
      },
    ],
  },
];
