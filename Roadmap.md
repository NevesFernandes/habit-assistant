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
- **Next available ID: §41** (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)
- See also `CLAUDE.md`'s "Open questions / to refine later" section for undecided design questions — those are a different kind of thing from the concrete, actionable items below.

---

## Now

_Nothing queued._

## Next

### §36 — Make the completion-history heatmap readable
The calendar heatmap (`src/components/CalendarHeatmap.tsx`, shown today only in the "stats" tab via `Dashboard.tsx`) is hard to read. It has four problems:
- **No legend.** The colors follow the app's violet palette, not an obvious green/red, so nothing says what a color means. Add a small legend for the states the component already draws: not scheduled (`slate-800`), missed (`rose-950`), partial (the `violet-900`/`700`/`500` steps), and done (`violet-400`). While at it, check that "missed" and "not scheduled" are easy to tell apart: `rose-950` and `slate-800` are both near-black, so the legend alone may not fix that. The palette can change if it needs to.
- **Too much empty space on the left.** The cause: `Dashboard.tsx` always asks for a fixed 364-day window (`HEATMAP_WINDOW_DAYS`), and every day before the habit's `startDate` is drawn as a gray "not scheduled" cell. So a habit that is a few weeks old shows about 50 weeks of gray. The scroll container also opens at the left (oldest) edge, so on both mobile and desktop you have to scroll right to reach recent entries. Fix both: start the window at the habit's `startDate` (capped at the 364-day maximum), and open the scroll already at the right (most recent) edge. The newest entries stay on the right.
- **No weekday labels.** Add a column of weekday initials (one letter per row, stacked top to bottom) on the right edge. It must stay visible while the grid scrolls, so it can't be part of the scrolling SVG. The labels must match the grid's actual week start. That is Sunday today (`dayOfWeek`'s 0=Sunday convention, `startOfWeek` in `recurrence.ts`), which gives S M T W T F S. Letters alone repeat (two T's, two S's), but the row order makes each one unambiguous, so single letters are fine.
- **Week start is fixed, not a setting.** This came up while writing the labels. Where the week starts varies by locale, which is why labels matter. But this item only labels whatever the grid already uses. A user setting for the first day of the week is a separate, bigger change: it would touch `startOfWeek` and every "N times per week" period count too. Don't make it here; queue it as its own item if it's wanted.

### §37 — Show the completion-history heatmap in a habit's expanded card
In the Habits view, expanding a habit already shows its details and stats (`HabitsView`). Add that habit's heatmap there, below the stats, reusing `CalendarHeatmap` and `habitStats.ts`'s `habitCalendar` exactly as the stats tab does. Do not build a second implementation. **Do §36 first:** the fixes there (window trimmed to the habit's start, scroll opening on recent entries, legend, weekday labels) matter even more in a narrow card inside a list than on the dashboard. Also decide whether the dashboard's habit picker is still worth keeping once every habit shows its own heatmap. A reasonable answer is to keep it, since the dashboard gives one place to compare habits, but settle it here.

### §38 — In-app reference manual
A short help page, written for users rather than developers, that answers "what can I say?" and "how does this work?" without anyone having to read the repo. The app doesn't need to explain itself to its builder; this is for everyone else who uses it.

**Format:** a static page in `public/` (e.g. `public/help.html`), following the existing precedent of `public/api-key-setup.html`: plain HTML that loads instantly, is precached by the service worker so it works offline, and can be updated without touching app code. Keep the app's dark/violet look.

**Where the link goes:** a small `?` help icon in the top bar, next to the settings gear (`SettingsIcon` in `App.tsx`), so it's one tap from anywhere, plus a "Help" link inside Settings for people who look there. It also becomes the natural link for the chat's empty state and the first-run experience.

**Content:**
- **Talking to the assistant:** example phrasings for each action (create, complete, log a number or time, edit, pause/resume, archive, delete); how it asks when something is missing or ambiguous (including picking from a list by number); voice input (hold to speak, sent on release).
- **The item types, from the user's side:** Habit vs Recurring Task vs Single Task, and when to use which; a Habit's four completion types; checklists (a habit's resets each day, a task's is a running list).
- **Schedules:** each recurrence type, with a sample sentence that sets it up.
- **Archive vs pause vs delete:** what each keeps and what it erases. Paused days count as neither done nor missed.
- **Rules that surprise people:** you can't complete a habit on a future date; an unfinished single task rolls forward to today; the timer is per-device and reopens paused after closing the app.
- **Stats:** what streak, best streak and completion % mean, and how to read the heatmap (link or reuse §36's legend).
- **Your data:** where it lives (the "Habit Assistant" folder in your Google Drive), that you can open or back it up, and what the shared free trial vs your own key means, linking to `api-key-setup.html`.

**Keep it accurate:** the manual restates behavior that's defined in code, so any later roadmap item that changes user-visible behavior should update it in the same `Close §N` commit. Add a line saying so to `CLAUDE.md` when this ships.

## Later

### §40 — Open sign-in to the public
Today the Google OAuth app is in *Testing* mode, so only listed test users (max 100) can sign in, and the README tells people to self-host. This item makes the hosted app usable by anyone with a Google account.

**Why it's cheap on Google's side:** the app asks only for sign-in plus `drive.file`, which Google classes as a non-sensitive permission. There's no restricted-scope review or paid security audit, at most brand verification (name/logo/domain), typically days. Google reviews the *console registration* (name, logo, homepage, privacy policy, domains, permissions), not the code, so development continues on `main` as usual. Only changing permissions, name, logo or domains triggers a new review. Keep it that way: don't add scopes (e.g. Calendar, full Drive) casually after publishing. Confirm the exact current requirements in the console when starting; they come from memory as of mid-2026.

**Steps, in order:**
1. **Restore the shared-trial cap.** `SHARED_KEY_MESSAGE_CAP` in `dataStore.ts` is currently `Infinity`. With public sign-in, strangers could drain the operator's Gemini quota. Also decide whether the client-trusted counter (stored in the user's own Drive file, so resettable) is still acceptable at public scale, or needs a server-side limit. Revisit the §20 decision explicitly; don't silently keep it.
2. **Custom domain (~$10/year)**, attached to the Worker. Google needs the homepage and privacy policy on a domain you can verify ownership of, which the shared `*.workers.dev` isn't. Add it as an authorized JavaScript origin on the OAuth client.
3. **Privacy policy page:** data lives in the user's own Drive; chat text goes to the AI provider in use; voice audio is transcribed by Groq and discarded; BYOK keys sync as plain text in the user's Drive file; Gemini's free tier may use prompts to improve Google's models.
4. **Homepage:** a public landing page (the README's pitch is a ready source), linking to the privacy policy and the app.
5. **Publish** in Google Cloud Console (OAuth consent screen → publishing status → In production), completing whatever verification it asks for.
6. **Update docs:** README's "self-hosted" status wording, and `CONTRIBUTING.md`'s deploy section if steps changed.

New items go in on request, at whichever position and tier they deserve, taking the next free ID above. `CLAUDE.md`'s "Open questions / to refine later" still lists undecided design questions, and its Status section names work that was never queued here: real tracking for Numeric-value and Checklist habits, one shared interactive checklist component, closing the §24 classifier-fallback payload gap before `TRIAL_FALLBACK_PROVIDER` goes back to `groq`, and logging un-completions as their own events instead of deleting the entry.
