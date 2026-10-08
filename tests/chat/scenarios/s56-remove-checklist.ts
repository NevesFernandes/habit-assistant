// §56: chat can take an item off a checklist, or the checklist off a task, without
// deleting the task or habit that owns it — and "remove" isn't mistaken for "check off".
import { addDays } from "../../../src/lib/recurrence.ts";
import { currentHabitChecklist, habitChecklistOn } from "../../../src/lib/habitChecklist.ts";
import { recurringTaskChecklistOn } from "../../../src/lib/recurringChecklist.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, todayISO } from "./helpers.ts";

const TODAY = todayISO();
const YESTERDAY = addDays(TODAY, -1);
const LAST_WEEK = addDays(TODAY, -7);

const setup = (data: AppData): AppData => ({
  ...data,
  singleTasks: [
    {
      kind: "singleTask", id: "t-shop", name: "Go shopping", priority: 1, startDate: TODAY, done: false, persistency: true,
      checklist: [
        { id: "c1", text: "milk", checked: false },
        { id: "c2", text: "eggs", checked: false },
        { id: "c3", text: "bread", checked: false },
      ],
    },
    { kind: "singleTask", id: "t-dentist", name: "Call the dentist", priority: 1, startDate: TODAY, done: false, persistency: true },
  ],
  recurringTasks: [
    {
      kind: "recurringTask", id: "r-clean", name: "Weekly cleaning", categoryId: "home", priority: 1, startDate: TODAY,
      recurrence: { type: "daysOfWeek", days: [6] }, checklistMode: "sameList",
      checklist: [
        { id: "k1", text: "floors", checked: false },
        { id: "k2", text: "windows", checked: false },
      ],
    },
  ],
  habits: [
    {
      kind: "habit", id: "h-routine", name: "Morning routine", categoryId: "health", priority: 1, startDate: LAST_WEEK,
      recurrence: { type: "daily" }, completionType: "checklist",
      checklist: [
        { id: "s1", text: "stretch", checked: false },
        { id: "s2", text: "floss", checked: false },
        { id: "s3", text: "meditate", checked: false },
      ],
    },
  ],
});

const shop = (data: AppData) => data.singleTasks.find((task) => task.id === "t-shop");
const clean = (data: AppData) => data.recurringTasks.find((task) => task.id === "r-clean");
const routine = (data: AppData) => data.habits.find((habit) => habit.id === "h-routine");
const texts = (items: { text: string }[] | undefined) => (items ?? []).map((item) => item.text).join(",");
const intact = (data: AppData) =>
  check(
    data.singleTasks.length === 2 && data.recurringTasks.length === 1 && data.habits.length === 1,
    `an item went missing: ${data.singleTasks.length} tasks, ${data.recurringTasks.length} recurring, ${data.habits.length} habits`,
  );

export const scenarios: Scenario[] = [
  {
    name: "s56-remove-item-single-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove milk from my shopping list",
        expect: {
          toolCall: "removeChecklistItems",
          reply: [/Removed "milk" from "Go shopping"/, /Still on the list: eggs, bread/],
          data: (data) => all(intact(data), check(texts(shop(data)?.checklist) === "eggs,bread", `list is ${texts(shop(data)?.checklist)}`)),
        },
      },
    ],
  },
  {
    name: "s56-remove-several-items",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "take eggs and bread off the shopping list, I already have them at home",
        expect: {
          toolCall: "removeChecklistItems",
          data: (data) => all(intact(data), check(texts(shop(data)?.checklist) === "milk", `list is ${texts(shop(data)?.checklist)}`)),
        },
      },
    ],
  },
  {
    // A recurring task, which the model has no way to tell from a one-off one.
    name: "s56-remove-item-recurring-task",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove windows from the weekly cleaning checklist",
        expect: {
          toolCall: "removeChecklistItems",
          data: (data) => {
            const task = clean(data);
            return all(intact(data), check(!!task && texts(recurringTaskChecklistOn(task, TODAY)) === "floors", "windows is still on today's list"));
          },
        },
      },
    ],
  },
  {
    // No list word at all, and a delete verb: the habit must survive.
    name: "s56-remove-step-from-habit",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove floss from my morning routine",
        expect: {
          toolCall: "removeChecklistItems",
          data: (data) =>
            all(
              intact(data),
              check(texts(currentHabitChecklist(routine(data)!)) === "stretch,meditate", `steps are ${texts(currentHabitChecklist(routine(data)!))}`),
              check(texts(habitChecklistOn(routine(data)!, YESTERDAY)) === "stretch,floss,meditate", "yesterday lost a step"),
            ),
        },
      },
    ],
  },
  {
    // A whole new list of steps counts from today; the days before keep the old one.
    name: "s56-replace-habit-steps",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "change the steps of my morning routine to stretch, meditate and journal",
        expect: {
          toolCall: "updateHabit",
          reply: /apply from today on/,
          data: (data) =>
            all(
              intact(data),
              check(texts(currentHabitChecklist(routine(data)!)) === "stretch,meditate,journal", `steps are ${texts(currentHabitChecklist(routine(data)!))}`),
              check(texts(habitChecklistOn(routine(data)!, YESTERDAY)) === "stretch,floss,meditate", "yesterday's steps changed"),
            ),
        },
      },
    ],
  },
  {
    // The sentence §55 had to refuse.
    name: "s56-remove-checklist-confirmed",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "remove the checklist from the go shopping task",
        expect: {
          toolCall: "removeTaskChecklist",
          reply: /Remove the checklist from "Go shopping"\? It has 3 items/,
          data: (data) => all(intact(data), check(shop(data)?.checklist?.length === 3, "the checklist changed before the user confirmed")),
        },
      },
      {
        user: "yes",
        expect: {
          toolCall: "confirmPendingAction",
          reply: /Removed the checklist from "Go shopping"/,
          data: (data) => all(intact(data), check(shop(data)?.checklist === undefined, "the checklist is still there")),
        },
      },
    ],
  },
  {
    // Buying something is a tick, not a removal.
    name: "s56-check-off-is-not-remove",
    fixture: "empty",
    setup,
    turns: [
      {
        user: "cross off milk on my shopping list, I bought it",
        expect: {
          toolCall: ["checkSingleTaskChecklistItem", "checkRecurringTaskChecklistItem"],
          data: (data) =>
            all(intact(data), check(shop(data)?.checklist?.length === 3 && shop(data)?.checklist?.[0].checked === true, "milk should be ticked, and still on the list")),
        },
      },
    ],
  },
];
