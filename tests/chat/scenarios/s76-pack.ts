// §76: a set of items made for the user: the list first, nothing added before a yes. Hard
// for small models (several full items in one call), so a failure here may be the model's.
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { check } from "./helpers.ts";

const count = (d: AppData) => d.habits.length + d.recurringTasks.length + d.singleTasks.length;

export const scenarios: Scenario[] = [
  {
    name: "s76-morning-routine",
    fixture: "empty",
    turns: [
      {
        user: "set me up a morning routine: I get up at 6:30, I want more energy, and I have 20 minutes",
        expect: { toolCall: "createPack", bucket: /pack/, reply: /^Here's .*\n1\. [\s\S]*Add (these \d+|it)\?/, data: (d) => check(count(d) === 0, "added before the yes") },
      },
      { user: "yes, without 1", expect: { reply: /^Added /, data: (d) => check(count(d) >= 1, "nothing added") } },
    ],
  },
];
