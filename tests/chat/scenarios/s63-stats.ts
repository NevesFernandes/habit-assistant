// §63: stats questions go to getStats, and the app words the answer.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    { kind: "habit", id: "gym", name: "Gym", categoryId: "sports", dayPart: "morning", startDate: addDays(TODAY, -10), recurrence: { type: "daily" }, completionType: "yesno" },
  ],
  recurringTasks: [{ kind: "recurringTask", id: "bins", name: "Bins", dayPart: "evening", startDate: addDays(TODAY, -10), recurrence: { type: "daily" } }],
  completionLog: [
    { id: "g1", itemId: "gym", date: addDays(TODAY, -2) },
    { id: "g2", itemId: "gym", date: addDays(TODAY, -1) },
    { id: "b1", itemId: "bins", date: addDays(TODAY, -1) },
  ],
});

export const scenarios: Scenario[] = [
  {
    name: "s63-item-streak",
    fixture: "empty",
    setup,
    turns: [{ user: "what's my gym streak?", expect: { toolCall: "getStats", reply: /"Gym": current streak 2 days/ } }],
  },
  {
    name: "s63-recurring-task-stats",
    fixture: "empty",
    setup,
    turns: [{ user: "show the stats for the bins task", expect: { toolCall: "getStats", reply: /"Bins": current streak/ } }],
  },
  {
    name: "s63-overall",
    fixture: "empty",
    setup,
    turns: [{ user: "how am I doing overall?", expect: { toolCall: "getStats", reply: [/^Habits \(1\)/m, /^Recurring tasks \(1\)/m] } }],
  },
];
