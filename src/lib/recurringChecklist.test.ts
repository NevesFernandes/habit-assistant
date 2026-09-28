// §42 in Roadmap.md: a Recurring Task's checklist per occurrence — "carryOver" (unticked
// items move on to the next occurrence) and "sameList" (a routine that starts unticked each
// time), plus switching between them. Plain-assert style, run under tsx because it reaches
// dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:recurringChecklist
import assert from "node:assert/strict";
import {
  addRecurringTask,
  addRecurringTaskChecklistItem,
  setRecurringTaskChecklistItemChecked,
  toggleRecurringTaskChecklistItem,
  updateRecurringTask,
} from "./dataStore.ts";
import { recurringTaskChecklistOn, withChecklistMode } from "./recurringChecklist.ts";
import { describeChanges, describeCreatedRecurringTask } from "./confirmations.ts";
import { DEFAULT_CATEGORIES, type AppData, type ChecklistMode, type RecurringTask } from "../types/models.ts";

// Weekly on Sundays.
const SUN1 = "2026-09-27";
const WED = "2026-09-30";
const SUN2 = "2026-10-04";
const SUN3 = "2026-10-11";

const empty: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [] };

function create(items: string[], checklistMode?: ChecklistMode): AppData {
  return addRecurringTask(empty, {
    name: "Go shopping",
    startDate: SUN1,
    recurrence: { type: "daysOfWeek", days: [0] },
    checklistItems: items,
    withChecklist: true,
    checklistMode,
  });
}

const task = (d: AppData): RecurringTask => d.recurringTasks[0];
const idOf = (d: AppData, text: string) => task(d).checklist!.find((item) => item.text === text)!.id;
const view = (d: AppData, date: string) =>
  (recurringTaskChecklistOn(task(d), date) ?? []).map((item) => `${item.checked ? "x" : " "} ${item.text}`);
const tick = (d: AppData, text: string, date: string, checked = true) =>
  setRecurringTaskChecklistItemChecked(d, task(d).id, idOf(d, text), checked, date);

// Carry over (the default): ticked items stay behind on their day, the rest move on.
{
  let d = create(["milk", "eggs", "bread"]);
  assert.equal(task(d).checklistMode, undefined);
  d = tick(d, "milk", SUN1);
  d = tick(d, "eggs", SUN1);
  assert.deepEqual(view(d, SUN1), ["x milk", "x eggs", "  bread"]);
  assert.deepEqual(view(d, SUN2), ["  bread"]);

  // Added mid-week: on the next trip, not on the last one.
  d = addRecurringTaskChecklistItem(d, task(d).id, "coffee", WED);
  assert.deepEqual(view(d, SUN1), ["x milk", "x eggs", "  bread"]);
  assert.deepEqual(view(d, SUN2), ["  bread", "  coffee"]);

  // Bread bought on the second trip: it shows unticked on the first, ticked on the second.
  d = tick(d, "bread", SUN2);
  assert.deepEqual(view(d, SUN1), ["x milk", "x eggs", "  bread"]);
  assert.deepEqual(view(d, SUN2), ["x bread", "  coffee"]);
  assert.deepEqual(view(d, SUN3), ["  coffee"]);

  // Unticking puts it back on every occurrence again.
  d = toggleRecurringTaskChecklistItem(d, task(d).id, idOf(d, "bread"), SUN2);
  assert.deepEqual(view(d, SUN3), ["  bread", "  coffee"]);
}

// Items saved before §42 (a shared list with stored ticks): ticked ones count as done
// in the past, unticked ones are on every occurrence.
{
  const legacy: RecurringTask = {
    kind: "recurringTask",
    id: "t",
    name: "Go shopping",
    priority: 1,
    startDate: "2026-09-01",
    recurrence: { type: "daysOfWeek", days: [0] },
    checklist: [
      { id: "a", text: "milk", checked: true },
      { id: "b", text: "eggs", checked: false },
    ],
  };
  assert.deepEqual(
    recurringTaskChecklistOn(legacy, SUN1)?.map((item) => item.text),
    ["eggs"],
  );
}

// Same list: every occurrence starts unticked; an added item joins from that day on.
{
  let d = create(["floors", "windows"], "sameList");
  d = tick(d, "floors", SUN1);
  assert.deepEqual(view(d, SUN1), ["x floors", "  windows"]);
  assert.deepEqual(view(d, SUN2), ["  floors", "  windows"]);
  d = addRecurringTaskChecklistItem(d, task(d).id, "dusting", SUN2);
  assert.deepEqual(view(d, SUN1), ["x floors", "  windows"]);
  assert.deepEqual(view(d, SUN2), ["  floors", "  windows", "  dusting"]);
  d = tick(d, "floors", SUN1, false);
  assert.deepEqual(view(d, SUN1), ["  floors", "  windows"]);
  assert.equal(task(d).checklistDoneByDate?.[SUN1], undefined);
}

// Switching carryOver → sameList: the routine is what's still on the list today, today's
// ticks kept; items finished earlier are dropped.
{
  let d = create(["milk", "eggs", "bread"]);
  d = tick(d, "milk", SUN1);
  d = tick(d, "eggs", SUN2);
  const switched = withChecklistMode(task(d), "sameList", SUN2);
  assert.deepEqual(switched.checklist!.map((item) => item.text), ["eggs", "bread"]);
  assert.deepEqual(
    recurringTaskChecklistOn(switched, SUN2)!.map((item) => `${item.checked ? "x" : " "} ${item.text}`),
    ["x eggs", "  bread"],
  );
  assert.deepEqual(
    recurringTaskChecklistOn(switched, SUN3)!.map((item) => item.checked),
    [false, false],
  );

  // …and back: everything pending again except today's ticks.
  const back = withChecklistMode(switched, "carryOver", SUN2);
  assert.deepEqual(
    recurringTaskChecklistOn(back, SUN2)!.map((item) => `${item.checked ? "x" : " "} ${item.text}`),
    ["x eggs", "  bread"],
  );
  assert.deepEqual(recurringTaskChecklistOn(back, SUN3)!.map((item) => item.text), ["bread"]);
  assert.equal(back.checklistDoneByDate, undefined);
}

// Asking for a mode on a task without a checklist gives it an empty one.
{
  const plain = addRecurringTask(empty, { name: "Clean", startDate: SUN1, recurrence: { type: "daysOfWeek", days: [0] } });
  const updated = updateRecurringTask(plain, plain.recurringTasks[0].id, { newChecklistMode: "sameList" });
  assert.deepEqual(updated.recurringTasks[0].checklist, []);
  assert.equal(updated.recurringTasks[0].checklistMode, "sameList");
}

// Confirmations state the mode; the default is flagged as assumed; a switch shows as a diff.
{
  const created = create(["milk"]);
  const text = describeCreatedRecurringTask(task(created), { name: "Go shopping", recurrence: { type: "daysOfWeek", days: [0] }, checklistItems: ["milk"] }, DEFAULT_CATEGORIES, "weekly shopping on sundays", SUN1);
  assert.match(text, /• Checklist: milk/);
  assert.match(text, /• Checklist mode: unticked items carry over to the next time/);
  assert.match(text, /Assumed: .*unticked checklist items carry over/);

  const routine = create(["floors"], "sameList");
  const routineText = describeCreatedRecurringTask(task(routine), { name: "Go shopping", recurrence: { type: "daysOfWeek", days: [0] }, checklistMode: "sameList" }, DEFAULT_CATEGORIES, "", SUN1);
  assert.match(routineText, /• Checklist mode: same list every time/);
  assert.doesNotMatch(routineText, /unticked checklist items carry over/);

  const after = withChecklistMode(task(created), "sameList", SUN1);
  assert.deepEqual(describeChanges(task(created), after, DEFAULT_CATEGORIES, SUN1), [
    "Checklist mode: unticked items carry over to the next time → same list every time",
  ]);
}

console.log("recurringChecklist.test.ts: all passed");
