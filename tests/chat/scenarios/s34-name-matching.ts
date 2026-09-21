// §34: generic words in the name the model sends ("shopping list" for a task called
// "Weekly shopping") shouldn't make matching fail. Measurement set — run with --repeat
// before and after the fix. The adjacent word-form gap this set first probed ("reading"
// vs a habit called "Read") turned out to be a separate problem and moved to
// s35-word-forms.ts.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check } from "./helpers.ts";

const NOT_FOUND = /couldn't find/;

function shoppingListHas(item: string) {
  return (data: AppData) => {
    const items = data.recurringTasks.find((task) => task.id === "shopping")?.checklist ?? [];
    return check(
      items.some((entry) => entry.text.toLowerCase() === item),
      `expected ${item} on "Weekly shopping", got ${items.map((entry) => entry.text).join(", ")}`,
    );
  };
}

export const scenarios: Scenario[] = [
  {
    name: "s34-generic-my-shopping-list",
    fixture: "baseline",
    turns: [{ user: "add milk to my shopping list", expect: { notReply: NOT_FOUND, data: shoppingListHas("milk") } }],
  },
  {
    name: "s34-generic-the-shopping-list",
    fixture: "baseline",
    turns: [{ user: "add bread to the shopping list", expect: { notReply: NOT_FOUND, data: shoppingListHas("bread") } }],
  },
  {
    name: "s34-generic-weekly-shopping-list",
    fixture: "baseline",
    turns: [
      { user: "put butter on the weekly shopping list", expect: { notReply: NOT_FOUND, data: shoppingListHas("butter") } },
    ],
  },
  {
    name: "s34-generic-dentist-task",
    fixture: "baseline",
    turns: [
      {
        user: "mark my dentist task as done",
        expect: {
          notReply: NOT_FOUND,
          data: (data) =>
            check(data.singleTasks.find((task) => task.id === "dentist")?.done === true, `"Call the dentist" should be done`),
        },
      },
    ],
  },
];
