// §53: a task only ever stores a category that exists. Plain assert-based check, same
// no-framework pattern as the other *.test.ts files. Run: npm run test:taskCategory
import assert from "node:assert/strict";
import { addRecurringTask, addSingleTask, resolveCategoryId, updateRecurringTask, updateSingleTask } from "./dataStore.ts";
import { DEFAULT_CATEGORIES, type AppData } from "../types/models.ts";

const data: AppData = {
  categories: [...DEFAULT_CATEGORIES, { id: "c-123", name: "Self-care", icon: "x", isDefault: false }],
  habits: [],
  recurringTasks: [],
  singleTasks: [],
  completionLog: [],
};

// A known id passes; a name is matched ignoring case and punctuation; anything else is none.
assert.equal(resolveCategoryId(data, "finance"), "finance");
assert.equal(resolveCategoryId(data, "Finance"), "finance");
assert.equal(resolveCategoryId(data, "c-123"), "c-123");
assert.equal(resolveCategoryId(data, "Self-care"), "c-123");
assert.equal(resolveCategoryId(data, "selfcare"), "c-123");
assert.equal(resolveCategoryId(data, "Quit a bad habit"), DEFAULT_CATEGORIES.find((c) => c.name === "Quit a bad habit")?.id);
assert.equal(resolveCategoryId(data, "garden"), undefined);
assert.equal(resolveCategoryId(data, ""), undefined);
assert.equal(resolveCategoryId(data, "--"), undefined);
assert.equal(resolveCategoryId(data, undefined), undefined);

// Creation.
const single = (categoryId?: string) => addSingleTask(data, { name: "Pay rent", categoryId }).singleTasks[0];
assert.equal(single("finance").categoryId, "finance");
assert.equal(single("Finance").categoryId, "finance");
assert.equal(single("selfcare").categoryId, "c-123");
assert.equal(single("garden").categoryId, undefined);
assert.equal(single().categoryId, undefined);

const recurring = (categoryId?: string) =>
  addRecurringTask(data, { name: "Bins", categoryId, recurrence: { type: "daily" } }).recurringTasks[0];
assert.equal(recurring("Home").categoryId, "home");
assert.equal(recurring("garden").categoryId, undefined);

// Updates: a real category replaces, "" clears, an unknown one leaves it as it was.
{
  const withTask = addSingleTask(data, { name: "Pay rent", categoryId: "finance" });
  const id = withTask.singleTasks[0].id;
  const after = (newCategoryId: string) => updateSingleTask(withTask, id, { newCategoryId }).singleTasks[0].categoryId;
  assert.equal(after("Home"), "home");
  assert.equal(after(""), undefined);
  assert.equal(after("garden"), "finance");
}
{
  const withTask = addRecurringTask(data, { name: "Bins", categoryId: "home", recurrence: { type: "daily" } });
  const id = withTask.recurringTasks[0].id;
  const after = (newCategoryId: string) => updateRecurringTask(withTask, id, { newCategoryId }).recurringTasks[0].categoryId;
  assert.equal(after("selfcare"), "c-123");
  assert.equal(after(""), undefined);
  assert.equal(after("garden"), "home");
}

console.log("taskCategory.test.ts: all passed");
