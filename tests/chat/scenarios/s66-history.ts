// §66: questions about a period go to getHistory, and the app words the answer from the
// data. Dates are built from the real today.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { todayISO } from "./helpers.ts";

const TODAY = todayISO();

const setup = (data: AppData): AppData => ({
  ...data,
  habits: [
    {
      kind: "habit",
      id: "floss",
      name: "Floss",
      categoryId: "health",
      dayPart: "bedtime",
      startDate: addDays(TODAY, -20),
      recurrence: { type: "daily" },
      completionType: "yesno",
    },
  ],
  completionLog: [
    { id: "f1", itemId: "floss", date: addDays(TODAY, -3) },
    { id: "f2", itemId: "floss", date: addDays(TODAY, -1) },
  ],
});

export const scenarios: Scenario[] = [
  {
    name: "s66-how-did-my-week-go",
    fixture: "empty",
    setup,
    turns: [{ user: "how did my week go?", expect: { toolCall: "getHistory", bucket: /history/, reply: /^Floss: /m } }],
  },
  {
    name: "s66-when-did-i-last",
    fixture: "empty",
    setup,
    turns: [{ user: "when did I last floss?", expect: { toolCall: "getHistory", reply: /Last done/ } }],
  },
];
