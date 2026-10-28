// §78: one edit on several items, by filter or by names.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData, Habit } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const habit = (id: string, categoryId: string): Habit => ({
  kind: "habit", id, name: id[0].toUpperCase() + id.slice(1), categoryId, dayPart: "morning", startDate: addDays(TODAY, -10), recurrence: { type: "daily" }, completionType: "yesno",
});
const setup = (data: AppData): AppData => ({ ...data, habits: [habit("gym", "sports"), habit("run", "sports"), habit("floss", "health")] });

export const scenarios: Scenario[] = [
  {
    name: "s78-move-category-to-evening",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "move all my Sports habits to the evening",
        expect: { toolCall: "editMany", reply: /Moved to Evening: Gym, Run/, data: (d) => check(d.habits.filter((h) => h.categoryId === "sports").every((h) => h.dayPart === "evening") && d.habits.find((h) => h.id === "floss")!.dayPart === "morning", "wrong items moved") },
      },
    ],
  },
  {
    name: "s78-named-repeat-rule",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "make gym and run Monday, Wednesday and Friday only",
        expect: { toolCall: "editMany", data: (d) => check(["gym", "run"].every((id) => d.habits.find((h) => h.id === id)!.recurrence.type === "daysOfWeek"), "not changed") },
      },
    ],
  },
];
