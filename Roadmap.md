# Roadmap

A living, prioritized backlog for Habit Assistant. This is not a spec — it's a queue of what to build next, ordered top-to-bottom by priority (top = highest).

**How this file is maintained:**
- Referenced by name in conversation ("let's do the next roadmap item," "tackle the categories one") instead of being re-described each session — read this file for the actual requirements before starting work.
- Once a feature is implemented, tested, and committed, remove its entry. The commit history is the permanent record; this file only tracks *unbuilt* work.
- Priorities can change on request — reorder by moving the entry to its new position in the list. No two entries share a *position*; position in the list is the priority rank.
- New items can be inserted anywhere in the order on request, including between two existing entries.
- Each entry also carries a **Now / Next / Later** tag — a visual/query layer on top of the ordering, not a replacement for it. A Later item never outranks a Next item, and a Next item never outranks a Now item: all Now entries stay above all Next entries, which stay above all Later entries. Ordering *within* a tier is still just top-to-bottom position, same as before.
- **Item numbers are permanent IDs, written as `§N` — never `#N`.** `#N` auto-links to GitHub issue/PR number N in commit messages, and this repo already had real collisions (roadmap items reused the same digit as unrelated GitHub issues after renumbering, polluting their timelines — fixed 2026-08-20). An ID is assigned once, when an item is first added, and is **never reused**, even after that item is completed and removed — so position (priority rank) and ID are independent: an item's position can change freely, but its `§N` never does. IDs `§1`–`§3` are already retired to historical, now-removed entries (see commits `ff9eaf1`/`2b5bdac` for §1, `d5254af` for §2, `bc8446c`/`c640cae` for §3) — don't reuse them even though they don't appear below.
- **Next available ID: §13**
- See also `CLAUDE.md`'s "Open questions / to refine later" section for undecided design questions — those are a different kind of thing from the concrete, actionable items below.

---

### §5. Habits list view
**[Next]**

A view listing all habits regardless of date, individually clickable into a per-habit detail screen showing its parameters.

### §6. Single Tasks list view
**[Next]**

Same pattern as §5, for Single Tasks.

### §7. Recurring Tasks list view
**[Next]**

Same pattern as §5, for Recurring Tasks.

### §8. Per-habit statistics
**[Later]**

On a habit's detail view: current streak, best streak, completion percentage, and count of completions this week / this month / this year / all-time. Open to additional metrics beyond these.

### §9. Per-category statistics
**[Later]**

Aggregate the stats from §8 across all habits in a category. Open question: does "streak" mean anything at the category level, or should it be dropped for category aggregates?

### §10. Text-to-speech layer for agent responses
**[Later]**

Have the agent's chat responses optionally read aloud (TTS), mirroring the existing voice *input* pipeline described in `CLAUDE.md`.

### §11. Code-split the onnxruntime-web voice-input bundle
**[Later]**

`src/lib/voiceActivityDetection.ts` statically imports `@ricky0123/vad-web` (which pulls in `onnxruntime-web`'s JS wrapper), and it's imported by `VoiceButton.tsx`, which is unconditionally rendered in `Chat.tsx` — the app's default tab. There are zero dynamic `import()` calls anywhere in the codebase, so nothing is code-split: onnxruntime-web's JS wrapper (not the ~13MB WASM binary already accounted for in `CLAUDE.md`'s "Voice input" section — this is separate, the JS glue code itself) makes up roughly 45% of the app's single ~662KB minified JS bundle (~120KB of the ~190KB gzipped payload), and it's downloaded/parsed on every page load whether or not the user ever presses the mic button. Confirmed via a one-off `rollup-plugin-visualizer` bundle analysis (not committed).

Fix: change the static import in `voiceActivityDetection.ts` to a dynamic `import("@ricky0123/vad-web")` inside `hasSpeech()`, so it's split into its own chunk fetched only on first recording. Low-risk, narrow change; no correctness bug, purely a cold-start/time-to-interactive cost — worth prioritizing given the app's primary non-desktop target is installed PWAs on mobile.
