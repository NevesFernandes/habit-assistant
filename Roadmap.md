# Roadmap

A living, prioritized backlog for Habit Assistant. This is not a spec — it's a queue of what to build next, ordered top-to-bottom by priority (top = highest).

**How this file is maintained:**
- Referenced by name in conversation ("let's do the next roadmap item," "tackle the categories one") instead of being re-described each session — read this file for the actual requirements before starting work.
- Once a feature is implemented, tested, and committed, remove its entry. The commit history is the permanent record; this file only tracks *unbuilt* work.
- Priorities can change on request — reorder by moving the entry to its new position in the list. No two entries share a *position*; position in the list is the priority rank.
- New items can be inserted anywhere in the order on request, including between two existing entries.
- Each entry also carries a **Now / Next / Later** tag — a visual/query layer on top of the ordering, not a replacement for it. A Later item never outranks a Next item, and a Next item never outranks a Now item: all Now entries stay above all Next entries, which stay above all Later entries. Ordering *within* a tier is still just top-to-bottom position, same as before.
- **Item numbers are permanent IDs, written as `§N` — never `#N`.** `#N` auto-links to GitHub issue/PR number N in commit messages, and this repo already had real collisions (roadmap items reused the same digit as unrelated GitHub issues after renumbering, polluting their timelines — fixed 2026-08-20). An ID is assigned once, when an item is first added, and is **never reused**, even after that item is completed and removed — so position (priority rank) and ID are independent: an item's position can change freely, but its `§N` never does. IDs `§1`–`§3` are already retired to historical, now-removed entries (see commits `ff9eaf1`/`2b5bdac` for §1, `d5254af` for §2, `bc8446c`/`c640cae` for §3) — don't reuse them even though they don't appear below.
- **Next available ID: §20**
- See also `CLAUDE.md`'s "Open questions / to refine later" section for undecided design questions — those are a different kind of thing from the concrete, actionable items below.

---

## Now

_Nothing queued right now — see Next below for what's up next._

## Next

### §16 — One real, shared, interactive checklist component
CLAUDE.md states checklists should be "the same underlying checklist component used in two different roles" (a Habit's completion type, and a freeform attachment on either Task type) — "don't build two separate implementations." Today there are three independent, static, read-only renderings (`HabitsView.tsx`, `RecurringTasksView.tsx`, `SingleTasksView.tsx`) with no check/uncheck or add-item interaction anywhere. Build one real component (check/uncheck items, add new items to the task-attachment use case) and use it in all three places. A prerequisite for §15's checklist completion type. Also unblocks resolving the open question in CLAUDE.md about a task checklist's reset/carry-over behavior across occurrences, since that only becomes concrete once the component exists.

### §15 — Real tracking for Habit completion type: Checklist
Numeric-value and Timer habits now have real tracking (logged via chat with `logHabitProgress`, target-aware stats — see commit history). Checklist is the one completion type still unbuilt: `Habit.checklist` is a single static list with no per-occurrence completion state anywhere (no file sets `checked: true`, no per-date structure exists). Needs §16's shared checklist component first, then per-occurrence checklist completion (which items were checked off *today* vs. yesterday), plus `habitStats.ts` interpreting partial-vs-full checklist completion — mirroring the target-aware pattern already built for Numeric/Timer (`isHabitEntryComplete` in `src/lib/habitStats.ts`).

### §17 — Chart-based stats dashboard
Streak, best streak, completion %, and this-week/month/year/all-time counts are already computed (`src/lib/habitStats.ts`) and shown inline in `HabitsView`/`CategoriesView` — this item is the visualization/UX layer on top, not the underlying computation (already done). Needs: a dedicated dashboard page/view, and actual chart/graph visuals (no charting library is in `package.json` yet — pick one as part of this work). Smaller in scope than it might sound, since the hard part (stats computation) is already built.

## Later

### §18 — Preserve full completion history on habit un-complete
`toggleHabitCompletion` (`src/lib/dataStore.ts`) deletes the `CompletionLogEntry` when a habit is un-marked, rather than recording the toggle as its own event — so the log reflects current per-occurrence completion state, not a true history of every completion/uncompletion. Low urgency today, but worth a deliberate decision (e.g. append a new entry type instead of deleting, or keep a separate audit trail) before any future stats work leans on "every completion event" being real, since that can't be backfilled after the fact.

### §19 — Live start/stop timer UI for Timer habits
Timer-habit progress is currently logged after the fact via chat (`logHabitProgress`) — a duration in minutes, the same simple mechanism as Numeric-value habits. The user has looked at HabitNow's Timer habits and wants that fuller experience eventually: an actual running stopwatch (start/pause/stop, elapsed time tracked live), not just after-the-fact entry. Deliberately deferred — real added scope beyond this pass (running-timer state, handling the app being backgrounded/closed mid-timer, persisting an in-progress session). The user will write a fuller spec before this is picked up.

