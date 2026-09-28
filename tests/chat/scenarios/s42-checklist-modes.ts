// §42: a recurring task's checklist is per occurrence, either "carry over" (the default:
// unticked items move on to the next occurrence) or "same list" (a routine, unticked
// again each time). The agent only picks sameList when the user says so, the reply states
// the mode, and a checklist item can be ticked for an earlier day.
import { addDays } from "../../../src/lib/recurrence.ts";
import type { AppData } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { all, check, todayISO } from "./helpers.ts";

const YESTERDAY = addDays(todayISO(), -1);

export const scenarios: Scenario[] = [
  {
    name: "s42-default-carry-over",
    fixture: "empty",
    turns: [
      {
        user: "add a recurring task to go shopping every Saturday, with a checklist: milk and eggs",
        expect: {
          toolCall: "createRecurringTask",
          reply: [/Checklist mode: unticked items carry over/, /Assumed: .*unticked checklist items carry over/],
          data: (data: AppData) => {
            const task = data.recurringTasks[0];
            return all(
              check(!!task, "expected a recurring task"),
              check((task?.checklistMode ?? "carryOver") === "carryOver", `expected carryOver, got ${task?.checklistMode}`),
            );
          },
        },
      },
    ],
  },
  {
    name: "s42-create-same-list",
    fixture: "empty",
    turns: [
      {
        user: "add a cleaning routine every Sunday with the same checklist every week: floors, windows and bathroom",
        expect: {
          toolCall: "createRecurringTask",
          reply: /Checklist mode: same list every time/,
          notReply: /Assumed: .*checklist/,
          data: (data: AppData) =>
            check(data.recurringTasks[0]?.checklistMode === "sameList", `expected sameList, got ${data.recurringTasks[0]?.checklistMode}`),
        },
      },
    ],
  },
  {
    name: "s42-switch-to-same-list",
    fixture: "baseline",
    turns: [
      {
        user: "make the weekly shopping checklist reset every time",
        expect: {
          toolCall: "updateRecurringTask",
          reply: /Checklist mode: unticked items carry over to the next time → same list every time/,
          data: (data: AppData) =>
            check(
              data.recurringTasks.find((t) => t.id === "shopping")?.checklistMode === "sameList",
              "Weekly shopping should now be sameList",
            ),
        },
      },
    ],
  },
  {
    name: "s42-tick-yesterday",
    fixture: "baseline",
    turns: [
      {
        user: "I bought the eggs on my weekly shopping list yesterday",
        expect: {
          toolCall: "checkRecurringTaskChecklistItem",
          reply: /Checked off "eggs"/,
          data: (data: AppData) => {
            const eggs = data.recurringTasks.find((t) => t.id === "shopping")?.checklist?.find((i) => i.id === "eggs");
            return check(eggs?.doneOn === YESTERDAY, `expected eggs doneOn ${YESTERDAY}, got ${eggs?.doneOn}`);
          },
        },
      },
    ],
  },
];
