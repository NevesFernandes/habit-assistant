// §55: "remove the comments of the task …" takes one field off an item — an edit, not a
// deletion and not a refusal. Users say notes/comments/details for the description. One
// scenario per clearable field and item type, plus the one thing that can't be cleared.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const UPDATE_TOOLS = ["updateSingleTask", "updateRecurringTask", "updateHabit"];

const setup = (data: AppData): AppData => ({
  ...data,
  singleTasks: [
    { kind: "singleTask", id: "t-reply", name: "Reply to Family", description: "Ask about the summer trip", categoryId: "social", priority: 0, startDate: TODAY, done: false, persistency: true },
    { kind: "singleTask", id: "t-shop", name: "Go shopping", priority: 0, startDate: TODAY, done: false, persistency: true, checklist: [{ id: "c1", text: "milk", checked: false }] },
  ],
  recurringTasks: [
    { kind: "recurringTask", id: "r-plants", name: "Water the plants", description: "Front balcony too", categoryId: "home", priority: 1, startDate: TODAY, recurrence: { type: "daysOfWeek", days: [6] } },
  ],
  habits: [
    { kind: "habit", id: "h-run", name: "Morning run", description: "Before breakfast", categoryId: "sports", priority: 1, startDate: TODAY, endDate: addDays(TODAY, 60), recurrence: { type: "daily" }, completionType: "yesno" },
  ],
});

const reply = (data: AppData) => data.singleTasks.find((task) => task.id === "t-reply");
const plants = (data: AppData) => data.recurringTasks.find((task) => task.id === "r-plants");
const run = (data: AppData) => data.habits.find((habit) => habit.id === "h-run");
const intact = (data: AppData) =>
  check(
    data.singleTasks.length === 2 && data.recurringTasks.length === 1 && data.habits.length === 1,
    `an item went missing: ${data.singleTasks.length} tasks, ${data.recurringTasks.length} recurring, ${data.habits.length} habits`,
  );

export const scenarios: Scenario[] = [
  {
    // The sentence from the bug report, word for word.
    name: "s55-remove-comments-single-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "Remove the comments of the task Reply to Family.",
        expect: {
          toolCall: UPDATE_TOOLS,
          reply: /Note: Ask about the summer trip → none/,
          data: (data) => all(intact(data), check(reply(data)?.description === undefined, `description still "${reply(data)?.description}"`)),
        },
      },
    ],
  },
  {
    name: "s55-clear-notes-recurring-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "clear the notes on the water the plants task",
        expect: {
          toolCall: UPDATE_TOOLS,
          data: (data) => all(intact(data), check(plants(data)?.description === undefined, `description still "${plants(data)?.description}"`)),
        },
      },
    ],
  },
  {
    name: "s55-delete-description-habit",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "delete the description from my morning run habit",
        expect: {
          toolCall: UPDATE_TOOLS,
          data: (data) => all(intact(data), check(run(data)?.description === undefined, `description still "${run(data)?.description}"`)),
        },
      },
    ],
  },
  {
    name: "s55-remove-end-date-habit",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the end date from the morning run habit",
        expect: {
          toolCall: UPDATE_TOOLS,
          reply: /Ends: .* → none/,
          data: (data) => all(intact(data), check(run(data)?.endDate === undefined, `end date still ${run(data)?.endDate}`)),
        },
      },
    ],
  },
  {
    name: "s55-remove-category-single-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the category from the Reply to Family task",
        expect: {
          toolCall: UPDATE_TOOLS,
          reply: /Category: Social → none/,
          data: (data) => all(intact(data), check(reply(data)?.categoryId === undefined, `category still ${reply(data)?.categoryId}`)),
        },
      },
    ],
  },
  {
    name: "s55-remove-category-recurring-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "take the category off the water the plants task",
        expect: {
          toolCall: UPDATE_TOOLS,
          data: (data) => all(intact(data), check(plants(data)?.categoryId === undefined, `category still ${plants(data)?.categoryId}`)),
        },
      },
    ],
  },
  {
    // A habit always has a category: it is either left alone or moved to Other (and the
    // reply says so) — never left with none.
    name: "s55-habit-category-never-none",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the category from my morning run habit",
        expect: {
          notReply: /→ none/,
          data: (data) =>
            all(
              intact(data),
              check(["sports", "other"].includes(run(data)?.categoryId ?? ""), `unexpected category ${run(data)?.categoryId}`),
            ),
        },
      },
    ],
  },
];
