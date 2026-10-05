// §53: a task gets the category the user names when creating it — a one-off task could
// not carry one at all, and a recurring task's rule held it back. A task the user gives
// no category stays without one.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check } from "./helpers.ts";

const SELF_CARE = { id: "c-selfcare", name: "Self-care", icon: "heart", isDefault: false };
const withSelfCare = (data: AppData): AppData => ({ ...data, categories: [...data.categories, SELF_CARE] });

export const scenarios: Scenario[] = [
  {
    name: "s53-single-task-named-category",
    fixture: "empty",
    turns: [
      {
        user: "add a task to pay rent, Finance category",
        expect: {
          toolCall: "createSingleTask",
          reply: [/^Added task "/, /Category: Finance/],
          data: (data: AppData) => {
            const task = data.singleTasks[0];
            return all(
              check(data.singleTasks.length === 1, `expected 1 task, found ${data.singleTasks.length}`),
              check(task?.categoryId === "finance", `expected finance, got ${task?.categoryId}`),
            );
          },
        },
      },
    ],
  },
  {
    name: "s53-recurring-task-named-category",
    fixture: "empty",
    turns: [
      {
        user: "add a recurring task to back up my laptop every Friday, in the Work category",
        expect: {
          toolCall: "createRecurringTask",
          reply: /Category: Work/,
          notReply: /no category/,
          data: (data: AppData) => {
            const task = data.recurringTasks[0];
            return check(task?.categoryId === "work", `expected work, got ${task?.categoryId}`);
          },
        },
      },
    ],
  },
  {
    name: "s53-single-task-custom-category",
    fixture: "empty",
    setup: withSelfCare,
    turns: [
      {
        user: "add a task to book a massage, selfcare category",
        expect: {
          toolCall: "createSingleTask",
          reply: /Category: Self-care/,
          data: (data: AppData) => {
            const task = data.singleTasks[0];
            return check(task?.categoryId === SELF_CARE.id, `expected ${SELF_CARE.id}, got ${task?.categoryId}`);
          },
        },
      },
    ],
  },
  {
    name: "s53-single-task-no-category",
    fixture: "empty",
    turns: [
      {
        user: "add a task to buy milk",
        expect: {
          toolCall: "createSingleTask",
          notReply: /Category/,
          data: (data: AppData) => {
            const task = data.singleTasks[0];
            return check(!!task && task.categoryId === undefined, `expected no category, got ${task?.categoryId}`);
          },
        },
      },
    ],
  },
];
