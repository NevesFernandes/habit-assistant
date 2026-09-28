// §43: with the week set to start on Monday, "last week" means Monday to Sunday. Three
// one-off tasks sit around the boundary: the Monday and Sunday of last Monday-week, and
// the Sunday just before it, which a Sunday week would count as last week instead.
import { addDays, startOfWeek } from "../../../src/lib/recurrence.ts";
import type { AppData, SingleTask } from "../../../src/types/models.ts";
import type { Scenario } from "../types.ts";
import { todayISO } from "./helpers.ts";

const LAST_MONDAY = addDays(startOfWeek(todayISO(), 1), -7);

function task(id: string, name: string, startDate: string): SingleTask {
  return { kind: "singleTask", id, name, priority: 1, startDate, done: true, persistency: false };
}

export const scenarios: Scenario[] = [
  {
    name: "s43-last-week-starts-monday",
    fixture: "empty",
    setup: (data: AppData) => ({
      ...data,
      weekStartsOn: 1,
      singleTasks: [
        task("before", "Return library books", addDays(LAST_MONDAY, -1)),
        task("monday", "Call the plumber", LAST_MONDAY),
        task("sunday", "Water the plants", addDays(LAST_MONDAY, 6)),
      ],
    }),
    turns: [
      {
        user: "delete the tasks from last week",
        expect: {
          toolCall: "deleteSingleTasks",
          reply: [/delete these 2 tasks\?/, /Call the plumber/, /Water the plants/],
          notReply: /Return library books/,
        },
      },
    ],
  },
];
