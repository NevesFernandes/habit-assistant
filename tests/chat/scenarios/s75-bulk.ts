// §75: one action on several items: named ones, or a filter; everything asks first.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData, Habit } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const habit = (id: string, dayPart: Habit["dayPart"], categoryId = "health"): Habit => ({
  kind: "habit", id, name: id[0].toUpperCase() + id.slice(1), categoryId, dayPart, startDate: addDays(TODAY, -10), recurrence: { type: "daily" }, completionType: "yesno",
});
const setup = (data: AppData): AppData => ({
  ...data,
  habits: [habit("floss", "bedtime"), habit("water", "morning"), habit("stretch", "morning"), habit("run", "evening", "sports")],
});
const doneToday = (d: AppData, id: string) => d.completionLog.some((e) => e.itemId === id && e.date === TODAY);

export const scenarios: Scenario[] = [
  {
    name: "s75-named",
    fixture: "empty",
    setup,
    turns: [{ user: "mark floss and water done", expect: { toolCall: "applyToMany", reply: /Marked done today: .*(Floss|Water)/, data: (d) => check(doneToday(d, "floss") && doneToday(d, "water"), "not both done") } }],
  },
  {
    name: "s75-morning",
    fixture: "empty",
    setup,
    turns: [{ user: "mark all my morning habits done", expect: { toolCall: "applyToMany", data: (d) => check(doneToday(d, "water") && doneToday(d, "stretch") && !doneToday(d, "floss"), "wrong items done") } }],
  },
  {
    name: "s75-everything-asks",
    fixture: "empty",
    setup,
    turns: [
      { user: "skip everything today", expect: { toolCall: "applyToMany", reply: /That's every item/ } },
      { user: "yes", expect: { reply: /Skipped today/ } },
    ],
  },
];
