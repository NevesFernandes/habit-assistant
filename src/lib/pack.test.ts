// §76: a set of new items made for the user (src/lib/pack.ts), and the app's chat: the list
// first, nothing added before a yes, "yes, without 2" trims it. Run: npm run test:pack
import assert from "node:assert/strict";
import { applyPack, describePackPreview, planPack, withoutItems, PACK_MAX_ITEMS, type PackItem } from "./pack.ts";
import { ChatSession } from "./chatEngine.ts";
import type { AgentToolCall } from "./agentClient.ts";
import { DEFAULT_CATEGORIES, type AppData } from "../types/models.ts";

const TODAY = "2026-10-27";
const data: AppData = {
  categories: DEFAULT_CATEGORIES,
  habits: [{ kind: "habit", id: "med", name: "Meditate", categoryId: "health", dayPart: "morning", startDate: "2026-10-01", recurrence: { type: "daily" }, completionType: "yesno" }],
  recurringTasks: [],
  singleTasks: [],
  completionLog: [],
};
const daily = { type: "daily" } as const;
const items: PackItem[] = [
  { kind: "habit", name: "Drink a glass of water", categoryId: "nutrition", dayPart: "wakeUp", recurrence: daily },
  { kind: "habit", name: "Stretch", categoryId: "sports", dayPart: "morning", recurrence: daily, completionType: "timer", target: 10 },
  { kind: "habit", name: "meditate", categoryId: "health", dayPart: "morning", recurrence: daily },
  { kind: "habit", name: "Read", categoryId: "study", dayPart: "morning", recurrence: { type: "daysOfWeek", days: [1, 3, 5] }, completionType: "value", unit: "pages" },
  { kind: "recurringTask", name: "Make the bed", categoryId: "home", dayPart: "wakeUp", recurrence: daily },
  { kind: "singleTask", name: "Buy a water bottle", dayPart: "workDay" },
];

// Checked like single creates: Read has no goal amount; Meditate already exists.
const plan = planPack(data, "a morning routine", items, TODAY);
assert.deepEqual(plan.items.map((i) => i.name), ["Drink a glass of water", "Stretch", "Make the bed", "Buy a water bottle"]);
assert.deepEqual(plan.existing, ["meditate"]);
assert.deepEqual(plan.dropped, [{ name: "Read", reason: "no goal amount" }]);
assert.equal(
  describePackPreview(plan, TODAY),
  [
    "Here's a morning routine (4 items):",
    "1. Drink a glass of water: habit, every day, Wake-up",
    "2. Stretch: habit, every day, 10 min, Morning",
    "3. Make the bed: recurring task, every day, Wake-up",
    "4. Buy a water bottle: one-off task, Work day",
    "Already have: meditate (left out).",
    "Couldn't add: Read (no goal amount).",
    'Add these 4? You can also say which to leave out, like "yes, without 2".',
  ].join("\n"),
);

// At most PACK_MAX_ITEMS; duplicates inside the set count once.
const many = planPack(data, "lots", Array.from({ length: 12 }, (_, i) => ({ kind: "habit" as const, name: `H${i}`, dayPart: "evening" as const, recurrence: daily })).concat([{ kind: "habit", name: "h0", dayPart: "evening", recurrence: daily }]), TODAY);
assert.equal(many.items.length, PACK_MAX_ITEMS);
assert.deepEqual(many.dropped.map((d) => d.reason), ["over the 10-item limit", "over the 10-item limit"]);

// Trims by number or name.
assert.deepEqual(withoutItems(plan, ["2", "the bed"]).items.map((i) => i.name), ["Drink a glass of water", "Buy a water bottle"]);
assert.equal(withoutItems(plan, ["9", "piano"]).items.length, 4);

// Added in order; a later start date carries over; habits get Other without a category.
{
  const later = planPack(data, "x", [{ kind: "habit", name: "Walk", dayPart: "evening", recurrence: daily }], TODAY, "2026-11-02");
  const added = applyPack(data, later, TODAY);
  const walk = added.habits.find((h) => h.name === "Walk")!;
  assert.deepEqual([walk.startDate, walk.categoryId, walk.dayPart], ["2026-11-02", "other", "evening"]);
  const all = applyPack(data, plan, TODAY);
  assert.equal(all.habits.length + all.recurringTasks.length + all.singleTasks.length, 1 + 4);
  assert.equal(all.habits.find((h) => h.name === "Stretch")?.target, 10);
}

// Through the engine: the list, then "yes, without 2", or "no".
async function run(answer: { confirmed: boolean; leaveOut?: string[] }) {
  let saved = data;
  const session = new ChatSession({
    getData: () => saved,
    persist: async (mutate) => {
      saved = mutate(saved);
      return true;
    },
    callAgent: async (_messages, _categories, pending) => ({
      toolCall: (pending
        ? { id: "c", name: "confirmPendingAction", input: answer }
        : { id: "p", name: "createPack", input: { packName: "a morning routine", items } }) as AgentToolCall & { id: string },
    }),
    todayISO: () => TODAY,
  });
  const last = () => {
    const message = session.messages.filter((m) => m.role === "assistant").pop();
    return message && "content" in message ? (message.content as string) : "";
  };
  await session.send("set me up a morning routine");
  assert.match(last(), /^Here's a morning routine \(4 items\):/);
  assert.equal(saved, data); // nothing before the yes
  await session.send("yes");
  return { saved, reply: last() };
}
{
  const trimmed = await run({ confirmed: true, leaveOut: ["2"] });
  assert.equal(trimmed.reply, 'Added a morning routine: Drink a glass of water, Make the bed, Buy a water bottle. They start today. Change any of them by asking, like "move Drink a glass of water to the evening".');
  assert.equal(trimmed.saved.habits.some((h) => h.name === "Stretch"), false);
  const declined = await run({ confirmed: false });
  assert.equal(declined.saved, data);
  assert.match(declined.reply, /^Okay, I didn't add them\./);
}

console.log("pack: all assertions passed");
