// Plain assert-based regression check for classifyIntent.ts — this repo has
// no test framework, and this function is a pure string -> result mapping
// with zero async/env dependency, so a no-dependency script (run directly by
// Node's native TS support) is enough. Run: node src/server/classifyIntent.test.ts
import assert from "node:assert/strict";
import { classifyIntent, classifyTurn, type IntentBucket } from "./classifyIntent.ts";

type Case = [text: string, expected: IntentBucket[] | "fallback"];

const cases: Case[] = [
  ["add milk to my shopping list", ["checklist"]],
  ["add a habit to read every night", ["create"]],
  ["log 6 glasses of water today", ["progress"]],
  ["change my water target to 10", ["edit"]],
  ["delete my gym habit", ["delete"]],
  ["archive my gym habit", ["schedule"]],
  ["stop tracking my gym habit", ["schedule"]],
  ["remove my old shopping task", ["delete"]],
  ["check off milk on my shopping list", ["checklist"]],
  ["I did my stretching today", ["progress", "checklist"]],
  ["mark my dentist task as done", ["progress"]],
  ["handle my stuff", "fallback"],
  ["delete my old tasks and add a habit to meditate", ["delete", "create"]],
  ["create a task to call the dentist", ["create"]],
  ["create a recurring task to water the plants every week", ["create"]],
  ["rename my gym habit to workout", ["edit"]],
  ["change the priority of my shopping task to 5", ["edit", "progress"]], // a change verb with a number may be a log: both,
  ["delete my recurring shopping task", ["delete"]],
  ["add bread to my grocery list", ["checklist"]],
  ["check off bread on my grocery list", ["checklist"]],
  // Coverage added to shrink the classifyIntent fallback gap (see CLAUDE.md's
  // Cost model section) — new OR'd keywords, following the file's existing
  // paired-condition / bare-verb discipline per bucket.
  ["cancel my dentist task", ["delete"]],
  ["toss my old grocery task", ["delete"]],
  ["scrap my meeting task", ["delete"]],
  ["shift my dentist appointment to next week", ["edit"]],
  ["swap my gym habit's category to health", ["edit"]],
  ["tweak my water goal", ["edit"]],
  ["revise my task description", ["edit"]],
  ["move my task to tomorrow", ["edit"]],
  ["schedule a task to call the dentist", ["create"]],
  ["begin tracking a habit to stretch daily", ["create"]],
  ["I practiced guitar for 30 minutes today", ["progress"]],
  ["studied for 2 hours today", ["progress"]],
  ["tracked 5 miles today", ["progress"]],
  ["I practiced my routine today", ["progress", "checklist"]],
  // §55: removing one field of an item is an edit, not a deletion.
  ["Remove the comments of the task Reply to Family.", ["edit"]],
  ["clear the notes on my gym habit", ["edit"]],
  ["delete the description from the dentist task", ["edit"]],
  ["remove the end date from my reading habit", ["edit"]],
  ["remove the category from the pay rent task", ["edit"]],
  ["get rid of the details of my shopping task", ["edit"]],
  ["drop the priority of the gym habit", ["edit"]],
  ["remove the end date", ["edit"]],
  ["take the category off the water the plants task", ["edit"]],
  ["clear its description.", ["edit"]],
  // The field word only describes which items to delete, so the delete tools must stay.
  ["delete the notes task", ["delete", "edit"]],
  ["remove my Finance category tasks", ["delete", "edit"]],
  ["delete the priority 5 tasks", ["delete", "edit"]],
  // A real deletion alongside the field: both.
  ["remove the notes from my gym habit and delete the dentist task", ["delete", "edit"]],
  // No field word: unchanged.
  ["remove my gym habit", ["delete"]],
  ["clear out my old tasks", ["delete"]],
  // §56: taking something off a checklist goes to the checklist tools, without the delete tools.
  ["remove milk from my shopping list", ["checklist"]],
  ["delete eggs and bread from the grocery list", ["checklist"]],
  ["take milk off my shopping list", ["checklist"]],
  ["remove the checklist from the go shopping task", ["checklist"]],
  ["get rid of the checklist on my cleaning routine", ["checklist"]],
  // "list" may mean the user's tasks as a whole, or the list may be a task's name: both families.
  ["remove the dentist task from my to-do list", ["delete", "checklist"]],
  ["delete my shopping list", ["delete", "checklist"]],
  ["clear my shopping list", ["checklist"]],
  // A real deletion alongside it: the delete tools stay.
  ["delete my gym habit and remove milk from my shopping list", ["delete", "checklist"]],
  // §54: placing an item in the day, or flagging it, is an edit.
  ["put reading in the evening", ["edit"]],
  ["move meditation to bedtime", ["edit"]],
  ["gym is a top priority", ["edit"]],
  ["make my reading habit important", ["create", "edit"]], // "make … habit" also reads as creating: both
  ["brush teeth isn't that important any more", ["edit"]],
  // While creating, importance is just a field of the new item.
  ["add an important task to call the bank", ["create"]],
  ["add a habit to stretch every morning", ["create"]],
  // §58/§59: pause, resume and archive are their own family and no longer bring the delete tools.
  ["pause my drink water habit", ["schedule"]],
  ["resume gym", ["schedule"]],
  ["put my Spanish practice on hold for two weeks", ["schedule"]],
  ["delete my old tasks and pause gym", ["delete", "schedule"]],
  // An amount with a change verb may be a log; naming the goal makes it an edit only.
  ["increase my water by 2 glasses", ["edit", "progress"]],
  ["increase my water goal to 10 glasses", ["edit"]],
  ["mark gym done", ["progress"]],
  // §42's checklist mode is a field of the recurring task, so the edit tools come along.
  ["make the cleaning checklist reset every time", ["checklist", "edit"]],
  ["let unticked items on my shopping list carry over", ["edit"]],
  // §55 still wins for a field: an edit, with no checklist tools.
  ["remove the notes from my shopping list", ["edit"]],
  // §66: questions about a period, never a report of progress.
  ["how did my week go?", ["history"]],
  ["when did I last go to the dentist?", ["history"]],
  ["how many times did I run in October?", ["history"]],
  ["what did I miss yesterday?", ["history"]],
  ["did I floss last week?", ["history"]],
  ["what's on next week?", ["history"]],
  ["I did my stretching yesterday", ["progress", "checklist"]],
  // §67: a note naming a day is a day note; "notes" with no day is still the description.
  ["remove the note from yesterday's run", ["progress"]],
  ["add a note to today's run: legs tired", ["progress"]],
  ["note for tomorrow's gym: bring a towel", ["progress"]],
  ["remove the notes from the dentist task", ["edit"]],
  // §63
  ["what's my gym streak?", ["history"]],
  ["how am I doing this month?", ["history"]],
  ["how many tasks did I finish this month?", ["history"]],
  ["show my stats", ["history"]],
  // §64
  ["reset my gym stats", ["history"]],
  ["start my streaks over", ["history"]],
  ["undo the reset", ["history"]],
  // §68
  ["skip gym today", ["schedule"]],
  ["unskip my run", ["schedule"]],
  // §77
  ["unarchive gym", ["schedule"]],
  ["bring my reading habit back", ["schedule"]],
  ["restore the bins task", ["schedule"]],
  // §72
  ["export my October", ["history"]],
  ["give me last month as a spreadsheet", ["history"]],
  // §75
  ["mark all my morning habits done", ["progress"]],
  ["pause everything in Sports for a week", ["schedule"]],
  // §73
  ["what did I miss?", ["history"]],
  ["what slipped this month", ["history"]],
  // §69
  ["start my week on Monday", ["settings"]],
  ["make weeks begin on sunday", ["settings"]],
  ["read your replies aloud", ["settings"]],
  ["stop reading out loud", ["settings"]],
  ["what are my settings?", ["settings"]],
];

let failures = 0;
for (const [text, expected] of cases) {
  const result = classifyIntent(text);
  const actual = result.kind === "fallback" ? "fallback" : [...result.buckets].sort();
  const expectedSorted = expected === "fallback" ? "fallback" : [...expected].sort();
  try {
    assert.deepEqual(actual, expectedSorted);
    console.log(`ok   ${text}`);
  } catch {
    failures++;
    console.error(`FAIL ${text}\n  expected: ${JSON.stringify(expectedSorted)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// §51 classifyTurn: a short reply takes its tools from what it answers.
{
  const TOOL_BUCKETS: Record<string, IntentBucket[]> = {
    updateHabit: ["edit"],
    createHabit: ["create"],
    archiveHabit: ["schedule", "delete"],
    setHabitDone: ["progress", "checklist"],
    addSingleTaskChecklistItem: ["checklist"],
    removeChecklistItems: ["checklist", "delete"],
    deleteHabits: ["delete"],
  };
  const user = (content: string) => ({ role: "user" as const, content });
  const model = (content: string) => ({ role: "assistant" as const, content });
  const app = (toolName: string, content: string) => [
    { role: "assistant" as const, content, toolCall: { name: toolName } },
    { role: "tool" as const },
  ];
  type TurnCase = [label: string, messages: Parameters<typeof classifyTurn>[0], expected: IntentBucket[] | "fallback", fromReply: boolean];
  const turnCases: TurnCase[] = [
    ["own buckets win", [user("add a habit to read"), ...app("createHabit", "Added"), user("delete my gym habit")], ["delete"], false],
    ["the reported reply", [user("change my brush teeth habits to self-care category"), ...app("updateHabit", "I found 2 habits"), user("Both, 1 and 2")], ["edit"], true],
    ["pick by description", [user("log six glasses of water"), ...app("updateHabit", "I found 2 habits"), user("the one in Nutrition")], ["edit"], true],
    ["correction after a creation", [user("add a habit to read"), ...app("createHabit", "Added habit… Need any changes?"), user("no, only on weekdays")], ["edit"], true],
    ["one more after a creation", [user("add a habit to read"), ...app("createHabit", "Added habit… Need any changes?"), user("add another one for evenings")], ["create", "edit"], true],
    ["archive list", [user("archive read"), ...app("archiveHabit", "I found 2 habits"), user("the study one")], ["schedule"], true],
    ["mark-done list", [user("I did read"), ...app("setHabitDone", "I found 2 habits"), user("the second, I think")], ["progress"], true],
    ["checklist list", [user("add milk to my shopping list"), ...app("addSingleTaskChecklistItem", "I found 2 tasks"), user("the Friday one")], ["checklist"], true],
    ["which checklist item", [user("remove milk from my shopping list"), ...app("removeChecklistItems", "More than one item matches"), user("the oat one")], ["checklist"], true],
    ["answer to the model's question", [user("add a habit to drink water"), model("How many glasses a day?"), user("eight glasses")], ["create"], true],
    ["model's question after a vague request", [user("handle my stuff"), model("What would you like to do?"), user("the usual")], "fallback", false],
    ["first message", [user("the usual")], "fallback", false],
    ["long unclassified message stays full", [user("add a habit to read"), ...app("createHabit", "Added"), user("so what I was thinking is that maybe we could look at the whole thing again")], "fallback", false],
    ["unknown tool", [user("yes"), ...app("confirmPendingAction", "Okay"), user("the other one")], "fallback", false],
  ];
  for (const [label, messages, expected, fromReply] of turnCases) {
    const result = classifyTurn(messages, (name) => TOOL_BUCKETS[name]);
    const actual = result.kind === "fallback" ? "fallback" : [...result.buckets].sort();
    try {
      assert.deepEqual(actual, expected === "fallback" ? "fallback" : [...expected].sort());
      assert.equal(result.fromReply === true, fromReply);
      console.log(`ok   turn: ${label}`);
    } catch {
      failures++;
      console.error(`FAIL turn: ${label}\n  expected: ${JSON.stringify(expected)} fromReply=${fromReply}\n  actual:   ${JSON.stringify(actual)} fromReply=${result.fromReply === true}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll cases passed.`);
