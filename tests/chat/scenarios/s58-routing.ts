// §58/§59: the edit tools are three families now (edit, progress, schedule), so no single
// request comes near Groq's free-tier limit. A pause no longer brings the delete tools; a
// one-off task is marked done without the edit tools; a request the classifier sent to the
// wrong family gets out through the escape tool; and a message the classifier can't place
// still works (on Groq through the two-step route). Run these on Groq too:
//   npm run test:chat -- s58 --provider groq --delay 65000
import type { Scenario } from "../types.ts";
import { all, check, habitById, todayISO } from "./helpers.ts";

const TODAY = todayISO();

export const scenarios: Scenario[] = [
  {
    // §59, word for word: refused on Groq as too large before.
    name: "s58-pause-is-schedule",
    fixture: "baseline",
    turns: [
      {
        user: "pause my push-ups habit",
        expect: {
          toolCall: "pauseHabit",
          bucket: /^schedule/,
          data: (data) => check((habitById(data, "pushups")?.pauses ?? []).length === 1, "Push-ups isn't paused"),
        },
      },
    ],
  },
  {
    name: "s58-archive-is-schedule",
    fixture: "baseline",
    turns: [
      {
        user: "archive the journal habit",
        expect: {
          toolCall: "archiveHabit",
          bucket: /^schedule/,
          data: (data) =>
            all(check(habitById(data, "journal")?.endDate === TODAY, "Journal isn't archived"), check(data.habits.length === 11, "a habit was deleted")),
        },
      },
    ],
  },
  {
    // The progress family has no update tools: the app finds the one-off task itself.
    name: "s58-mark-task-done-without-edit-tools",
    fixture: "baseline",
    turns: [
      {
        user: "mark my dentist task as done",
        expect: {
          bucket: /^progress/,
          data: (data) => check(data.singleTasks.find((task) => task.id === "dentist")?.done === true, "the dentist task isn't done"),
        },
      },
    ],
  },
  {
    name: "s58-log-amount-is-progress",
    fixture: "baseline",
    turns: [
      {
        user: "I did 30 push-ups today",
        expect: {
          toolCall: "logHabitProgress",
          bucket: /^progress/,
          data: (data) => check(data.completionLog.some((entry) => entry.itemId === "pushups" && entry.value === 30), "30 push-ups weren't logged"),
        },
      },
    ],
  },
  {
    // "finished" reads as a completion report (progress + checklist), but the request is to
    // end the habit: the model has to ask for the right tools instead of marking it done.
    name: "s58-escape-from-wrong-family",
    fixture: "baseline",
    turns: [
      {
        user: "I've finished with the journal habit, set its end date to today",
        expect: {
          toolCall: ["archiveHabit", "updateHabit"],
          bucket: /asked:/,
          data: (data) =>
            all(
              check(habitById(data, "journal")?.endDate === TODAY, `Journal's end date is ${habitById(data, "journal")?.endDate}`),
              check(!data.completionLog.some((entry) => entry.itemId === "journal"), "Journal was marked done instead"),
            ),
        },
      },
    ],
  },
  {
    // No action word the classifier knows: every tool on Gemini, the two-step route on Groq.
    name: "s58-unclassified-message",
    fixture: "baseline",
    turns: [
      {
        user: "the journal habit should be called Diary from now on",
        expect: {
          toolCall: "updateHabit",
          bucket: /^fallback:full/,
          data: (data) => check(habitById(data, "journal")?.name === "Diary", `the habit is called ${habitById(data, "journal")?.name}`),
        },
      },
    ],
  },
];
