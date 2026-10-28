// §70: "undo that" (src/lib/undo.ts): the last change per side, by diffing the file, put back
// only if nothing changed it since, only the same day. Then the app's chat through the engine.
// Run: npm run test:undo
import assert from "node:assert/strict";
import { planUndo, withUndoRecord } from "./undo.ts";
import { addHabit, deleteHabits, setHabitDone } from "./dataStore.ts";
import { setDayNote } from "./dayNotes.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { DEFAULT_CATEGORIES, type AppData, type Habit } from "../types/models.ts";

const TODAY = "2026-10-28";
const habit = (id: string): Habit => ({
  kind: "habit", id, name: id, categoryId: "health", dayPart: "morning", startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno",
});
const base: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [habit("Floss"), habit("Gym")],
  recurringTasks: [],
  singleTasks: [{ kind: "singleTask", id: "bank", name: "Call the bank", startDate: "2026-10-20", done: false, persistency: true }],
  completionLog: [{ id: "g1", itemId: "Gym", date: "2026-10-27" }],
};
const change = (before: AppData, mutate: (d: AppData) => AppData, side: "app" | "claude" = "app") => withUndoRecord(before, mutate(before), side, TODAY);
const undo = (data: AppData, side: "app" | "claude" = "app") => {
  const plan = planUndo(data, side, TODAY);
  assert.equal(plan.status, "ok", plan.status === "rejected" ? plan.message : "");
  const p = plan as Extract<typeof plan, { status: "ok" }>;
  return { data: p.apply(data), message: p.message };
};

// Marked done, then undone: back as it was, and a second undo has nothing to undo.
{
  const done = change(base, (d) => setHabitDone(d, "Floss", TODAY, true));
  assert.ok(done.undo?.app);
  const back = undo(done);
  assert.equal(back.message, 'Undone: I put "Floss" back as it was.');
  assert.deepEqual(back.data.completionLog, base.completionLog);
  assert.equal(planUndo(back.data, "app", TODAY).status, "rejected");
  assert.equal((planUndo(back.data, "app", TODAY) as { message: string }).message, "There's nothing to undo.");
}

// A delete comes back with its history; a create goes away.
{
  const gone = change(base, (d) => deleteHabits(d, ["Gym"]));
  const back = undo(gone);
  assert.equal(back.message, 'Undone: I brought back "Gym" with its history.');
  assert.deepEqual(back.data.habits.find((h) => h.id === "Gym"), base.habits[1]);
  assert.deepEqual(back.data.completionLog, base.completionLog);
  const added = change(base, (d) => addHabit(d, { name: "Read", categoryId: "study", dayPart: "evening", recurrence: { type: "daily" } }, TODAY));
  const removed = undo(added);
  assert.equal(removed.message, 'Undone: I removed "Read".');
  assert.equal(removed.data.habits.some((h) => h.name === "Read"), false);
}

// The week start, and a note.
{
  const monday = change(base, (d) => ({ ...d, weekStartsOn: 1 }));
  const back = undo(monday);
  assert.equal(back.message, "Undone: I set the week back to start on Sunday.");
  assert.equal(back.data.weekStartsOn, undefined);
  const noted = change(base, (d) => setDayNote(d, "Floss", TODAY, "gums sore"));
  assert.deepEqual(undo(noted).data.notes, []);
}

// Never over a newer change; never another day; each side its own.
{
  const done = change(base, (d) => setHabitDone(d, "Floss", TODAY, true));
  const noteAfter = setDayNote(setHabitDone(done, "Floss", TODAY, false), "Floss", TODAY, "x"); // changed since, not by chat
  const refused = planUndo(noteAfter, "app", TODAY);
  assert.deepEqual(refused, { status: "rejected", message: '"Floss" changed again since then, so I can\'t undo that without losing the newer change.' });
  assert.match((planUndo(done, "app", "2026-10-29") as { message: string }).message, /earlier day/);
  assert.equal(planUndo(done, "claude", TODAY).status, "rejected");
  const both = change(done, (d) => setHabitDone(d, "Gym", TODAY, true), "claude");
  assert.ok(both.undo?.app && both.undo?.claude);
  const claudeBack = undo(both, "claude");
  assert.ok(claudeBack.data.undo?.app); // the app's own stays
  assert.equal(claudeBack.data.undo?.claude, undefined);
  // A save that touched nothing undo looks after keeps the last change.
  assert.equal(withUndoRecord(done, { ...done, timeZone: "Europe/Lisbon" }, "app", TODAY).undo, done.undo);
}

// The one-off task carried over to today isn't part of the change.
{
  const done = change(base, (d) => setHabitDone(d, "Floss", TODAY, true));
  assert.deepEqual(Object.keys(done.undo!.app!.before.items), []);
  assert.deepEqual(Object.keys(done.undo!.app!.after.log).length, 1);
}

// Yesterday's record goes with the next save, so a deleted item doesn't linger in the file.
{
  const yesterday = withUndoRecord(base, deleteHabits(base, ["Gym"]), "claude", "2026-10-27");
  assert.ok(yesterday.undo?.claude);
  const today = change(yesterday, (d) => setHabitDone(d, "Floss", TODAY, true));
  assert.deepEqual(Object.keys(today.undo ?? {}), ["app"]);
  const quiet = withUndoRecord(yesterday, { ...yesterday, timeZone: "Europe/Lisbon" }, "app", TODAY);
  assert.equal(quiet.undo, undefined);
}

// Through the engine: a change, then "undo that".
{
  let saved = base;
  let next: AgentToolCall = { name: "setHabitDone", input: { name: "floss", done: true } } as AgentToolCall;
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
  await session.send("mark floss done");
  assert.ok(saved.completionLog.some((e) => e.itemId === "Floss" && e.date === TODAY));
  next = { name: "undoLastChange", input: {} } as AgentToolCall;
  await session.send("undo that");
  assert.equal(last(), 'Undone: I put "Floss" back as it was.');
  assert.equal(saved.completionLog.some((e) => e.itemId === "Floss"), false);
  assert.equal(saved.undo?.app, undefined); // the undo isn't itself recorded
  await session.send("undo");
  assert.equal(last(), "There's nothing to undo.");
}

console.log("undo: all assertions passed");
