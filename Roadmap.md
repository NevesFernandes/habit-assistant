# Roadmap

A living, prioritized backlog for Habit Assistant. This is not a spec — it's a queue of what to build next, ordered top-to-bottom by priority (top = highest).

**How this file is maintained:**
- Referenced by name in conversation ("let's do the next roadmap item," "tackle the categories one") instead of being re-described each session — read this file for the actual requirements before starting work.
- Once a feature is implemented, tested, and committed, remove its entry. The commit history is the permanent record; this file only tracks *unbuilt* work.
- Priorities can change on request — reorder by moving the entry to its new position in the list. No two entries share a *position*; position in the list is the priority rank.
- New items can be inserted anywhere in the order on request, including between two existing entries.
- Each entry also carries a **Now / Next / Later** tag — a visual/query layer on top of the ordering, not a replacement for it. A Later item never outranks a Next item, and a Next item never outranks a Now item: all Now entries stay above all Next entries, which stay above all Later entries. Ordering *within* a tier is still just top-to-bottom position, same as before.
- **Item numbers are permanent IDs, written as `§N` — never `#N`.** `#N` auto-links to GitHub issue/PR number N in commit messages, and this repo already had real collisions (roadmap items reused the same digit as unrelated GitHub issues after renumbering, polluting their timelines — fixed 2026-08-20). An ID is assigned once, when an item is first added, and is **never reused**, even after that item is completed and removed — so position (priority rank) and ID are independent: an item's position can change freely, but its `§N` never does. IDs `§1`–`§3` are already retired to historical, now-removed entries (see commits `ff9eaf1`/`2b5bdac` for §1, `d5254af` for §2, `bc8446c`/`c640cae` for §3) — don't reuse them even though they don't appear below.
- **The commit(s) that close an item are the permanent record once its entry is removed here, so they must carry the ID and a real description** — not just `§N` on its own. Convention (settled by practice, e.g. `Close §26: add Cloudflare Workers AI as a third-tier, last-resort fallback` / `Merge §26: add Cloudflare Workers AI as a third-tier, last-resort fallback`): the commit implementing the item and the commit merging it to `main` are both titled `Close §N: <short description>` / `Merge §N: <short description>`, using the same description both times. Commits that aren't closing a specific numbered item (bug fixes found in passing, doc-only edits, mid-item registration/retagging commits) don't need a `§N` prefix.
- **Next available ID: §78** (§62, "today" as the local date rather than UTC, was used directly for §61 Phase 2 — see `Close §62`) (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

---

## Now

## Next

### §63 — Stats for recurring tasks and one-off tasks
Today only habits have stats (streak, best streak, completion %, counts per week/month/year/all time). Extend the idea to recurring tasks and one-off tasks, in the app (stats tab, item pages) and the Claude connector. What "stats" means for each type is still to be decided (e.g. on-time rate for recurring tasks, done count and how long tasks carried over for one-off tasks).

- Build it in `src/lib` next to `habitStats.ts`, so the app and the connector share it.
- Connector (ready, 2026-10-27): `get_stats` already takes any item, and a `type` for a category or everything; for tasks it answers `not_available` (`NOT_AVAILABLE` in `src/mcp/server.ts`). Once this is built, it returns task stats with no reconnect. Its description already describes the finished feature, since descriptions freeze with the tool list.

### §65 — Stats summaries in Claude (dashboard-style)
Summaries of how the user is doing, like the app's stats tab and its calendar widget, asked for in Claude ("how did my week go?", "show my month").

- Decided 2026-10-27: the app's code computes, Claude draws. The numbers come from `src/lib` (no streaks or percentages worked out by the model); Claude writes the summary, or builds a chart when asked.
- Connector: only `get_stats`' **result** grows (e.g. a day-by-day series for the calendar/heatmap, per-period totals), so no reconnect is needed. Its inputs and description stay as they are; the result itself says what its fields mean.
- Not chosen for now: a link to the app's stats tab (leaves Claude), and an interactive widget inside Claude ("MCP Apps"), which is unconfirmed on claude.ai mobile and would change the tool list (a reconnect for everyone if added after launch).

### §64 — Reset stats
Start the stats over for one item, a category, or everything, for habits, recurring tasks and one-off tasks.

- Decided 2026-10-27: a reset **never erases history**. It only restarts the counting: a "count from" date that streaks, completion % and counts start at, while the completion log and the heatmap keep the past.
- Always asks first with what will be reset, as delete does.
- Connector (ready, 2026-10-27): a `reset_stats` tool (scope item, category or all, optional `type`, `confirm`), marked destructive so it never shares an "always allow", is already in the tool list and answers `not_available` until this is built. Its description already describes the finished feature.

## Later

### §69 — Settings by chat
Change settings by asking: where the week starts (Sunday or Monday), replies read aloud on or off. In the connector, `more_actions` actions (no reconnect). Device-local settings (read-aloud is per device) need a decision on what "by chat" means for them.

### §70 — Undo the last change
"Undo that" right after a change made by chat (app or Claude). Needs care: what counts as the last change when the app and the connector both write the same file, and how far back it goes. Probably not a general history (see the Completion log rule in CLAUDE.md). In the connector, a `more_actions` action.

### §71 — Goals and challenges
A target with a deadline and visible progress: "read 20 books by December", "a 30-day no-sugar challenge". Builds on the stats (§63) and history (§66). In the connector, `more_actions` actions or a bigger `get_stats` result (no reconnect).

### §72 — Export
"Give me my October as a spreadsheet": history for a period as a file. The data is already the user's own JSON in Drive; this is about a readable table. In Claude, Claude can build the file from §66's history; in the app, a download. Depends on §66.

### §74 — Calendar sync
"Put today's tasks in my calendar." In Claude this already works with no code: Claude combines this connector with a calendar connector. An app-side version would need a Google Calendar scope on top of `drive.file`, which widens what the app asks for at sign-in; weigh that before building. `help.html` already mentions the Claude combination ("what's on today, habits and calendar?").

### §75 — Bulk actions in the app's chat
"Mark all my morning habits done", "pause everything in Sports for a week." In Claude this already works (`get_day`/`find_items` give the ids, and `set_done` takes several). The app's chat only applies one change to several items when the user picks them from a "which one?" list ("all"); a filter by part of the day, category or kind would bring it level.

### §76 — Habit packs
"Set me up a morning routine": a ready-made set of items created in one go. In Claude this already works (several `create_item` calls). For the app, either the same through its chat or a small set of templates; to decide.

### §77 — Un-archive from the item's page
Bringing an archived habit or recurring task back. By chat (app or Claude) it's already possible by removing the end date (§55); the item's page has no button for it. Small UI item.

### §73 — What did I miss
"What did I miss this week?": the due items that weren't done over a period, as a list to act on. Mostly a reading of §66's history; in the app it could be a view or a chat answer. Depends on §66.

### §45 — Voice: slide-to-lock recording (trial on a branch)
Today the mic button must be held for the whole message. Slide-to-lock (as in WhatsApp): while holding, slide the finger to a lock icon, then talk hands-free and tap to send (or cancel). Makes longer voice messages comfortable. UI-only; the transcription pipeline is unchanged.

**Trial first:** build it on a branch for hands-on testing; adopting it isn't decided. If it's dropped, record that and remove the entry.

### §44 — Research: reminders / push notifications
The app is deliberately pull-based today (no notifications). Reminders are the most common habit-app feature, but real push needs something the app doesn't have: a scheduled server-side job that knows when each user's items are due and holds their push subscriptions. That cuts against "data in your own Drive, $0 by construction."

**This item is research only, not a build:** find the cheapest honest design (e.g. Cloudflare Worker cron triggers + Web Push, with the minimum of per-user state held server-side), what it would cost and what data would have to leave Drive, and how well PWA push works on Android. Then decide whether to build it. Until then, keep the CLAUDE.md rule: don't build toward notifications, but don't make them hard to add.

### §46 — Voice: on-device Whisper (trial on a branch)
Transcribe in the browser (Whisper via WASM/WebGPU) instead of sending audio to Groq: better privacy, works offline, no STT key needed. Costs to measure: model download size (tens to hundreds of MB, precached by the service worker like `public/ort/`), transcription speed on a mid-range Android phone, battery, and accuracy versus Groq Whisper. The Silero VAD silence guard stays in front of it either way.

**Trial first:** a spike on a branch, measured on the user's real phone; adopting it isn't decided. If it's adopted, it's probably a Settings toggle alongside the Groq path rather than a replacement.

### §60 — Extra priority inside a part of the day
§54 replaced the priority number with six parts of the day; inside a part the order is important items first, then A–Z. The user expects that to be enough for their own lists, but another user's part could get cluttered. Only pick this up if that shows in real use.

- Ideas, not decisions: an exact order the user sets ("put reading before meditation", or drag to reorder), or more than one level of importance.
- Whatever is chosen has to stay sayable in chat and readable without numbers, which is what §54 removed.

New items go in on request, at whichever position and tier they deserve, taking the next free ID above.
