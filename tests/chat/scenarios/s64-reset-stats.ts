// §64: "reset my stats" asks first; a yes starts the counting over, history kept; the best
// streak stays unless asked; "undo the reset" puts it back.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check, todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    { kind: "habit", id: "gym", name: "Gym", categoryId: "sports", dayPart: "morning", startDate: addDays(TODAY, -10), recurrence: { type: "daily" }, completionType: "yesno" },
  ],
  completionLog: [1, 2, 3].map((n) => ({ id: `g${n}`, itemId: "gym", date: addDays(TODAY, -n) })),
});

export const scenarios: Scenario[] = [
  {
    name: "s64-reset-asks-then-undo",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "reset my gym stats",
        expect: { toolCall: "resetStats", reply: [/^Start the stats over/, /best streak \(3\) stays/], data: (d) => check(!d.habits[0].statsFrom, "reset before the yes") },
      },
      { user: "yes", expect: { toolCall: "confirmPendingAction", reply: /Stats start over/, data: (d) => check(d.habits[0].statsFrom === TODAY, "not reset") } },
      { user: "undo the reset", expect: { toolCall: "resetStats", reply: /Undid the stats reset/, data: (d) => check(!d.habits[0].statsFrom, "still reset") } },
    ],
  },
  {
    name: "s64-including-best-streak",
    fixture: "empty",
    setup,
    turns: [
      { user: "reset my gym stats including the best streak", expect: { toolCall: "resetStats", reply: /best streak starts over too/ } },
      { user: "yes", expect: { data: (d) => check(d.habits[0].bestStreakFrom === TODAY, "best streak kept") } },
    ],
  },
];
