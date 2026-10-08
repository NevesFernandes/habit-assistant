// §56 in Roadmap.md: taking an item off a checklist, or the checklist off a task — what
// gets stored for each item type, and what the chat engine does with the two remove tools
// (driven here with a scripted tool call instead of a model). Plain-assert style, run
// under tsx because it reaches dataStore.ts, whose imports carry no file extensions.
// Run: npm run test:checklistRemoval
import assert from "node:assert/strict";
import { ChatSession } from "./chatEngine.ts";
import type { AgentResponse } from "./agentClient.ts";
import {
  addRecurringTask,
  addRecurringTaskChecklistItem,
  removeHabitChecklistItem,
  removeRecurringTaskChecklist,
  removeRecurringTaskChecklistItem,
  removeSingleTaskChecklist,
  removeSingleTaskChecklistItem,
  setHabitChecklistItemChecked,
  setRecurringTaskChecklistItemChecked,
  updateRecurringTask,
} from "./dataStore.ts";
import { recurringTaskChecklistOn } from "./recurringChecklist.ts";
import { checklistItemsForEntry, checklistProgress, isHabitEntryComplete } from "./habitStats.ts";
import { currentHabitChecklist } from "./habitChecklist.ts";
import { DEFAULT_CATEGORIES, type AppData, type ChecklistMode, type Habit, type RecurringTask, type SingleTask } from "../types/models.ts";

// Weekly on Sundays.
const SUN1 = "2026-09-27";
const WED = "2026-09-30";
const SUN2 = "2026-10-04";
const SUN3 = "2026-10-11";

const empty: AppData = { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [] };

function shopping(items: string[], checklistMode?: ChecklistMode): AppData {
  return addRecurringTask(empty, {
    name: "Weekly shopping",
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
const remove = (d: AppData, text: string, date: string) => removeRecurringTaskChecklistItem(d, task(d).id, idOf(d, text), date);

// Carry over: the item ends on the day it's removed; earlier occurrences keep it.
{
  let d = shopping(["milk", "eggs", "bread"]);
  d = setRecurringTaskChecklistItemChecked(d, task(d).id, idOf(d, "milk"), true, SUN1);
  d = remove(d, "eggs", SUN2);
  assert.deepEqual(view(d, SUN1), ["x milk", "  eggs", "  bread"]);
  assert.deepEqual(view(d, SUN2), ["  bread"]);
  assert.deepEqual(view(d, SUN3), ["  bread"]);

  // Added and removed before it ever showed on an occurrence (a typo): dropped outright.
  d = addRecurringTaskChecklistItem(d, task(d).id, "mlik", WED);
  d = remove(d, "mlik", WED);
  assert.ok(!task(d).checklist!.some((item) => item.text === "mlik"));
  assert.deepEqual(view(d, SUN2), ["  bread"]);

  // Removing the last one leaves an empty checklist, not a plain task.
  d = remove(d, "bread", SUN2);
  assert.deepEqual(view(d, SUN2), []);
  assert.ok(Array.isArray(task(d).checklist));
}

// Same list: the item leaves the routine from that day on; earlier days keep their ticks.
{
  let d = shopping(["floors", "windows"], "sameList");
  d = setRecurringTaskChecklistItemChecked(d, task(d).id, idOf(d, "windows"), true, SUN1);
  d = remove(d, "windows", SUN2);
  assert.deepEqual(view(d, SUN1), ["  floors", "x windows"]);
  assert.deepEqual(view(d, SUN2), ["  floors"]);
  assert.deepEqual(view(d, SUN3), ["  floors"]);

  // A later mode switch doesn't bring it back.
  d = updateRecurringTask(d, task(d).id, { newChecklistMode: "carryOver" });
  assert.ok(!(recurringTaskChecklistOn(task(d), SUN3) ?? []).some((item) => item.text === "windows"));
}

// Removing the checklist: back to a plain task, with the mode and ticks gone too.
{
  let d = shopping(["floors"], "sameList");
  d = setRecurringTaskChecklistItemChecked(d, task(d).id, idOf(d, "floors"), true, SUN1);
  d = removeRecurringTaskChecklist(d, task(d).id);
  assert.equal(task(d).checklist, undefined);
  assert.equal(task(d).checklistMode, undefined);
  assert.equal(task(d).checklistDoneByDate, undefined);
  assert.equal(recurringTaskChecklistOn(task(d), SUN1), undefined);
  assert.equal(task(d).name, "Weekly shopping");
}

const errand: SingleTask = {
  kind: "singleTask",
  id: "errand",
  name: "Hardware store",
  priority: 1,
  startDate: SUN2,
  done: false,
  persistency: true,
  checklist: [
    { id: "c1", text: "screws", checked: true },
    { id: "c2", text: "oat milk", checked: false },
    { id: "c3", text: "milk", checked: false },
  ],
};

// One-off task: the item is simply gone; removing the checklist leaves the task.
{
  const d = removeSingleTaskChecklistItem({ ...empty, singleTasks: [errand] }, "errand", "c1");
  assert.deepEqual(d.singleTasks[0].checklist!.map((item) => item.text), ["oat milk", "milk"]);
  const plain = removeSingleTaskChecklist(d, "errand");
  assert.equal(plain.singleTasks[0].checklist, undefined);
  assert.equal(plain.singleTasks.length, 1);
}

const routine: Habit = {
  kind: "habit",
  id: "routine",
  name: "Morning routine",
  categoryId: "health",
  priority: 1,
  startDate: SUN1,
  recurrence: { type: "daily" },
  completionType: "checklist",
  checklist: [
    { id: "s1", text: "stretch", checked: false },
    { id: "s2", text: "floss", checked: false },
  ],
};

// Checklist habit: the step is gone from that day on; every earlier day keeps it — both a
// day with a saved record (something was ticked) and a day nobody touched, which is shown
// from the habit's own steps.
{
  let d: AppData = { ...empty, habits: [routine] };
  const entryOn = (date: string) => d.completionLog.find((e) => e.date === date);
  const shown = (date: string) => checklistItemsForEntry(d.habits[0], entryOn(date), date).map((item) => `${item.checked ? "x" : " "} ${item.text}`);
  d = setHabitChecklistItemChecked(d, "routine", "s1", true, SUN1);
  d = setHabitChecklistItemChecked(d, "routine", "s1", true, SUN2);
  assert.equal(isHabitEntryComplete(d.habits[0], entryOn(SUN2)), false);
  d = removeHabitChecklistItem(d, "routine", "s2", SUN2);
  assert.deepEqual(currentHabitChecklist(d.habits[0]).map((item) => item.text), ["stretch"]);
  assert.deepEqual(shown(SUN1), ["x stretch", "  floss"]);
  assert.deepEqual(shown(WED), ["  stretch", "  floss"], "an untouched earlier day keeps the removed step");
  assert.deepEqual(checklistProgress(d.habits[0], entryOn(WED), WED), { checked: 0, total: 2 });
  assert.deepEqual(shown(SUN2), ["x stretch"]);
  assert.deepEqual(shown(SUN3), ["  stretch"]);
  // The only step left that day was already ticked, so the day now counts as done.
  assert.equal(isHabitEntryComplete(d.habits[0], entryOn(SUN2)), true);

  // Ticking on an earlier untouched day afterwards records that day's steps, the removed one included.
  d = setHabitChecklistItemChecked(d, "routine", "s2", true, WED);
  assert.deepEqual(shown(WED), ["  stretch", "x floss"]);
  // A new day starts without it.
  d = setHabitChecklistItemChecked(d, "routine", "s1", true, SUN3);
  assert.deepEqual(shown(SUN3), ["x stretch"]);

  // A habit that only starts today has no earlier days: a mistyped step is dropped outright.
  const fresh = removeHabitChecklistItem({ ...empty, habits: [{ ...routine, startDate: SUN2 }] }, "routine", "s2", SUN2);
  assert.deepEqual(fresh.habits[0].checklist!.map((item) => item.text), ["stretch"]);
}

// --- The chat engine, with the model's tool call scripted. ---
async function chat(start: AppData, turns: { user: string; call: { name: string; input: Record<string, unknown> } }[]) {
  let data = start;
  let next = 0;
  const session = new ChatSession({
    getData: () => data,
    persist: async (mutate) => {
      data = mutate(data);
      return true;
    },
    callAgent: async () => ({ toolCall: { id: `call-${next}`, ...turns[next++].call } }) as AgentResponse,
    todayISO: () => SUN2,
  });
  const replies: string[] = [];
  for (const turn of turns) {
    const before = session.messages.length;
    await session.send(turn.user);
    replies.push(
      session.messages
        .slice(before)
        .filter((message) => message.role === "assistant")
        .map((message) => ("content" in message ? message.content : ""))
        .join("\n"),
    );
  }
  return { data: () => data, replies, session };
}

const removeItems = (name: string, items: string[]) => ({ name: "removeChecklistItems", input: { name, items } });
const removeChecklist = (name: string) => ({ name: "removeTaskChecklist", input: { name } });
const confirm = (confirmed: boolean) => ({ name: "confirmPendingAction", input: { confirmed } });
const world: AppData = { ...shopping(["milk", "eggs", "bread"]), singleTasks: [errand], habits: [routine] };

// The model never says which item type it is: the app finds the owner of the list.
{
  const r = await chat(world, [{ user: "remove eggs from my shopping list", call: removeItems("shopping list", ["eggs"]) }]);
  assert.equal(r.replies[0], 'Removed "eggs" from "Weekly shopping". Still on the list: milk, bread.');
  assert.deepEqual(view(r.data(), SUN2), ["  milk", "  bread"]);
  assert.equal(r.data().recurringTasks.length, 1, "the task itself stays");
}

// Several at once; one that isn't there is reported, the rest are still removed.
{
  const r = await chat(world, [{ user: "take milk, bread and jam off the shopping list", call: removeItems("shopping", ["milk", "bread", "jam"]) }]);
  assert.equal(r.replies[0], 'Removed "milk" and "bread" from "Weekly shopping". Still on the list: eggs. I couldn\'t find "jam" on "Weekly shopping".');
  assert.deepEqual(view(r.data(), SUN2), ["  eggs"]);
}

// An exact item name wins over a longer one containing it; a fragment matching two asks.
{
  const exact = await chat(world, [{ user: "remove milk from the hardware store list", call: removeItems("hardware", ["milk"]) }]);
  assert.deepEqual(exact.data().singleTasks[0].checklist!.map((item) => item.text), ["screws", "oat milk"]);

  const vague = await chat(world, [{ user: "remove mil from the hardware store list", call: removeItems("hardware", ["mil"]) }]);
  assert.match(vague.replies[0], /More than one item on "Hardware store" matches "mil": "oat milk", "milk"\. Which one did you mean\?/);
  assert.equal(vague.data().singleTasks[0].checklist!.length, 3, "nothing removed while it's unclear");
}

// A checklist habit loses a step, but never its last one.
{
  const r = await chat(world, [
    { user: "remove floss from my morning routine", call: removeItems("morning routine", ["floss"]) },
    { user: "remove stretch too", call: removeItems("morning routine", ["stretch"]) },
  ]);
  assert.equal(r.replies[0], 'Removed "floss" from "Morning routine". Still on the list: stretch.');
  assert.match(r.replies[1], /needs at least one step/);
  assert.deepEqual(currentHabitChecklist(r.data().habits[0]).map((item) => item.text), ["stretch"]);
}

// Not found, and found but without a checklist.
{
  const plainTask: SingleTask = { ...errand, id: "plain", name: "Call the dentist", checklist: undefined };
  const r = await chat({ ...world, singleTasks: [errand, plainTask] }, [
    { user: "remove milk from my gym list", call: removeItems("gym", ["milk"]) },
    { user: "remove milk from the dentist task", call: removeItems("dentist", ["milk"]) },
    { user: "remove the checklist from the dentist task", call: removeChecklist("dentist") },
  ]);
  assert.equal(r.replies[0], 'I couldn\'t find a task or habit matching "gym".');
  assert.equal(r.replies[1], '"Call the dentist" doesn\'t have a checklist.');
  assert.equal(r.replies[2], '"Call the dentist" doesn\'t have a checklist.');
}

// Removing a checklist that still has items asks first, and "no" changes nothing.
{
  const declined = await chat(world, [
    { user: "remove the checklist from the shopping task", call: removeChecklist("shopping") },
    { user: "no", call: confirm(false) },
  ]);
  assert.equal(declined.replies[0], 'Remove the checklist from "Weekly shopping"? It has 3 items (milk, eggs, bread), which will be deleted too. The task itself stays.');
  assert.equal(declined.replies[1], 'Okay, I left the checklist on "Weekly shopping".');
  assert.equal(task(declined.data()).checklist!.length, 3);

  const confirmed = await chat(world, [
    { user: "remove the checklist from the shopping task", call: removeChecklist("shopping") },
    { user: "yes", call: confirm(true) },
  ]);
  assert.equal(confirmed.replies[1], 'Removed the checklist from "Weekly shopping". The task itself is unchanged.');
  assert.equal(task(confirmed.data()).checklist, undefined);
  assert.equal(confirmed.data().recurringTasks.length, 1);
}

// An empty checklist goes without a question.
{
  const emptyList: SingleTask = { ...errand, checklist: [] };
  const r = await chat({ ...empty, singleTasks: [emptyList] }, [{ user: "remove the checklist from the hardware store task", call: removeChecklist("hardware") }]);
  assert.equal(r.replies[0], 'Removed the checklist from "Hardware store". The task itself is unchanged.');
  assert.equal(r.data().singleTasks[0].checklist, undefined);
  assert.equal(r.session.pendingConfirmation, null);
}

// A habit's checklist is how it's tracked: explained, not removed.
{
  const r = await chat({ ...empty, habits: [routine] }, [{ user: "remove the checklist from my morning routine", call: removeChecklist("morning routine") }]);
  assert.match(r.replies[0], /is a habit tracked with its checklist/);
  assert.equal(r.data().habits[0].checklist!.length, 2);
}

console.log("checklistRemoval.test.ts: all passed");
