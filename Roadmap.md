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
- **Next available ID: §74** (§62, "today" as the local date rather than UTC, was used directly for §61 Phase 2 — see `Close §62`) (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

---

## Now

### §61 — Claude connector: use Habit Assistant from Claude (MCP)
A remote MCP server, added in Claude as a custom connector, so users can manage habits by chatting with Claude (including on claude.ai mobile), on the same Drive file as the app. Full spec: the "Habit Assistant MCP Agent: Spec" doc. Decisions: a separate stateless Worker at `mcp.habitassistant.app`, a second Google OAuth client in the same project with `drive.file`, tools that call `src/lib` and add no editing logic of their own, multi-user, $0.

- **Phase 1 (done, verified live 2026-10-27):** OAuth, read-only Drive access and `get_day`. The second OAuth client sees the app's file; `get_day` matched the Today tab on claude.ai mobile; 1.0 to 1.2 s wall time per call (4 calls, worst 1,240 ms), so no Durable Objects. Found: "what's on today?" alone made Claude reach for the calendar; asking about habits works. Sharpen the tool descriptions in Phase 3.
- **Phase 2 (done, verified live 2026-10-27):** §62 made "today" the device's local date and stores `AppData.timeZone`; `get_day` defaults to today in it; the app re-reads the file when it comes back to the foreground if it changed; a test runs app-side writes over one file and checks the time zone, BYOK settings and unknown fields all survive. Verified: after one app sign-in, "what's on my habits today?" answered with no time zone question, including a habit just ticked in the app.
- **Phase 3 (done, verified live 2026-10-27):** write tools: `create_item`, `update_item`, `set_done`, `log_progress`, `find_items`, with conflict replay. `dataStore`'s implicit `today()` is the device's date, which is UTC in the Worker: every connector write must pass its dates explicitly (start dates, `newChecklistItemsFrom`, checklist-mode changes).
    - Step 1 (built, not yet tried live): Drive writes with conflict replay (`persist.ts`), `find_items`, `set_done` (§29/§41 rules, `needs_confirm` for an early one-off task, `ambiguous` with candidates), `log_progress`; `dataStore`'s add/update functions take an explicit `todayISO`.
    - Step 2 (built, not yet tried live): `create_item` and `update_item`, with the engine's rules (goal for number/timer habits, a step for checklist habits, a yes before reusing a name, §56 steps never from a future day) and the app's confirmation text, "Assumed:" line included. `updateKindsFor` moved from `chatEngine.ts` to `dataStore.ts` so both share it.
    - Step 3 (built, not yet tried live): travel and descriptions. `set_time_zone` saves the zone when the user says where they are; the app stores the device's zone on every return to the foreground, not just at sign-in; `get_day` and the server instructions name plain day questions and say calendar events aren't there.
    - Gate, automated (done): 50 of the `tests/chat` scenarios (§29, §31, §32, §34, §35, §41, §50, §53, §54, §55, §57) replayed as tool calls in `src/mcp/scenarios.test.ts`, with the same fixtures and data checks, and the same reply patterns where the reply is the app's own text. One deliberate difference: §57's "no Assumed: line" becomes "the date isn't assumed", since the connector always stores a part of the day and flags it when the message names no time. Ambiguity candidates now carry the category, as the app's "which one?" list does.
    - Gate, manual (done 2026-10-27): on claude.ai mobile, inside a "Habits" Project, "what's on today?", mark done, log an amount, create a habit and move it to another part of the day all worked, and the app showed every change. Found: claude.ai keeps the tool list it fetched at connect time, so new tools only appear after disconnecting and reconnecting the connector. Even with the sharper descriptions live, a bare "what's on today?" still goes to the calendar: the phrase is genuinely ambiguous (for many users the calendar is the right answer), so no description change is planned for it.
    - Time zone while travelling: today the stored zone only updates when the app signs in, so the connector can be up to a day off until then (UTC+2 to Tokyo: wrong between 00:00 and 07:00 local). Two fixes: when the user says where they are, the connector saves the zone (not just for that chat); and the app also updates the stored zone when it comes back to the foreground, not only at sign-in.
- **Phase 4 (done, verified live 2026-10-27):** `checklist` (add, tick, untick, remove, remove_all), `schedule` (pause, resume, archive), `delete_items` (destructive; asks first with details, as the app does), `get_stats` (habit, category, overall, as the stats tab), and `more_actions`.
    - Decided 2026-10-27: claude.ai caches the tool list until the user reconnects, and there's no "Refresh tools" on mobile, so the tool list is frozen from launch. Everyday actions keep dedicated tools; anything added later is an action of `more_actions`, which Claude lists at run time (starting with `list_categories` and `add_category`). Deletes stay a dedicated tool so they never share `more_actions`' "always allow".
    - App side: the chat engine's checklist-item matcher, its "has a checklist" rule and its delete question moved to `itemSelection.ts` and `confirmations.ts`, shared with the connector.
    - Gate, automated (done): 24 more chat scenarios replayed as tool calls (§28, §32 delete and shopping list, §34, §39, §42, §56, multiple add), 74 in all. Not ported: §43, which deletes by a date range the connector leaves to Claude (`find_items` gives each item's start date). Found: "weekly cleaning checklist" matched nothing, in the app too, because "checklist" wasn't one of `itemSelection.ts`'s generic words; it is now (with "checklists").
    - Gate, manual (done 2026-10-27): after one last reconnect, all twelve tools showed on claude.ai mobile and the checklist, pause/resume, stats, `more_actions` (add a category) and delete (asked first) checks worked, with every change showing in the app. A reconnect done right after a push picked up nothing: the deploy has to have finished first.
- **Phase 5:** `privacy.html` (data now passes through this Worker, which keeps Google refresh tokens) and `help.html`, user onboarding. Don't share the connector URL before this. §66, §67 and §68 touch the connector's tool list, which freezes at launch, so their inputs went in first (decided 2026-10-27: inputs only, built later with no reconnect).
    - `help.html` explains two ways to point Claude at Habit Assistant, decided 2026-10-27 (no profile-wide preference, which would collide with people who use their calendar for work): (1) recommended, a "Habits" Project in claude.ai with copy-paste project instructions, so a plain "what's on today?" works inside it and nowhere else; (2) for users who don't want a Project, name it in the message ("what's on my habits today?", "what's left in Habit Assistant?").
    - Onboarding must also say: after an update that adds tools, disconnect and reconnect the connector to see them (claude.ai caches the tool list).

### §66 — History over a date range
Read what happened over a period, not just one day: "how did my week go?", "when did I last go to the dentist?", "how many times did I run in October?", "what did I miss this week?", "plan my week". Today the connector's `get_day` reads one day per call, so a week costs seven calls and a month is impractical.

- Built in `src/lib` (one function the app and the connector share), on `occursOn` and the completion log, so "due", "done" and "missed" mean the same as everywhere else.
- Connector (inputs ready, 2026-10-27): `get_history` (`from`, `to`, optional item or `type`) is in the tool list and answers `not_available` until this is built. It also feeds §65's summaries and exports ("my October as a spreadsheet").
- App: whether the app's chat gets the same ("how did my week go?") is to decide.

### §67 — A note on a completion
"Mark run done, 5 km, legs tired": a short note kept with that day's completion, like a journal line, shown with the day in the app.

- Data: a new optional field on a completion log entry. It must survive an un-completion only if that's decided (today un-completing deletes the entry; see the Completion log rule in CLAUDE.md).
- Connector (inputs ready, 2026-10-27): `set_done` and `log_progress` take a `note`; until this is built the completion is saved and the result says the note wasn't (`noteNotSaved`). Once built, `get_day` and §66's history return the notes.

### §68 — Skip a day
"I'm sick today, skip gym": one excused day that counts as neither done nor missed, so the streak survives, lighter than a pause.

- Probably a one-day pause under the hood (§28's rules: paused days aren't scheduled days), unless a separate "skipped" mark reads better in the app; to decide. Whether a past day can be skipped (a pause can't start in the past) is also to decide.
- Connector (inputs ready, 2026-10-27): `schedule` has a `skip` op with a `date` (default today), answering `not_available` until this is built.

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
