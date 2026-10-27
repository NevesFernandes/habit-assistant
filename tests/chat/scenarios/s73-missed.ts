// §73: "what did I miss?" lists only the misses, says which period it assumed, and never
// offers to mark past days done.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    { kind: "habit", id: "floss", name: "Floss", categoryId: "health", dayPart: "bedtime", startDate: addDays(TODAY, -30), recurrence: { type: "daily" }, completionType: "yesno" },
  ],
});

export const scenarios: Scenario[] = [
  {
    name: "s73-what-did-i-miss",
    fixture: "empty",
    setup,
    turns: [{ user: "what did I miss?", expect: { toolCall: "getMissed", bucket: /history/, reply: /(This|Last) week.*You didn't name a period[\s\S]*Floss: missed/ } }],
  },
  {
    name: "s73-last-month",
    fixture: "empty",
    setup,
    turns: [{ user: "what did I miss last month?", expect: { toolCall: "getMissed", reply: /Floss: missed .*Want to change its days, or pause it/s } }],
  },
];
