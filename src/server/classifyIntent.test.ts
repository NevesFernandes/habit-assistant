// Plain assert-based regression check for classifyIntent.ts — this repo has
// no test framework, and this function is a pure string -> result mapping
// with zero async/env dependency, so a no-dependency script (run directly by
// Node's native TS support) is enough. Run: node src/server/classifyIntent.test.ts
import assert from "node:assert/strict";
import { classifyIntent, type IntentBucket } from "./classifyIntent.ts";

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

if (failures > 0) {
  console.error(`\n${failures}/${cases.length} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
