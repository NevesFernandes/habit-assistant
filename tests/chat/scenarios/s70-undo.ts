// §70: "undo that" puts back the app's last chat change.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const setup = (data: AppData): AppData => ({
  ...data,
  habits: [{ kind: "habit", id: "gym", name: "Gym", categoryId: "sports", dayPart: "morning", startDate: addDays(TODAY, -10), recurrence: { type: "daily" }, completionType: "yesno" }],
  completionLog: [{ id: "g", itemId: "gym", date: addDays(TODAY, -1) }],
});

export const scenarios: Scenario[] = [
  {
    name: "s70-undo-delete",
    fixture: "empty",
    setup,
    turns: [
      { user: "delete the gym habit", expect: { reply: /Are you sure/ } },
      { user: "yes", expect: { data: (d) => check(d.habits.length === 0, "not deleted") } },
      { user: "undo that", expect: { toolCall: "undoLastChange", bucket: /undo/, reply: /brought back "Gym" with its history/, data: (d) => check(d.habits.length === 1 && d.completionLog.length === 1, "not back with history") } },
    ],
  },
];
