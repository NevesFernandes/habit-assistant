// "Add milk and bread to the shopping list" used to add only milk: the add-item tools took
// a single `text`. They now take `items`, and every named item must land on the list.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check } from "./helpers.ts";

const texts = (checklist: { text: string }[] | undefined) =>
  (checklist ?? []).map((item) => item.text.toLowerCase()).sort().join(",");

export const scenarios: Scenario[] = [
  {
    // The user's own report, verbatim.
    name: "checklist-add-two-to-new-task",
    fixture: "empty",
    turns: [
      { user: "Add a go shopping task with a checklist inside.", expect: { toolCall: "createSingleTask" } },
      {
        user: "Add milk and bread to the shopping list",
        expect: {
          toolCall: ["addSingleTaskChecklistItem", "addRecurringTaskChecklistItem"],
          reply: /Added "milk" and "bread"|Added "bread" and "milk"/i,
          data: (data: AppData) =>
            check(texts(data.singleTasks[0]?.checklist) === "bread,milk", `got ${texts(data.singleTasks[0]?.checklist)}`),
        },
      },
    ],
  },
  {
    name: "checklist-add-three-to-existing",
    fixture: "baseline",
    turns: [
      {
        user: "add eggs, coffee and apples to my weekly shopping list",
        expect: {
          toolCall: ["addRecurringTaskChecklistItem", "addSingleTaskChecklistItem"],
          data: (data: AppData) => {
            const list = texts(data.recurringTasks.find((task) => task.id === "shopping")?.checklist);
            return check(["apples", "coffee", "eggs"].every((item) => list.includes(item)), `got ${list}`);
          },
        },
      },
    ],
  },
];
