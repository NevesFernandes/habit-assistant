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
- **Next available ID: §42** (§30 used directly — see `Close §30`/`Merge §30` commits syncing BYOK settings across devices via the Drive data file — without a queued entry here, since it was implemented in the same session it was requested)
- See also `CLAUDE.md`'s "Open questions / to refine later" section for undecided design questions — those are a different kind of thing from the concrete, actionable items below.

---

## Now

_Nothing queued._

## Next

_Nothing queued._

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
