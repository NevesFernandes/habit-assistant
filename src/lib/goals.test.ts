// §71: goals and challenges (src/lib/goals.ts): totals by an end date, challenges of N days,
// progress and pace from the log, one running goal per item, finished ones kept.
// Run: npm run test:goals
import assert from "node:assert/strict";
import {
  activeCategoryGoalOf,
  activeGoalOf,
  describeGoals,
  describeProgress,
  goalProgress,
  goalsOverview,
  planChangeCategoryGoal,
  planChangeGoal,
  planGoalWithNewItem,
  planRemoveCategoryGoal,
  planRemoveGoal,
  planSetCategoryGoal,
  planSetGoal,
  type GoalPlan,
} from "./goals.ts";
import { deleteCategory, deleteHabits, setHabitValue, updateHabit } from "./dataStore.ts";
import { skipDay } from "./skip.ts";
import { planUndo, withUndoRecord } from "./undo.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { DEFAULT_CATEGORIES, type AppData, type Goal, type Habit, type RecurringTask } from "../types/models.ts";

const TODAY = "2026-10-28";
const habit = (id: string, extra: Partial<Habit> = {}): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning", startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno", ...extra,
});
const bins: RecurringTask = { kind: "recurringTask", id: "Bins", name: "Bins", dayPart: "evening", startDate: "2026-10-01", recurrence: { type: "daysOfWeek", days: [2] } };
const base: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [habit("Read"), habit("Run", { completionType: "value", target: 5, unit: "km" }), habit("Gym", { recurrence: { type: "timesPerPeriod", period: "week", count: 3 } })],
  recurringTasks: [bins],
  singleTasks: [],
  completionLog: [],
};
const ok = (plan: GoalPlan) => {
  assert.equal(plan.status, "ok", plan.status !== "ok" ? ("message" in plan ? plan.message : plan.question) : "");
  return plan as Extract<GoalPlan, { status: "ok" }>;
};
const refused = (plan: GoalPlan) => {
  assert.equal(plan.status, "rejected");
  return (plan as { message: string }).message;
};
const done = (data: AppData, id: string, dates: string[], value?: number) => ({
  ...data,
  completionLog: [...data.completionLog, ...dates.map((date) => ({ id: `${id}-${date}`, itemId: id, date, ...(value !== undefined ? { value } : {}) }))],
});
const item = (data: AppData, id: string) => [...data.habits, ...data.recurringTasks].find((i) => i.id === id)!;
const onlyGoal = (data: AppData): Goal => data.goals![data.goals!.length - 1];

// A total in done days, counted from today: nothing before it counts.
{
  const before = done(base, "Read", ["2026-10-20", "2026-10-27"]);
  const plan = ok(planSetGoal(before, item(before, "Read"), { kind: "total", target: 20, unit: "books", by: "2026-12-31" }, TODAY));
  const saved = plan.apply(before);
  const goal = onlyGoal(saved);
  assert.deepEqual({ ...goal, id: "x" }, { id: "x", kind: "total", target: 20, measure: "days", unit: "books", from: TODAY, to: "2026-12-31", itemId: "Read", createdOn: TODAY });
  assert.match(plan.message(saved), /^Goal set for "Read": 20 books by Thu 31 Dec\. Each day "Read" is done counts as one \(books\)\. 0 of 20 books; 65 days left, on track\.$/);
  const later = done(saved, "Read", [TODAY]);
  const p = goalProgress(later, goal, TODAY)!;
  assert.equal(p.done, 1);
  assert.equal(p.status, "active");
  assert.equal(p.pace!.needed, 19);
  assert.equal(p.pace!.reachable, true);
  assert.equal(activeGoalOf(later, "Read", TODAY)?.id, goal.id);
}

// "this year": an earlier start the user named counts what's already logged.
{
  const before = done(base, "Read", ["2025-12-31", "2026-10-05", "2026-10-27"]);
  const saved = ok(planSetGoal(before, item(before, "Read"), { kind: "total", target: 20, by: "2026-12-31", from: "2026-01-01" }, TODAY)).apply(before);
  const p = goalProgress(saved, onlyGoal(saved), TODAY)!;
  assert.equal(p.done, 2, "the days already logged inside the window count");
  assert.equal(p.unit, "times");
}

// An amount on a number habit adds up what was logged, partial days included; reaching it achieves it early.
{
  const plan = ok(planSetGoal(base, item(base, "Run"), { kind: "total", target: 12, by: "2026-11-30" }, TODAY));
  let data = plan.apply(base);
  assert.equal(onlyGoal(data).measure, "amount");
  data = setHabitValue(data, "Run", TODAY, 7);
  assert.equal(describeProgress(goalProgress(data, onlyGoal(data), TODAY)!, TODAY), "7 of 12 km; 34 days left, on track.");
  data = setHabitValue(data, "Run", "2026-10-29", 5.5);
  const p = goalProgress(data, onlyGoal(data), "2026-10-29")!;
  assert.equal(p.status, "achieved");
  assert.equal(describeProgress(p, "2026-10-29"), "Achieved: 12.5 km, goal 12 km.");
  assert.equal(activeGoalOf(data, "Run", "2026-10-29"), undefined, "an achieved total is finished: a new goal doesn't need to replace it");
  assert.equal(goalsOverview(data, "2026-10-29").finished.length, 1);
}

// An amount on a yes/no habit is refused with what it counts instead; a total needs a target and an end date, today or later.
{
  assert.match(refused(planSetGoal(base, item(base, "Read"), { kind: "total", target: 3, measure: "amount", by: "2026-12-01" }, TODAY)), /no amount to add up/);
  assert.match(refused(planSetGoal(base, item(base, "Read"), { kind: "total", target: 3 }, TODAY)), /By when\?/);
  assert.match(refused(planSetGoal(base, item(base, "Read"), { kind: "total", target: 3, by: "2026-10-01" }, TODAY)), /already passed/);
  assert.match(refused(planSetGoal(base, item(base, "Read"), { kind: "total", by: "2026-12-01" }, TODAY)), /target/);
}

// Behind and unreachable: a weekly task can't make 10 more done days in two weeks.
{
  const saved = ok(planSetGoal(base, bins, { kind: "total", target: 10, by: "2026-11-10" }, TODAY)).apply(base);
  const p = goalProgress(saved, onlyGoal(saved), TODAY)!;
  assert.equal(p.pace!.reachable, false);
  assert.match(describeProgress(p, TODAY), /not reachable on its current schedule/);
}

// A challenge: a miss doesn't end it; it's achieved only with no misses. Skipped days don't count against it.
{
  let data = ok(planSetGoal(base, item(base, "Read"), { kind: "challenge", target: 5 }, TODAY)).apply(base);
  const goal = onlyGoal(data);
  assert.equal(goal.to, "2026-11-01");
  data = done(data, "Read", [TODAY, "2026-10-30", "2026-11-01"]);
  data = skipDay(data, item(data, "Read"), "2026-10-31");
  const mid = goalProgress(data, goal, "2026-10-30")!;
  assert.equal(describeProgress(mid, "2026-10-30"), "2 of 3 due days done so far, 1 missed; 3 days left.");
  const end = goalProgress(data, goal, "2026-11-02")!;
  assert.equal(end.status, "missed");
  assert.equal(describeProgress(end, "2026-11-02"), "Finished with 3 of 4 due days done, 1 missed.");
  const perfect = goalProgress(done(data, "Read", ["2026-10-29"]), goal, "2026-11-02")!;
  assert.equal(perfect.status, "achieved");
  assert.equal(describeProgress(perfect, "2026-11-02"), "Achieved: every due day done (4 of 4).");
}

// No challenge on an "N times a week" habit: no day is due, so no day is missed. Too long is refused too.
{
  assert.match(refused(planSetGoal(base, item(base, "Gym"), { kind: "challenge", target: 30 }, TODAY)), /A total works instead/);
  assert.match(refused(planSetGoal(base, item(base, "Read"), { kind: "challenge", target: 400 }, TODAY)), /at most 366 days/);
}

// One running goal per item: a second asks first; replacing removes the old one.
{
  const first = ok(planSetGoal(base, item(base, "Read"), { kind: "total", target: 20, by: "2026-12-31" }, TODAY)).apply(base);
  const asked = planSetGoal(first, item(first, "Read"), { kind: "challenge", target: 30 }, TODAY);
  assert.equal(asked.status, "needs_confirm");
  assert.match((asked as { question: string }).question, /already has a goal: 20 times by Thu 31 Dec .*Replace it with a 30-day challenge/);
  const replaced = ok(planSetGoal(first, item(first, "Read"), { kind: "challenge", target: 30 }, TODAY, true));
  const after = replaced.apply(first);
  assert.equal(after.goals!.length, 1);
  assert.equal(onlyGoal(after).kind, "challenge");
  assert.match(replaced.message(after), /\(The old goal was removed\.\)$/);
}

// A challenge on a new item makes the item, which ends with the challenge; changing its length moves the end; removing keeps the item.
{
  const plan = ok(planGoalWithNewItem(base, { kind: "habit", name: "No sugar", categoryId: "nutrition", dayPart: "morning", recurrence: { type: "daily" } }, { kind: "challenge", target: 30 }, TODAY));
  let data = plan.apply(base);
  const made = data.habits.find((h) => h.name === "No sugar")!;
  assert.equal(made.endDate, "2026-11-26");
  assert.equal(onlyGoal(data).endsItem, true);
  assert.match(plan.message(data), /^Added the habit "No sugar"\. It ends with the challenge on Thu 26 Nov\. Goal set for "No sugar": a 30-day challenge/);
  const longer = ok(planChangeGoal(data, made, { days: 40 }, TODAY));
  data = longer.apply(data);
  assert.equal(data.habits.find((h) => h.id === made.id)!.endDate, "2026-12-06");
  assert.match(longer.message(data), /now ends on Sun 6 Dec too\.$/);
  const removed = ok(planRemoveGoal(data, data.habits.find((h) => h.id === made.id)!, TODAY));
  assert.match(removed.message(data), /still ends on Sun 6 Dec; say "remove its end date"/);
  data = removed.apply(data);
  assert.equal(data.goals!.length, 0);
  assert.equal(data.habits.find((h) => h.id === made.id)!.endDate, "2026-12-06");
  // A name already in use: the goal goes on that item instead of a new one.
  const onRead = ok(planGoalWithNewItem(base, { kind: "habit", name: "read", dayPart: "evening", recurrence: { type: "daily" } }, { kind: "challenge", target: 7 }, TODAY)).apply(base);
  assert.equal(onRead.habits.length, base.habits.length);
  assert.equal(onlyGoal(onRead).itemId, "Read");
  assert.equal(onlyGoal(onRead).endsItem, undefined);
}

// Changing a total's target or end date; no goal to change or remove is refused.
{
  const data = ok(planSetGoal(base, item(base, "Read"), { kind: "total", target: 20, by: "2026-12-31" }, TODAY)).apply(base);
  const changed = ok(planChangeGoal(data, item(data, "Read"), { target: 25, by: "2027-01-31" }, TODAY));
  const after = changed.apply(data);
  assert.equal(onlyGoal(after).target, 25);
  assert.equal(onlyGoal(after).to, "2027-01-31");
  assert.match(changed.message(after), /^Changed the goal for "Read": 25 times by Sun 31 Jan 2027\./);
  assert.match(refused(planChangeGoal(base, item(base, "Read"), { target: 3 }, TODAY)), /no goal running/);
  assert.match(refused(planRemoveGoal(base, item(base, "Read"), TODAY)), /no goal running/);
}

// An archived item takes no goal; deleting an item deletes its goals.
{
  const archived = { ...base, habits: base.habits.map((h) => (h.id === "Read" ? { ...h, endDate: "2026-10-20" } : h)) };
  assert.match(refused(planSetGoal(archived, item(archived, "Read"), { kind: "challenge", target: 7 }, TODAY)), /archived/);
  const data = ok(planSetGoal(base, item(base, "Read"), { kind: "challenge", target: 7 }, TODAY)).apply(base);
  assert.equal(deleteHabits(data, ["Read"]).goals!.length, 0);
}

// Overview and wording: running goals first, finished ones listed after.
{
  let data = ok(planSetGoal(base, item(base, "Read"), { kind: "challenge", target: 7 }, TODAY)).apply(base);
  data = ok(planSetGoal(data, item(data, "Run"), { kind: "total", target: 5, by: "2026-11-30" }, TODAY)).apply(data);
  data = setHabitValue(data, "Run", TODAY, 5);
  const text = describeGoals(data, TODAY);
  assert.match(text, /^"Read": a 7-day challenge, today \(Wed 28 Oct\) to Tue 3 Nov\. 0 of 1 due days done so far; 7 days left\.\nFinished: "Run" achieved \(5 km by Mon 30 Nov\)\.$/);
  assert.match(describeGoals(base, TODAY), /^You have no goals yet\./);
}

// Undo (§70) takes a goal change back.
{
  const plan = ok(planSetGoal(base, item(base, "Read"), { kind: "challenge", target: 7 }, TODAY));
  const saved = withUndoRecord(base, plan.apply(base), "app", TODAY);
  const undo = planUndo(saved, "app", TODAY);
  assert.equal(undo.status, "ok");
  const back = (undo as Extract<typeof undo, { status: "ok" }>);
  assert.equal(back.message, 'Undone: I put the goal on "Read" back as it was.');
  assert.equal(back.apply(saved).goals, undefined);
  const removed = withUndoRecord(saved, ok(planRemoveGoal(saved, item(saved, "Read"), TODAY)).apply(saved), "app", TODAY);
  const again = planUndo(removed, "app", TODAY) as Extract<ReturnType<typeof planUndo>, { status: "ok" }>;
  assert.equal(again.apply(removed).goals!.length, 1);
}

// --- §81: goals across a category ---------------------------------------------------------

{
  const sports: AppData = {
    categories: DEFAULT_CATEGORIES,
    habits: [
      habit("Gym", { categoryId: "sports" }),
      habit("Swim", { categoryId: "sports", recurrence: { type: "daysOfWeek", days: [6] } }),
      habit("Cycle", { categoryId: "sports", completionType: "timer", target: 30 }),
      habit("Row", { categoryId: "sports", completionType: "value", target: 2, unit: "km" }),
      habit("Read", { categoryId: "study", completionType: "timer", target: 20 }),
    ],
    recurringTasks: [{ ...bins, categoryId: "sports" }],
    singleTasks: [
      { kind: "singleTask", id: "shoes", name: "Buy shoes", categoryId: "sports", startDate: TODAY, done: true, doneOn: TODAY, persistency: true },
      { kind: "singleTask", id: "kit", name: "Wash kit", categoryId: "sports", startDate: TODAY, done: false, persistency: true },
    ],
    completionLog: [],
  };
  const quarter = "2026-12-31";
  // "times": every completion counts, one-off tasks by the day marked done; earlier days don't.
  const plan = ok(planSetCategoryGoal(sports, "sports", { kind: "total", target: 50, by: quarter }, TODAY));
  let data = done(plan.apply(sports), "Gym", ["2026-10-27", TODAY]);
  data = done(data, "Bins", [TODAY]);
  const goal = onlyGoal(data);
  assert.deepEqual([goal.categoryId, goal.itemId, goal.measure], ["sports", undefined, "times"]);
  assert.match(plan.message(data), /^Goal set for "Sports" \(category\): 50 times by Thu 31 Dec\. Every habit, task and one-off task done in it counts as one, including ones added to it later\. 3 of 50 times;/);
  // "days": the same day counts once.
  const days = ok(planSetCategoryGoal(sports, "sports", { kind: "total", target: 20, measure: "days", by: quarter }, TODAY)).apply(sports);
  assert.equal(goalProgress(done(done(days, "Gym", [TODAY]), "Swim", [TODAY]), onlyGoal(days), TODAY)!.done, 1, "two habits and a one-off task, all today: one day");
  // Membership is live: an item moved in later counts with its days in the window; moved out, it leaves.
  const moved = updateHabit(done(data, "Read", [TODAY], 20), "Read", { newCategoryId: "sports" }, TODAY);
  assert.equal(goalProgress(moved, goal, TODAY)!.done, 4);
  assert.equal(goalProgress(updateHabit(moved, "Gym", { newCategoryId: "health" }, TODAY), goal, TODAY)!.done, 3);
  // "habits only".
  const habitsOnly = ok(planSetCategoryGoal(sports, "sports", { kind: "total", target: 10, by: quarter, itemKind: "habit" }, TODAY)).apply(sports);
  assert.equal(goalProgress(data, { ...onlyGoal(habitsOnly) }, TODAY)!.done, 1, "only Gym is a habit done today");
  assert.match(describeGoals(habitsOnly, TODAY), /10 times \(habits only\) by/);
  // Amounts: the unit must be named when the category has several; hours count timer minutes; other units are left out and named.
  assert.match(refused(planSetCategoryGoal(sports, "sports", { kind: "total", target: 10, measure: "amount", by: quarter }, TODAY)), /different units \(min, km\)/);
  const hours = ok(planSetCategoryGoal(sports, "sports", { kind: "total", target: 10, measure: "amount", unit: "hours", by: quarter }, TODAY));
  let timed = hours.apply(sports);
  assert.deepEqual([onlyGoal(timed).target, onlyGoal(timed).unit], [600, "min"]);
  timed = setHabitValue(setHabitValue(timed, "Cycle", TODAY, 90), "Row", TODAY, 5);
  assert.equal(describeProgress(goalProgress(timed, onlyGoal(timed), TODAY)!, TODAY), "1 h 30 min of 10 h; 65 days left, on track. Not counted (another unit): Row.");
  assert.match(refused(planSetCategoryGoal(sports, "sports", { kind: "total", target: 10, measure: "amount", unit: "pages", by: quarter }, TODAY)), /Nothing in "Sports" logs pages/);
  // Totals only; an empty category has nothing to count.
  assert.match(refused(planSetCategoryGoal(sports, "sports", { kind: "challenge", target: 30 }, TODAY)), /A challenge goes on one habit/);
  assert.match(refused(planSetCategoryGoal(sports, "finance", { kind: "total", target: 3, by: quarter }, TODAY)), /nothing in "Finance"/);
  // One running goal per category, apart from item goals; replacing asks.
  assert.equal(planSetCategoryGoal(data, "sports", { kind: "total", target: 9, by: quarter }, TODAY).status, "needs_confirm");
  const withItem = ok(planSetGoal(data, data.habits[0], { kind: "total", target: 5, by: quarter }, TODAY)).apply(data);
  assert.equal(withItem.goals!.length, 2);
  assert.equal(activeCategoryGoalOf(withItem, "sports", TODAY)?.id, goal.id);
  // Change, overview label, remove; an empty category deleted takes its goal.
  const changed = ok(planChangeCategoryGoal(data, "sports", { target: 60 }, TODAY));
  assert.match(changed.message(changed.apply(data)), /^Changed the goal for "Sports" \(category\): 60 times/);
  assert.match(describeGoals(data, TODAY), /^"Sports" \(category\): 50 times by/);
  assert.match(ok(planRemoveCategoryGoal(data, "sports", TODAY)).message(data), /Its items and their own goals are untouched/);
  assert.equal(deleteCategory(data, "sports").goals!.length, 0);
  // Undo takes a category goal back.
  const recorded = withUndoRecord(sports, plan.apply(sports), "app", TODAY);
  const back = planUndo(recorded, "app", TODAY) as Extract<ReturnType<typeof planUndo>, { status: "ok" }>;
  assert.equal(back.message, 'Undone: I put the goal on "Sports" back as it was.');
  assert.equal(back.apply(recorded).goals, undefined);
}

// The app's chat, through the engine: set, replace (asked first), unknown name, a one-off task, change, check, remove.
{
  let saved: AppData = { ...base, singleTasks: [{ kind: "singleTask", id: "bank", name: "Call the bank", startDate: TODAY, done: false, persistency: true }] };
  let next: AgentToolCall;
  const session = new ChatSession({
    getData: () => saved,
    persist: async (mutate) => {
      saved = mutate(saved);
      return true;
    },
    callAgent: async () => ({ toolCall: { ...next, id: String(Math.random()) } as AgentToolCall & { id: string } }),
    todayISO: () => TODAY,
  });
  const last = () => {
    const message = session.messages.filter((m) => m.role === "assistant").pop();
    return message && "content" in message ? (message.content as string) : "";
  };
  next = { name: "setGoal", input: { name: "read", kind: "total", target: 20, unit: "books", by: "2026-12-31" } };
  await session.send("read 20 books by december");
  assert.match(last(), /^Goal set for "Read": 20 books by Thu 31 Dec\./);
  next = { name: "setGoal", input: { name: "read", kind: "challenge", target: 30 } };
  await session.send("start a 30 day reading challenge");
  assert.match(last(), /already has a goal/);
  next = { name: "confirmPendingAction", input: { confirmed: true } };
  await session.send("yes");
  assert.match(last(), /a 30-day challenge.*\(The old goal was removed\.\)$/);
  assert.equal(saved.goals!.length, 1);
  next = { name: "setGoal", input: { name: "no sugar", kind: "challenge", target: 30 } };
  await session.send("30-day no sugar challenge");
  assert.equal(last(), 'You don\'t have anything called "no sugar" yet. Say "add it" and I\'ll make it a new habit with this goal.');
  next = { name: "setGoal", input: { kind: "challenge", target: 30, newItem: { kind: "habit", name: "No sugar", categoryId: "nutrition", dayPart: "morning", recurrence: { type: "daily" } } } };
  await session.send("add it");
  assert.match(last(), /^Added the habit "No sugar"\. It ends with the challenge on Thu 26 Nov\./);
  next = { name: "setGoal", input: { name: "bank", kind: "total", target: 1, by: "2026-11-01" } };
  await session.send("call the bank once by november");
  assert.equal(last(), '"Call the bank" is a one-off task. A goal goes on a habit or a recurring task.');
  next = { name: "changeGoal", input: { name: "no sugar", newDays: 40 } };
  await session.send("make the no sugar challenge 40 days");
  assert.match(last(), /^Changed the goal for "No sugar": a 40-day challenge/);
  next = { name: "getGoals", input: {} };
  await session.send("how are my goals?");
  assert.match(last(), /^"No sugar": a 40-day challenge.*\n"Read": a 30-day challenge/);
  next = { name: "removeGoal", input: { name: "read" } };
  await session.send("drop my reading challenge");
  assert.match(last(), /^Removed the goal on "Read"\./);
  next = { name: "undoLastChange", input: {} } as AgentToolCall;
  await session.send("undo that");
  assert.equal(last(), 'Undone: I put the goal on "Read" back as it was.');
  assert.equal(saved.goals!.length, 2);
}

// §81 through the engine: a category goal by name, asked before replacing, shown, removed.
{
  let saved: AppData = { ...base, habits: base.habits.map((h) => ({ ...h, categoryId: "sports" })) };
  let next: AgentToolCall;
  const session = new ChatSession({
    getData: () => saved,
    persist: async (mutate) => {
      saved = mutate(saved);
      return true;
    },
    callAgent: async () => ({ toolCall: { ...next, id: String(Math.random()) } as AgentToolCall & { id: string } }),
    todayISO: () => TODAY,
  });
  const last = () => {
    const message = session.messages.filter((m) => m.role === "assistant").pop();
    return message && "content" in message ? (message.content as string) : "";
  };
  next = { name: "setGoal", input: { acrossCategory: "Sports", kind: "total", target: 50, by: "2026-12-31" } };
  await session.send("work out 50 times this quarter");
  assert.match(last(), /^Goal set for "Sports" \(category\): 50 times by Thu 31 Dec\./);
  next = { name: "setGoal", input: { acrossCategory: "sports", kind: "total", target: 30, measure: "days", by: "2026-12-31" } };
  await session.send("actually 30 days of exercise this quarter");
  assert.match(last(), /"Sports" already has a goal/);
  next = { name: "confirmPendingAction", input: { confirmed: true } };
  await session.send("yes");
  assert.match(last(), /30 days by Thu 31 Dec.*\(The old goal was removed\.\)$/);
  next = { name: "getGoals", input: { acrossCategory: "sports" } };
  await session.send("how's my sports goal?");
  assert.match(last(), /^"Sports" \(category\): 30 days by/);
  next = { name: "setGoal", input: { acrossCategory: "juggling", kind: "total", target: 3, by: "2026-12-31" } };
  await session.send("juggle 3 times this year");
  assert.equal(last(), 'There\'s no category called "juggling".');
  next = { name: "removeGoal", input: { acrossCategory: "sports" } };
  await session.send("drop my sports goal");
  assert.match(last(), /^Removed the goal on "Sports" \(category\)/);
}

console.log("goals.test.ts: all passed");
