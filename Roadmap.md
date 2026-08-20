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

### 1. Archive habits & recurring tasks
**[Next]**

Add an "archive" action for Habits and Recurring Tasks: sets an end date as-of-today (soft-stops future occurrences) while preserving all existing completion history.

### 2. Habits list view
**[Later]**

A view listing all habits regardless of date, individually clickable into a per-habit detail screen showing its parameters.

### 3. Single Tasks list view
**[Later]**

Same pattern as #2, for Single Tasks.

### 4. Recurring Tasks list view
**[Later]**

Same pattern as #2, for Recurring Tasks.

### 5. Per-habit statistics
**[Later]**

On a habit's detail view: current streak, best streak, completion percentage, and count of completions this week / this month / this year / all-time. Open to additional metrics beyond these.

### 6. Per-category statistics
**[Later]**

Aggregate the stats from #5 across all habits in a category. Open question: does "streak" mean anything at the category level, or should it be dropped for category aggregates?

### 7. Text-to-speech layer for agent responses
**[Later]**

Have the agent's chat responses optionally read aloud (TTS), mirroring the existing voice *input* pipeline described in `CLAUDE.md`.
