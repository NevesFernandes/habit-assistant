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
- **Next available ID: §58** (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)

---

## Now

### §57 — Fix: a one-off task "for next Thursday" is created for today
Reported 2026-10-05: "add a task for next Thursday, just that day, called ingress battle beacons, in the social category" → `Date: today (Mon 5 Oct)`, `Assumed: due today`. The category and "just that day" were understood; the day was lost.

- **Cause (read from the code, not yet confirmed in the debug log):** the prompt tells the model never to work out a date from a weekday itself, but to pass `startWeekday`/`startWeekdayMode` and leave `startDate` empty, so the app resolves it (`resolveWeekdayDate`). `createHabit` and `createRecurringTask` have those fields; `createSingleTask` (`handleAgentRequest.ts`) has only `startDate`. The model obeys, sends no date, and the task defaults to today.
- **Fix:** add `startWeekday` and `startWeekdayMode` to `createSingleTask`'s tool and to `CreateSingleTaskInput`, and have `addSingleTask` use `resolveStartDate` (`dataStore.ts`) as the other two do. `describeCreatedSingleTask`'s "Assumed: due today" hint must then also count a weekday as a given date (`startDateGiven` in `confirmations.ts` already does this for the other two).
- Editing already works ("move it to next Thursday"): `updateSingleTask` has `newStartWeekday`. "Tomorrow" and "on the 8th" work too, since they go through `startDate`.
- Targeted chat scenarios, on Gemini and Groq: "a task for next Thursday", "a task on Friday" (closest), and one said on that same weekday ("next Monday" on a Monday is 7 days out). Check `help.html`'s task examples still hold.

## Next

### §48 — Point to your own key when the shared trial's key is broken
During the 2026-10-02 incident (the trial's Gemini key was deleted along with the OAuth client), every shared-trial chat failed with only "The assistant provider had a problem answering. Please try again in a moment." The §40 hint toward setting up your own key never showed: Gemini answered `400 API_KEY_INVALID`, `handleAgentRequest.ts` passed that status through, and the client (`isModelUnavailable` in `chatEngine.ts`) deliberately skips the hint on 4xx, which normally means a malformed request.

- **Shared trial:** a provider rejecting *the operator's* key (400 `API_KEY_INVALID`, 401, 403) is a server-side configuration problem, not the user's fault, so the user should see the same "the free trial is busy… add your own key" hint as for a 429/5xx. Most likely fix: on the trial path, map those provider responses to a 503 in `handleAgentRequest.ts`, so the existing client logic applies unchanged; also check whether such an error should skip retries and fail over to the next tier.
- **Own key (BYOK):** the same rejection means *the user's* key is wrong or revoked. Say that plainly ("Your Gemini key was rejected. Check it in Settings (⚙)") instead of the generic message.
- Extend `src/lib/trialHint.test.ts`; update `help.html` if the wording users see changes.

### §49 — Show the app in screenshots before sign-in
The homepage (`SignIn.tsx`) describes the app only in text, so a visitor can't see what they'd get until after signing in with Google. Real screenshots exist in `branding/Screenshots/` (taken with `demo-data.json`: today, future day, categories, habits list, recurring tasks, stats, habit page with heatmap, timer). Chat screenshots are still to be taken.

- **Homepage:** a chat screenshot as the main image near the top, since the chat is what sets the app apart. Below it, a small swipeable row of 3–4 others (today, habit page with heatmap, stats).
- **Install prompt:** add `screenshots` to the PWA manifest (`vite.config.ts`, none today), so Android shows its richer, store-like install dialog.
- **Web-sized copies:** about 600px wide, WebP. Keep them out of the service-worker precache (`globPatterns` currently doesn't match `.webp`/`.jpg`; keep it that way) so installs don't get heavier.
- **Follow-up, optional:** one image in each matching `help.html` section (heatmap, task checklists) and in the README.
- Screenshots go stale when the UI changes, like `help.html`. Keep them few and in obvious places.

### §51 — Review: follow-up replies and changes to several items at once
Seen 2026-10-05 (own Groq key, `openai/gpt-oss-120b`): "Change my brush teeth habits to self-care category" → `updateHabit` matched two habits → the app asked "which one?" → the user replied "Both, 1 and 2" → the debug log shows `bucket: fallback:full` and Groq refused the call: `Request too large … TPM: Limit 8000, Requested 12828`. The user saw a failure and nothing changed. Three gaps compound here; design them together before building anything:

- **Picking several items.** `parsePick` (`itemSelection.ts`) accepts only one pick ("2", "the second one", "last"), so "both", "1 and 2", "all of them" fall through to the model as a brand-new message. Even if parsed, `updateHabit`/`updateRecurringTask`/`updateSingleTask` (and archive, mark done, log) change exactly one item. Delete already takes filters and several items, so it's the model to follow. Decide which actions get multi-item support, and how the confirmation lists what changed.
- **Replies aren't read as replies.** `classifyIntent` (`src/server/classifyIntent.ts`) classifies only the latest user message, so a short answer to an app question ("both", "yes, Monday", "the morning one") gets no action words and goes to the full tool list. When the app has just asked something (a pending pick, or any question), classify using the original request, or reuse the bucket of the call that asked.
- **The full tool list doesn't fit Groq's free tier** (~12.8k tokens against an 8k-per-minute limit). That is the known blocker for Groq as the trial's fallback (CLAUDE.md), and it hits BYOK Groq users directly. Fixing the two gaps above makes `fallback:full` rarer, but doesn't remove it. Consider a slimmer fallback payload, or a clearer error that tells a Groq BYOK user what happened instead of a generic failure.
- Output of the review: a short decision per gap (some may become their own `§N` items), then targeted chat scenarios reproducing this exact sequence. Update `help.html` if multi-item edits become possible.

## Later

### §47 — Keep an API key on this device only
Today every BYOK key syncs to the Drive data file in plain text (§30), so each device can use it. That's fine for a free key, but a key with billing (always the case for Anthropic) is only as safe as the Drive file: anyone the folder is shared with, or any app with whole-Drive access, can read it. §40 documented this in the privacy policy (`privacy.html#keys`), in Settings and in `api-key-setup.html`. This item adds the real fix: a per-key **"Keep on this device only"** option in Settings.

- A device-only key stays in `localStorage` and is left out of `exportByokState()`, so it never reaches the Drive file. Other devices don't see it and need their own.
- Sign-in reconciliation (`importByokState` in `App.tsx`) must not overwrite or delete a device-only key with the Drive copy (or its absence).
- Turning the option on for a key that was already synced removes it from the Drive file. **But Google Drive keeps earlier versions of a file (typically for 30 days)**, so the key stays readable in the file's version history. The Settings text should say so, and suggest replacing the key at the provider to be fully safe.
- Update CLAUDE.md's BYOK paragraph, `help.html`, `privacy.html` and `api-key-setup.html` to match.

### §44 — Research: reminders / push notifications
The app is deliberately pull-based today (no notifications). Reminders are the most common habit-app feature, but real push needs something the app doesn't have: a scheduled server-side job that knows when each user's items are due and holds their push subscriptions. That cuts against "data in your own Drive, $0 by construction."

**This item is research only, not a build:** find the cheapest honest design (e.g. Cloudflare Worker cron triggers + Web Push, with the minimum of per-user state held server-side), what it would cost and what data would have to leave Drive, and how well PWA push works on Android. Then decide whether to build it. Until then, keep the CLAUDE.md rule: don't build toward notifications, but don't make them hard to add.

### §45 — Voice: slide-to-lock recording (trial on a branch)
Today the mic button must be held for the whole message. Slide-to-lock (as in WhatsApp): while holding, slide the finger to a lock icon, then talk hands-free and tap to send (or cancel). Makes longer voice messages comfortable. UI-only; the transcription pipeline is unchanged.

**Trial first:** build it on a branch for hands-on testing; adopting it isn't decided. If it's dropped, record that and remove the entry.

### §46 — Voice: on-device Whisper (trial on a branch)
Transcribe in the browser (Whisper via WASM/WebGPU) instead of sending audio to Groq: better privacy, works offline, no STT key needed. Costs to measure: model download size (tens to hundreds of MB, precached by the service worker like `public/ort/`), transcription speed on a mid-range Android phone, battery, and accuracy versus Groq Whisper. The Silero VAD silence guard stays in front of it either way.

**Trial first:** a spike on a branch, measured on the user's real phone; adopting it isn't decided. If it's adopted, it's probably a Settings toggle alongside the Groq path rather than a replacement.

### §54 — Brainstorm: rethink priorities
The user isn't happy with the current design and wants to brainstorm before anything is built. How it works today, as a starting point:

- Every item has `priority`, an open-ended positive number (default 1, higher = more important), set only through chat ("this is really important" → the model picks some higher number).
- Its only effect is display order: every list (day view, habits, tasks, stats, timer) sorts by priority, then by name. The bare number shows in the lists, and in confirmations once it's above 1.
- Habits, Recurring Tasks and Single Tasks all share one scale.

Questions to bring to the session (not decisions):
- **Scale:** an open number nobody can interpret ("is 3 high?"), vs. a few named levels (low/normal/high), or none at all with a "pin to top" / manual order instead.
- **Purpose:** is it about *ordering* the day, *highlighting* what matters, or *filtering* (e.g. "what's important today")? Each points to a different design.
- **Chat fit:** how the user says it ("make gym top priority", "move reading above meditation") and what the model can reliably map to the stored value.
- **Display:** a number, a colour, a flag icon, or only position in the list.
- **Migration:** existing items' numbers in users' Drive files must map cleanly to whatever replaces them.

### §56 — Remove a checklist, or one item from it, through chat
Found while fixing §55: chat can add items to a task's checklist and tick them, but nothing can take an item off again, or remove the checklist from a task ("remove milk from my shopping list", "remove the checklist from the shopping task"). `Checklist.tsx` has no delete control either, so a mistyped item stays forever. Today the assistant says it can't (§55 added that wording so it doesn't delete the task instead).

- Tools to remove one or more items from a Single or Recurring Task's checklist, and to remove the checklist itself (back to a plain task, no badge). Decide what removing an item means in each recurring mode (§42): in *carry over* the item just ends; in *same list* it leaves the routine from that day on, keeping earlier days' ticks.
- A Checklist habit already replaces its whole list through `updateHabit`'s `newChecklistItems`; consider a remove-one-item path there too.
- `classifyIntent`: "remove … from my … list" should reach the checklist tools, not the delete tools. Consider a delete control in `Checklist.tsx` as well.
- Update `help.html`, which currently says this can't be done through chat.

New items go in on request, at whichever position and tier they deserve, taking the next free ID above.
