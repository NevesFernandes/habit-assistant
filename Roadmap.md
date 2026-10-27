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
- **Next available ID: §80** (§62, "today" as the local date rather than UTC, was used directly for §61 Phase 2 — see `Close §62`) (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

---

## Now

### §76 — Habit packs
"Set me up a morning routine": a ready-made set of items created in one go. In Claude this already works (several `create_item` calls). For the app, either the same through its chat or a small set of templates; to decide.

## Next

### §74 — Calendar sync
"Put today's tasks in my calendar." In Claude this already works with no code: Claude combines this connector with a calendar connector. An app-side version would need a Google Calendar scope on top of `drive.file`, which widens what the app asks for at sign-in; weigh that before building. `help.html` already mentions the Claude combination ("what's on today, habits and calendar?").

## Later

### §79 — Export button in the app
An Export button with a period picker (on the stats tab or in Settings), for users who'd rather tap than ask. §72 built the export by chat only ("export my October", with a Download button in the reply); this would reuse its file (`buildExportCsv` in `src/lib/exportCsv.ts`). A small form, which the app otherwise avoids, so only if people ask for it.

### §78 — Bulk edits by chat
"Move all my Sports habits to the evening", "make every morning habit important", "put all my chores in Home": one edit applied to every item a filter catches (part of the day, category, kind, a list of names), as §75 does for done, skip and pause. Left out of §75 on purpose: edits touch more fields and are harder to reverse in bulk. In the connector, the same as §75's `more_actions` action or an extension of it.

### §70 — Undo the last change
"Undo that" right after a change made by chat (app or Claude). Needs care: what counts as the last change when the app and the connector both write the same file, and how far back it goes. Probably not a general history (see the Completion log rule in CLAUDE.md). In the connector, a `more_actions` action.

### §71 — Goals and challenges
A target with a deadline and visible progress: "read 20 books by December", "a 30-day no-sugar challenge". Builds on the stats (§63) and history (§66). In the connector, `more_actions` actions or a bigger `get_stats` result (no reconnect).

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
