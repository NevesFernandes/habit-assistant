// §39: a task can be created with a checklist inside it — empty, or seeded with items —
// which is what makes the day view show its checklist badge (even at 0/0). A plain task
// must stay plain: no checklist unless the user asked for one.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check } from "./helpers.ts";

const itemTexts = (checklist: { text: string }[] | undefined) =>
  (checklist ?? []).map((item) => item.text.toLowerCase()).sort().join(",");

export const scenarios: Scenario[] = [
  {
    name: "s39-single-task-empty-checklist",
    fixture: "empty",
    turns: [
      {
        user: "Add a task for Friday called Go Shopping, with a checklist inside",
        expect: {
          toolCall: "createSingleTask",
          reply: /Checklist: empty for now/,
          data: (data: AppData) => {
            const task = data.singleTasks[0];
            return all(
              check(data.singleTasks.length === 1, `expected 1 single task, found ${data.singleTasks.length}`),
              check(Array.isArray(task?.checklist), "the task should have a checklist"),
              check(task?.checklist?.length === 0, `the checklist should be empty, got ${itemTexts(task?.checklist)}`),
            );
          },
        },
      },
    ],
  },
  {
    name: "s39-recurring-task-seeded-checklist",
    fixture: "empty",
    turns: [
      {
        user: "add a recurring task to go shopping every Saturday, with a checklist: milk, eggs and bread",
        expect: {
          toolCall: "createRecurringTask",
          reply: /Checklist: /,
          data: (data: AppData) => {
            const task = data.recurringTasks[0];
            return all(
              check(data.recurringTasks.length === 1, `expected 1 recurring task, found ${data.recurringTasks.length}`),
              check(
                itemTexts(task?.checklist) === "bread,eggs,milk",
                `expected milk, eggs, bread; got ${itemTexts(task?.checklist) || "no checklist"}`,
              ),
            );
          },
        },
      },
    ],
  },
  {
    name: "s39-plain-task-has-no-checklist",
    fixture: "empty",
    turns: [
      {
        user: "add a task to call the dentist tomorrow",
        expect: {
          toolCall: "createSingleTask",
          notReply: /Checklist/,
          data: (data: AppData) =>
            check(data.singleTasks[0]?.checklist === undefined, "a plain task should not get a checklist"),
        },
      },
    ],
  },
];
