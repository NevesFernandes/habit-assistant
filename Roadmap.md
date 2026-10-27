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
- **Next available ID: §63** (§62, "today" as the local date rather than UTC, was used directly for §61 Phase 2 — see `Close §62`) (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

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
- **Phase 4:** `checklist`, `schedule`, `delete_items`, `get_stats`.
- **Phase 5:** `privacy.html` (data now passes through this Worker, which keeps Google refresh tokens) and `help.html`, user onboarding. Don't share the connector URL before this.
    - `help.html` explains two ways to point Claude at Habit Assistant, decided 2026-10-27 (no profile-wide preference, which would collide with people who use their calendar for work): (1) recommended, a "Habits" Project in claude.ai with copy-paste project instructions, so a plain "what's on today?" works inside it and nowhere else; (2) for users who don't want a Project, name it in the message ("what's on my habits today?", "what's left in Habit Assistant?").
    - Onboarding must also say: after an update that adds tools, disconnect and reconnect the connector to see them (claude.ai caches the tool list).

## Next

## Later

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
