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
- **Next available ID: §61** (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

---

## Now

## Next

## Later

### §44 — Research: reminders / push notifications
The app is deliberately pull-based today (no notifications). Reminders are the most common habit-app feature, but real push needs something the app doesn't have: a scheduled server-side job that knows when each user's items are due and holds their push subscriptions. That cuts against "data in your own Drive, $0 by construction."

**This item is research only, not a build:** find the cheapest honest design (e.g. Cloudflare Worker cron triggers + Web Push, with the minimum of per-user state held server-side), what it would cost and what data would have to leave Drive, and how well PWA push works on Android. Then decide whether to build it. Until then, keep the CLAUDE.md rule: don't build toward notifications, but don't make them hard to add.

### §45 — Voice: slide-to-lock recording (trial on a branch)
Today the mic button must be held for the whole message. Slide-to-lock (as in WhatsApp): while holding, slide the finger to a lock icon, then talk hands-free and tap to send (or cancel). Makes longer voice messages comfortable. UI-only; the transcription pipeline is unchanged.

**Trial first:** build it on a branch for hands-on testing; adopting it isn't decided. If it's dropped, record that and remove the entry.

### §46 — Voice: on-device Whisper (trial on a branch)
Transcribe in the browser (Whisper via WASM/WebGPU) instead of sending audio to Groq: better privacy, works offline, no STT key needed. Costs to measure: model download size (tens to hundreds of MB, precached by the service worker like `public/ort/`), transcription speed on a mid-range Android phone, battery, and accuracy versus Groq Whisper. The Silero VAD silence guard stays in front of it either way.

**Trial first:** a spike on a branch, measured on the user's real phone; adopting it isn't decided. If it's adopted, it's probably a Settings toggle alongside the Groq path rather than a replacement.

### §60 — Extra priority inside a part of the day
§54 replaced the priority number with six parts of the day; inside a part the order is important items first, then A–Z. The user expects that to be enough for their own lists, but another user's part could get cluttered. Only pick this up if that shows in real use.

- Ideas, not decisions: an exact order the user sets ("put reading before meditation", or drag to reorder), or more than one level of importance.
- Whatever is chosen has to stay sayable in chat and readable without numbers, which is what §54 removed.

### §58 — Shrink the full tool list to fit Groq's free tier
A message `classifyIntent` can't place still gets every tool and every prompt rule: about 14,900 tokens (estimated at 4 characters per token; Groq counted 12,828 for it on 2026-10-05), against the 8,000 tokens a minute of Groq's free tier. §51 made this rarer (short replies are classified by what they answer, and several items can be picked without a model call) and gave a user on their own Groq key a clear "too large" message, but the full list itself is unchanged. It is the last blocker for `TRIAL_FALLBACK_PROVIDER=groq` (CLAUDE.md).

- Sizes measured 2026-10-05, estimated tokens: full ~14,900; edit ~7,500; create ~4,400; delete ~4,400. §56 (2026-10-08) then added about 650 to the full, delete and checklist sets for its two remove tools and their rules (not re-measured: full ~15,500, delete ~5,050). §54 (2026-10-08) swapped the priority fields for part-of-day and importance fields plus one prompt rule: an estimated 250 to 350 more tokens on the create and edit sets, which puts the edit set (~7,500 before) at about the 8,000 limit on its own. The edit set alone is close to the limit, so a Groq user gets about one edit a minute; delete + edit together doesn't fit.
- Options to weigh: a first small call that only chooses the tool family (two calls per unclassified message); trimming the prompt rules, which are most of the size; splitting the edit set (update vs. log/mark done vs. pause/archive); or a cheaper model on Groq with higher limits.
- Related safety net to consider: when the model was given a narrowed tool set and says it can't do what was asked, retry once with the full list. That would have caught §55's wrong refusal, and covers a short follow-up that §51 routes to the wrong family.
- Whatever is chosen changes how every unclassified message is handled on every provider, so it needs the chat scenarios run broadly, not just targeted ones.

### §59 — Fix: pause and archive requests are too large for Groq's free tier
Found 2026-10-05 while testing §51 on Groq: "pause my drink water habit" was refused, `Request too large … TPM: Limit 8000, Requested 8171`. Gemini is unaffected. Not a priority: Groq's limits are to be flagged to users rather than worked around.

- **Cause:** a pause or archive verb puts the message in both the `delete` and `modify` buckets (`classifyIntent.ts`), so the model gets the delete tools and the edit tools together. That combination was already close to the limit; the prompt wording added by §53 and §55 (about 270 tokens) most likely tipped it over. The earlier size wasn't measured, so "worked before today" is an estimate (~7,900).
- **Likely fix:** the pause and archive tools are already in the `modify` set (`TOOL_MANIFEST` in `handleAgentRequest.ts`), so a pause or archive verb on its own doesn't need the delete tools. Sending only `modify` brings it to about 7,300 tokens. This relaxes a deliberate "send more to be safe" rule (§28: "stop my gym habit for two weeks" must never be left with only the destructive tools), so keep `delete` whenever a delete verb is also present, and update the `classifyIntent.test.ts` cases that expect both.
- Even then the edit set alone is near the limit, and a few turns of history push it over, so this only buys headroom. The real fix is §58; consider doing this as part of it.
- Verify with `npm run test:chat -- s51-pick-all --provider groq`, which fails today for this reason (its multi-pick step is therefore unverified on Groq for pause).

New items go in on request, at whichever position and tier they deserve, taking the next free ID above.
