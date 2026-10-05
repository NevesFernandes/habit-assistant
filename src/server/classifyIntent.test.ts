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
  ["log 6 glasses of water today", ["modify"]],
  ["change my water target to 10", ["modify"]],
  ["delete my gym habit", ["delete"]],
  ["archive my gym habit", ["delete", "modify"]],
  ["stop tracking my gym habit", ["delete", "modify"]],
  ["remove my old shopping task", ["delete"]],
  ["check off milk on my shopping list", ["checklist"]],
  ["I did my stretching today", ["modify", "checklist"]],
  ["mark my dentist task as done", ["modify"]],
  ["handle my stuff", "fallback"],
  ["delete my old tasks and add a habit to meditate", ["delete", "create"]],
  ["create a task to call the dentist", ["create"]],
  ["create a recurring task to water the plants every week", ["create"]],
  ["rename my gym habit to workout", ["modify"]],
  ["change the priority of my shopping task to 5", ["modify"]],
  ["delete my recurring shopping task", ["delete"]],
  ["add bread to my grocery list", ["checklist"]],
  ["check off bread on my grocery list", ["checklist"]],
  // Coverage added to shrink the classifyIntent fallback gap (see CLAUDE.md's
  // Cost model section) — new OR'd keywords, following the file's existing
  // paired-condition / bare-verb discipline per bucket.
  ["cancel my dentist task", ["delete"]],
  ["toss my old grocery task", ["delete"]],
  ["scrap my meeting task", ["delete"]],
  ["shift my dentist appointment to next week", ["modify"]],
  ["swap my gym habit's category to health", ["modify"]],
  ["tweak my water goal", ["modify"]],
  ["revise my task description", ["modify"]],
  ["move my task to tomorrow", ["modify"]],
  ["schedule a task to call the dentist", ["create"]],
  ["begin tracking a habit to stretch daily", ["create"]],
  ["I practiced guitar for 30 minutes today", ["modify"]],
  ["studied for 2 hours today", ["modify"]],
  ["tracked 5 miles today", ["modify"]],
  ["I practiced my routine today", ["modify", "checklist"]],
  // §55: removing one field of an item is an edit, not a deletion.
  ["Remove the comments of the task Reply to Family.", ["modify"]],
  ["clear the notes on my gym habit", ["modify"]],
  ["delete the description from the dentist task", ["modify"]],
  ["remove the end date from my reading habit", ["modify"]],
  ["remove the category from the pay rent task", ["modify"]],
  ["get rid of the details of my shopping task", ["modify"]],
  ["drop the priority of the gym habit", ["modify"]],
  ["remove the end date", ["modify"]],
  ["take the category off the water the plants task", ["modify"]],
  ["clear its description.", ["modify"]],
  // The field word only describes which items to delete, so the delete tools must stay.
  ["delete the notes task", ["delete", "modify"]],
  ["remove my Finance category tasks", ["delete", "modify"]],
  ["delete the priority 5 tasks", ["delete", "modify"]],
  // A real deletion alongside the field: both.
  ["remove the notes from my gym habit and delete the dentist task", ["delete", "modify"]],
  // No field word: unchanged.
  ["remove my gym habit", ["delete"]],
  ["clear out my old tasks", ["delete"]],
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
    updateHabit: ["modify"],
    createHabit: ["create"],
    archiveHabit: ["delete", "modify"],
    setHabitDone: ["modify", "checklist"],
    addSingleTaskChecklistItem: ["checklist"],
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
    ["the reported reply", [user("change my brush teeth habits to self-care category"), ...app("updateHabit", "I found 2 habits"), user("Both, 1 and 2")], ["modify"], true],
    ["pick by description", [user("log six glasses of water"), ...app("updateHabit", "I found 2 habits"), user("the one in Nutrition")], ["modify"], true],
    ["correction after a creation", [user("add a habit to read"), ...app("createHabit", "Added habit… Need any changes?"), user("no, only on weekdays")], ["modify"], true],
    ["one more after a creation", [user("add a habit to read"), ...app("createHabit", "Added habit… Need any changes?"), user("add another one for evenings")], ["create", "modify"], true],
    ["archive list", [user("archive read"), ...app("archiveHabit", "I found 2 habits"), user("the study one")], ["modify"], true],
    ["mark-done list", [user("I did read"), ...app("setHabitDone", "I found 2 habits"), user("the second, I think")], ["modify"], true],
    ["checklist list", [user("add milk to my shopping list"), ...app("addSingleTaskChecklistItem", "I found 2 tasks"), user("the Friday one")], ["checklist"], true],
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
