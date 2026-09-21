// Plain assert-based check for itemSelection.ts (§32) — same no-framework
// pattern as src/server/recurrenceSpec.test.ts. Run: node src/lib/itemSelection.test.ts
import assert from "node:assert/strict";
import { findSameName, parsePick, selectOne } from "./itemSelection.ts";
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

// §34: generic words the user hangs off a name ("my shopping list", "the dentist task").
{
  const shopping = habit("shop", "Weekly shopping");
  const shoppingList = habit("shop-list", "Shopping list");
  const items = [shopping, ...waterHabits];

  const picked = (result: ReturnType<typeof selectOne<Habit>>) => (result.kind === "one" ? result.item.id : result.kind);

  // The whole fragment matches nothing -> retry without the generic words.
  assert.equal(picked(selectOne(items, { name: "my shopping list" })), "shop");
  assert.equal(picked(selectOne(items, { name: "the shopping list" })), "shop");
  assert.equal(picked(selectOne(items, { name: "the water habit" }, isLoggable)), "n");

  // A literal match wins: an item really called "Shopping list" isn't passed over.
  assert.equal(picked(selectOne([shopping, shoppingList], { name: "shopping list" })), "shop-list");

  // Guardrails: all-generic fragments and still-unmatched ones stay "none".
  assert.equal(selectOne(items, { name: "my list" }).kind, "none");
  assert.equal(selectOne(items, { name: "the" }).kind, "none");
  assert.equal(selectOne(items, { name: "my gym habit" }).kind, "none");

  // The fallback keeps the category filter and the action filter.
  assert.equal(selectOne(waterHabits, { name: "the water habit", categoryId: "finance" }).kind, "none");
  assert.equal(selectOne([waterHabits[0], waterHabits[2]], { name: "my water habit" }, isLoggable).kind, "ineligible");

  // Ambiguity still asks rather than guessing.
  assert.equal(selectOne(waterHabits, { name: "my water habit" }).kind, "many");
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

// parsePick: a bare pick from the numbered list, or null (-> goes to the model).
{
  const picks: [string, number][] = [
    ["2", 2], [" 1 ", 1], ["#2", 2], ["number 2", 2], ["no. 3", 3], ["option 1", 1], ["2.", 2],
    ["the first one", 1], ["second", 2], ["the 2nd one", 2], ["Third please", 3], ["last", 3], ["the last one", 3],
    ["7", 7], // out of range is still returned — the caller rejects it
  ];
  for (const [text, expected] of picks) assert.equal(parsePick(text, 3), expected, text);
  for (const text of ["yes", "the Nutrition one", "read", "change it to 2 glasses", "one", "", "2 and 3"]) {
    assert.equal(parsePick(text, 3), null, text);
  }
}

console.log("itemSelection.test.ts: all passed");
