// §32: picking the right existing item — numbered lists, exact names, number picks,
// wrong-type fallback, duplicate-name confirmation, detailed delete confirmation.
import type { Scenario } from "../types.ts";
import { all, check, describeRule, habitById, habitsNamed, isWeekdays, nextWeekday, todayISO } from "./helpers.ts";

export const scenarios: Scenario[] = [
  {
    name: "s32-log-lists-only-number-habits-then-pick-by-category",
    fixture: "baseline",
    turns: [
      {
        user: "log six glasses of water",
        expect: {
          toolCall: "logHabitProgress",
          // Two number-tracked matches; the yes/no "Drink water" (Sports) must not be offered.
          reply: [/I found 2 habits matching/, /Nutrition/, /Test: Drink water/],
          notReply: /Sports/,
        },
      },
      {
        user: "the one in Nutrition",
        expect: {
          toolCall: "logHabitProgress",
          reply: /Logged 6 glasses for "Drink water"/,
          data: (data) => {
            const entry = data.completionLog.find((e) => e.itemId === "water-nutrition" && e.date === todayISO());
            return check(entry?.value === 6, `expected 6 logged on water-nutrition today, got ${entry?.value}`);
          },
        },
      },
    ],
  },
  {
    name: "s32-exact-name-wins-and-weekday-start",
    fixture: "baseline",
    turns: [
      {
        user: "change meditate to start next monday",
        expect: {
          toolCall: "updateHabit",
          reply: /^Updated "Meditate":/,
          data: (data) =>
            all(
              check(
                habitById(data, "meditate")?.startDate === nextWeekday(1),
                `expected Meditate to start ${nextWeekday(1)}, got ${habitById(data, "meditate")?.startDate}`,
              ),
              check(habitById(data, "meditate-test")?.startDate === "2026-09-01", "Test: Meditate should be unchanged"),
            ),
        },
      },
    ],
  },
  {
    name: "s32-identical-names-pick-by-number",
    fixture: "baseline",
    turns: [
      {
        user: "change read to monday, wednesday and friday",
        // The model may guess updateRecurringTask — the app must still find the habits.
        expect: {
          toolCall: ["updateHabit", "updateRecurringTask"],
          reply: [/I found 2 habits matching "read"/i, /reply with its number/],
          notReply: /Technical Reading/,
        },
      },
      {
        user: "2",
        expect: {
          noModelCall: true,
          reply: /Repeats: every day → every Mon, Wed, Fri/,
          data: (data) =>
            all(
              check(
                isWeekdays(habitById(data, "read-2")!.recurrence, [1, 3, 5]),
                `read-2 should be Mon/Wed/Fri, got ${describeRule(habitById(data, "read-2")!.recurrence)}`,
              ),
              check(habitById(data, "read-1")?.recurrence.type === "daily", "read-1 should still be daily"),
            ),
        },
      },
    ],
  },
  {
    name: "s32-duplicate-name-asks-first",
    fixture: "baseline",
    turns: [
      {
        user: "add a habit technical reading",
        expect: {
          toolCall: "createHabit",
          reply: /You already have a habit called "Technical Reading".*Are you sure/s,
          data: (data) => check(habitsNamed(data, "technical reading").length === 1, "nothing should be created yet"),
        },
      },
      {
        user: "no",
        expect: {
          toolCall: "confirmPendingAction",
          reply: /Okay, I didn't create it\./,
          data: (data) => check(habitsNamed(data, "technical reading").length === 1, "declined — still just 1"),
        },
      },
      {
        user: "add a habit technical reading",
        expect: { toolCall: "createHabit", reply: /You already have a habit called/ },
      },
      {
        user: "yes",
        expect: {
          toolCall: "confirmPendingAction",
          reply: /^Added habit "/i,
          data: (data) => check(habitsNamed(data, "technical reading").length === 2, "confirmed — now 2"),
        },
      },
    ],
  },
  {
    name: "s32-delete-lists-details-and-unrelated-reply-cancels",
    fixture: "baseline",
    turns: [
      {
        user: "delete my test habits",
        expect: {
          toolCall: "deleteHabits",
          reply: [/Are you sure you want to delete these 2 habits\?/, /1\. "Test: /, /2\. "Test: /, /completion history/],
        },
      },
      {
        user: "actually, add milk to my shopping list",
        expect: {
          toolCall: "confirmPendingAction",
          reply: /Okay, I won't delete that\./,
          data: (data) =>
            check(
              !!habitById(data, "water-test") && !!habitById(data, "meditate-test"),
              "both Test: habits must still exist",
            ),
        },
      },
    ],
  },
  {
    name: "s32-checklist-add-to-task",
    fixture: "baseline",
    turns: [
      {
        user: "add milk to my shopping list",
        expect: {
          toolCall: ["addRecurringTaskChecklistItem", "addSingleTaskChecklistItem"],
          reply: /Added "milk" to "Weekly shopping"/i,
          data: (data) => {
            const items = data.recurringTasks.find((task) => task.id === "shopping")?.checklist ?? [];
            return check(
              items.some((item) => item.text.toLowerCase() === "milk"),
              `expected milk on the shopping list, got ${items.map((i) => i.text).join(", ")}`,
            );
          },
        },
      },
    ],
  },
];
