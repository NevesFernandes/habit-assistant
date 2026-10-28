// §71: goals and challenges by chat: a total on an existing habit, a challenge on a new one
// (made in the same step, ending with it), then "how are my goals?".
import type { Scenario } from "../types.ts";
import { check } from "./helpers.ts";

export const scenarios: Scenario[] = [
  {
    name: "s71-total-on-existing",
    fixture: "baseline",
    turns: [
      {
        user: "I want to do 200 push-ups by the end of next month",
        expect: {
          toolCall: "setGoal",
          bucket: /goals/,
          reply: /^Goal set for "Push-ups": 200 reps by /,
          data: (d) => check(d.goals?.length === 1 && d.goals[0].itemId === "pushups" && d.goals[0].measure === "amount", "no amount goal on Push-ups"),
        },
      },
      { user: "how are my goals going?", expect: { toolCall: "getGoals", reply: /^"Push-ups": 200 reps by / } },
    ],
  },
  {
    name: "s71-challenge-new-item",
    fixture: "empty",
    turns: [
      {
        user: "start a 30-day no-sugar challenge",
        expect: {
          toolCall: "setGoal",
          reply: /a 30-day challenge/,
          data: (d) => {
            const habit = d.habits[0];
            return check(!!habit?.endDate && d.goals?.[0]?.kind === "challenge" && d.goals[0].target === 30 && d.goals[0].endsItem === true, "no challenge with its own habit");
          },
        },
      },
    ],
  },
];
