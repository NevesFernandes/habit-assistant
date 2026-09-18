// Plain assert-based check for itemSelection.ts (§32) — same no-framework
// pattern as src/server/recurrenceSpec.test.ts. Run: node src/lib/itemSelection.test.ts
import assert from "node:assert/strict";
import { findSameName, selectOne } from "./itemSelection.ts";
import type { Habit, SingleTask } from "../types/models.ts";

const TODAY = "2026-09-18";

const habit = (id: string, name: string, overrides: Partial<Habit> = {}): Habit => ({
  kind: "habit",
  id,
  name,
  categoryId: "health",
  priority: 1,
  startDate: "2026-09-01",
  recurrence: { type: "daily" },
  completionType: "yesno",
  ...overrides,
});

// The user's real scenario: three water habits, only one tracked by number.
const waterHabits = [
  habit("t", "Test: Drink water", { categoryId: "health" }),
  habit("n", "Drink water", { categoryId: "nutrition", completionType: "value", target: 8, unit: "glasses" }),
  habit("s", "Drink water", { categoryId: "sports" }),
];
const isLoggable = (h: Habit) => h.completionType === "value" || h.completionType === "timer";

{
  // "log six glasses of water" — only the Nutrition one can take a number.
  const result = selectOne(waterHabits, { name: "water" }, isLoggable);
  assert.equal(result.kind, "one");
  assert.equal(result.kind === "one" && result.item.id, "n");
}
{
  // Without an action filter, the exact-name preference drops "Test: Drink water" but two remain.
  const result = selectOne(waterHabits, { name: "Drink water" });
  assert.equal(result.kind, "many");
  assert.deepEqual(result.kind === "many" && result.items.map((h) => h.id), ["n", "s"]);
}
{
  // "the one in Nutrition" — the category selector settles it.
  const result = selectOne(waterHabits, { name: "Drink water", categoryId: "nutrition" });
  assert.equal(result.kind === "one" && result.item.id, "n");
}
{
  // A fragment with no exact match keeps every fragment match.
  const result = selectOne(waterHabits, { name: "water" });
  assert.equal(result.kind === "many" && result.items.length, 3);
}
{
  // Name matches, but none can take the action.
  const result = selectOne([waterHabits[0], waterHabits[2]], { name: "water" }, isLoggable);
  assert.equal(result.kind, "ineligible");
  assert.equal(result.kind === "ineligible" && result.items.length, 2);
}
{
  assert.equal(selectOne(waterHabits, { name: "gym" }).kind, "none");
  assert.equal(selectOne(waterHabits, { name: "water", categoryId: "finance" }).kind, "none");
  assert.equal(selectOne(waterHabits, { name: "   " }).kind, "none");
  // case/whitespace-insensitive exact match
  const result = selectOne(waterHabits, { name: "  drink WATER ", categoryId: "sports" });
  assert.equal(result.kind === "one" && result.item.id, "s");
}

// findSameName: exact names only, ignoring archived habits and finished one-off tasks.
{
  const archived = habit("a", "Drink water", { endDate: "2026-09-10" });
  const endsToday = habit("e", "Drink water", { endDate: TODAY });
  const found = findSameName([...waterHabits, archived, endsToday], "drink water", TODAY);
  assert.deepEqual(found.map((h) => h.id), ["n", "s", "e"]);

  const task = (id: string, done: boolean): SingleTask => ({
    kind: "singleTask",
    id,
    name: "Buy milk",
    priority: 0,
    startDate: TODAY,
    done,
    persistency: true,
  });
  assert.deepEqual(findSameName([task("done", true), task("open", false)], "Buy milk", TODAY).map((t) => t.id), ["open"]);
  assert.equal(findSameName([task("done", true)], "Buy milk", TODAY).length, 0);
}

console.log("itemSelection.test.ts: all passed");
