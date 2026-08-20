# Roadmap

A living, prioritized backlog for Habit Assistant. This is not a spec — it's a queue of what to build next, ordered top-to-bottom by priority (top = highest).

**How this file is maintained:**
- Referenced by name in conversation ("let's do the next roadmap item," "tackle the categories one") instead of being re-described each session — read this file for the actual requirements before starting work.
- Once a feature is implemented, tested, and committed, remove its entry. The commit history is the permanent record; this file only tracks *unbuilt* work.
- Priorities can change on request — reorder by moving the entry to its new position in the list. No two entries share a rank; position in the list *is* the rank.
- New items can be inserted anywhere in the order on request, including between two existing entries.
- Each entry also carries a **Now / Next / Later** tag — a visual/query layer on top of the ordering, not a replacement for it. A Later item never outranks a Next item, and a Next item never outranks a Now item: all Now entries stay above all Next entries, which stay above all Later entries. Ordering *within* a tier is still just top-to-bottom position, same as before.
- See also `CLAUDE.md`'s "Open questions / to refine later" section for undecided design questions — those are a different kind of thing from the concrete, actionable items below.

---

### 1. Single Task: date + persistency
**[Now]**

Every Single Task needs a date; if the user doesn't specify one when creating it, default to today. Add a `persistency` boolean parameter: if `true`, an incomplete task carries over to the next day; if `false`, an incomplete task "dies" (stays permanently uncompleted) at the end of the day it was created.

Open question to resolve during implementation: default value of `persistency` when the user doesn't specify one.

### 2. Remove the standalone Tasks view
**[Now]**

Depends on #1. Once tasks have proper dates, Single Tasks and Habits can share the same date-grouped view (sorted by priority) instead of Tasks needing their own screen. Remove the dedicated Tasks view as redundant.

### 3. Categories view (icons + CRUD)
**[Next]**

Add a view listing all categories. Give each category an icon — evaluate free icon libraries. Seed the default category set + icons from `Notes/Categories.jpg` (HabitNow-style reference: Quit a bad habit, Study, Sports, Social, Finance, Health, Work, Nutrition, Home, Outdoor, Other). Let users add, edit, and delete categories — but block delete if it would orphan any habit or task (past or current) still assigned to that category.

### 4. Archive habits & recurring tasks
**[Next]**

Add an "archive" action for Habits and Recurring Tasks: sets an end date as-of-today (soft-stops future occurrences) while preserving all existing completion history.

### 5. Habits list view
**[Later]**

A view listing all habits regardless of date, individually clickable into a per-habit detail screen showing its parameters.

### 6. Single Tasks list view
**[Later]**

Same pattern as #5, for Single Tasks.

### 7. Recurring Tasks list view
**[Later]**

Same pattern as #5, for Recurring Tasks.

### 8. Per-habit statistics
**[Later]**

On a habit's detail view: current streak, best streak, completion percentage, and count of completions this week / this month / this year / all-time. Open to additional metrics beyond these.

### 9. Per-category statistics
**[Later]**

Aggregate the stats from #8 across all habits in a category. Open question: does "streak" mean anything at the category level, or should it be dropped for category aggregates?

### 10. Text-to-speech layer for agent responses
**[Later]**

Have the agent's chat responses optionally read aloud (TTS), mirroring the existing voice *input* pipeline described in `CLAUDE.md`.
