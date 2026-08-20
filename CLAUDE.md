# Habit Assistant

An agent-driven habit tracker and task manager. Instead of navigating menus, forms, and checkboxes like typical apps (HabitNow, Focus To-Do, Todoist), the user talks to an agent in plain English — "add a habit to read every night," "mark gym done today," "add milk to my shopping list" — and the agent performs the action, asking a clarifying follow-up question only when it genuinely needs more information to act.

This friction — fighting an app's UI just to log something simple — is the entire reason this project exists. Every design decision below should be judged against whether it reduces that friction.

**Status: initial scaffold exists.** Sign-in with Google, Drive-backed data storage, a chat UI that can create a Single Task via one tool call, a provider-agnostic agent layer (shared free trial + BYOK settings), and voice input (Groq Whisper, press-and-hold) are implemented end-to-end. Habits, Recurring Tasks, the fuller recurrence engine, and the stats dashboard are not built yet — see `README.md` for how to run what exists, and `Roadmap.md` for the prioritized backlog of what's planned next.

## Interaction model

- **Chat-first**: a text box is the primary interface. The agent interprets natural-language requests and acts on them directly (creates/edits/completes items) rather than routing the user through forms.
- **Conversational, not fire-and-forget**: if the agent doesn't have enough information to complete a request, it asks a follow-up question instead of guessing or silently failing.
- **Voice input**: press-and-hold the mic button to speak; on release, the clip is transcribed and **sent immediately** — no review/edit step before it reaches the agent. This was a deliberate choice (not an oversight) for a faster voice-native feel, at the cost of the usual "never guess" caution; the transcript is still visible afterward as the sent user message in the chat log. "User message" is treated as an abstract text input throughout the system regardless of source, so voice just feeds the same pipeline as typing — see "Voice input" under Architecture for how transcription actually works.
- **No push notifications or reminders in v1.** The app is pull-based — the user checks in on their own terms. This may be revisited later; don't build toward it yet, but don't design anything that would make adding it later painful.

## Item taxonomy

Three item types share a common base:

- `name` (required)
- `description` (optional)
- `category` (optional, see Categories below)
- `priority` (numeric; affects display order)
- `startDate` (defaults to today)
- `endDate` (optional)

### 1. Habit
Recurring. Has a **completion type**:
- Yes/No
- Numeric value (e.g. "8 glasses of water")
- Timer (duration-based, e.g. "meditate 10 min")
- Checklist (percent-complete toward that occurrence's completion — partial or 100%)

Habits are meant to build a detailed tracking/statistics dashboard over time (streaks, history, charts). **The dashboard UI itself is a future phase**, but completion history must be logged from day one (every occurrence, every completion event) so stats can be computed later without backfilling data.

### 2. Recurring Task
Same structural shape as a Habit (category, priority, dates, periodicity) but tracking is simple: **done / not-done per occurrence only**. No completion-type machinery, no stats dashboard.

### 3. Single Task
One-off. No periodicity. Done / not-done.

### Checklists (a shared building block, two different uses)
- As a **Habit's completion type**: defines what "done" means for that occurrence (e.g. a morning-routine checklist resets and must be filled each day).
- As an **attachment on either Task type**: a freeform, growing list of sub-items unrelated to the done/not-done status of the task itself. Example: a weekly recurring task "go shopping," where items get added throughout the week, functioning as a running shopping list.

These are the same underlying checklist component used in two different roles — don't build two separate implementations. Exact reset/carry-over behavior of a *task's* checklist across recurring occurrences (does it clear each cycle, or carry unfinished items forward?) is intentionally undecided — see Open Questions.

## Categories

- A default starter list of categories exists out of the box, each with a small icon (reference: HabitNow's default set — Quit a bad habit, Study, Sports, Social, Finance, Health, Work, Nutrition, Home, Outdoor, Other). Treat this as the starting point, not a locked spec — icons/colors are ours to design.
- Users can add their own categories ("Create category").
- **Category is optional**, with a sensible default — this was explicitly left undecided in the source notes ("debatable if it should be mandatory"); optional was chosen to keep friction low for quick agent-created items.

## Periodicity

Applies to Habits and Recurring Tasks. The full target model:

- Every day
- Specific days of the week
- Specific days of the month, including "nth weekday of month" (e.g. "third Monday") via two linked selectors: first/second/third/fourth/fifth/last + day-of-week
- Specific dates of the year (recurring annually — e.g. birthdays), added one at a time to a list
- "N times per period" (per week/month/year), flexible/unpinned to specific days
- Interval repeats ("every X days")
- On/off cycles ("5 days on, 2 days off")

**This is phased.** The data model should be designed up front to represent all of the above, but v1's actual implementation only needs to cover the common cases: every day, specific days of week, every X days, N times per week. The remaining types (nth-weekday-of-month, specific yearly dates, on/off cycles) are a fast follow-up once the core create → track → complete loop works end-to-end. Don't skip designing the data model for them now just because they're not built yet — retrofitting recurrence rules later is painful.

## Architecture

- **Frontend**: a web app, built as an installable PWA. One codebase works on Android (installed to home screen) and desktop browsers.
- **Storage**: the user's own Google Drive. Data lives as a file (or small set of files) in the user's Drive — not a third-party-hosted database. This was a deliberate choice over a "free-tier" hosted DB service, trading some extra engineering effort (Drive API integration, basic conflict handling for near-simultaneous edits from two devices) for genuine data ownership and a cost that is $0 by construction rather than by a company's current pricing policy.
- **Hosting**: **Cloudflare Pages** — static site hosting plus one Pages Function, both free. (Superseded the earlier "GitHub Pages" idea once it became clear the Anthropic key needed a server-side home — see below.)
- **Auth**: Google Sign-In via Google Identity Services, scope `drive.file`. It serves double duty — logging the user in, and granting OAuth access to their Drive file. The data file lives in a **visible** "Habit Assistant" folder in the user's own Drive (not the hidden `appDataFolder`), so it's genuinely inspectable/backup-able by them.
- **Agent / LLM**: called from **one small Cloudflare Pages Function** (`functions/api/agent.ts`) rather than directly from the browser — calling a provider client-side would put whichever key is in use in the browser bundle/network requests, a real extraction risk even for a private tool. This is a deliberate, narrow amendment to "no backend": it's a single on-demand function, not an always-on server; storage and sync still go straight from the browser to Drive with nothing else in between. See "Cost model / provider strategy" below for which provider and why.
- **Notifications**: none in v1. Don't spend effort enabling them, but don't design storage/sync in a way that would preclude adding them later.

### Cost model / provider strategy

Real testing costs real money (a single Anthropic call during scaffolding cost ~$0.01), and that scales fast with iteration and, later, real users. The agent's LLM call is provider-agnostic by design (`src/server/providers/`, one `ProviderAdapter` per provider — currently Anthropic, Groq, Gemini, plus a zero-cost `mock` adapter for local dev), and the app runs a **hybrid cost model**:

- **Shared free trial by default**: every user gets a working agent out of the box, funded by one shared key the app operator (currently: the user of this repo) pays for — currently **Groq**, chosen because it has a genuinely free, no-credit-card tier (~14,400 requests/day) with tool-use-tuned models, which this app's actual task (interpret a short command, pick a tool) doesn't need a frontier model for. **Gemini** is a documented fallback free tier if Groq's shared quota ever becomes a bottleneck.
- **Bring-your-own-key (BYOK) is a first-class, day-one part of the interface**, not deferred to a "public launch" pass — a Settings panel (`src/components/Settings.tsx`) lets any user plug in their own key for Anthropic, Groq, or Gemini, for unlimited/higher-quality use. BYOK settings are stored in browser `localStorage`, deliberately **not** synced into the Drive data file — keys are per-device secrets; the Drive file is for habit/task data.
- The shared trial is understood as a **bootstrap/trial mechanism, not permanent infrastructure**. If usage ever grows enough to strain the shared key, moving most users to BYOK (or a paid shared tier) is the intended next step — revisit then, don't over-build for scale now.
- `TRIAL_PROVIDER` / `TRIAL_API_KEY` / `TRIAL_MODEL` env vars configure the shared trial (see `.env.example`, `README.md`). `TRIAL_PROVIDER=mock` is a zero-cost stand-in for local development that isn't testing agent reasoning itself.

### Voice input

Researched three real options: the browser-native Web Speech API (free, but broken in installed iOS PWAs and gives us no control over the model — a real blocker, not a minor gap); fully client-side WASM/WebGPU Whisper (the true web-native analog of what WhatsApp/Telegram do with on-device transcription — most private, zero ongoing cost, but meaningfully more engineering effort); and cloud transcription through our own proxy. **Went with the cloud path**, mirroring the LLM proxy's architecture exactly:

- Audio is recorded in the browser (`MediaRecorder`) and POSTed to **one small Cloudflare Pages Function** (`functions/api/transcribe.ts`), which forwards it to **Groq's Whisper API** and returns text — the browser never holds an STT key, and raw audio is never persisted anywhere (not in Drive, not logged; transcribed and discarded immediately).
- **Speech-to-text has its own provider setting**, independent of whichever LLM the user is chatting with (`STT_TRIAL_API_KEY` env var, separate from `TRIAL_API_KEY`; its own toggle in Settings) — since Groq is the only viable free STT option today, chat could be on Anthropic while voice still uses Groq underneath.
- **Recording gesture is press-and-hold** (mirrors the mic button on `VoiceButton.tsx`). WhatsApp/Telegram both converge on press-and-hold **with slide-to-lock** for hands-free longer recordings — v1 deliberately only builds the hold gesture, not the lock, to keep scope down.
- **Transcribed text sends immediately**, no review/edit step — a deliberate divergence from the app's usual "never guess" caution, chosen for a faster voice-native feel over accuracy-guarding friction.

**Whisper hallucinates on silent/near-silent audio.** Confirmed directly: 1.2 seconds of pure silence against the real Groq API came back as `"Thank you."`, and the API's own confidence signals (`no_speech_prob`, `avg_logprob`) didn't flag it either — with auto-send, that means a wasted transcription call *and* a wasted chat call, silently, every time. Two layers now guard against it:
- **Server-side phrase blocklist** (`handleTranscribeRequest.ts`): known Whisper hallucination outputs (`"Thank you."`, `"Thanks for watching."`, etc. — a small, documented list used elsewhere for this exact problem) are treated as "no speech detected" rather than real text. Cheap, but still costs the Whisper call itself, and only catches known phrases.
- **Client-side voice-activity detection** (`src/lib/voiceActivityDetection.ts`, `hasSpeech()`): before a recording is ever sent anywhere, **Silero VAD** (`@ricky0123/vad-web`, `NonRealTimeVAD` — the non-streaming API, matching the "post-hoc only" decision, not the live-mic `MicVAD`) checks whether it contains actual speech. If not, both the transcription call and the chat call are skipped entirely. **Fails open**: if the model can't load for any reason, the recording is let through rather than voice input silently breaking — the phrase blocklist above remains as a backstop.
  - Real cost of this: the Silero *model* is small (~2MB), but it depends on the `onnxruntime-web` WASM runtime, which is **~13MB** — self-hosted (`public/ort/`, `public/silero_vad_legacy.onnx`) rather than the library's default CDN, consistent with this project's pattern of not depending on third-party runtime fetches, and precached by the service worker (`vite.config.ts`'s `workbox.maximumFileSizeToCacheInBytes`/`globPatterns`) so it's a one-time ~15MB download, not a repeat cost.
  - Confirmed it doesn't need special server headers: `onnxruntime-web` auto-detects `crossOriginIsolated` and falls back to single-threaded execution when cross-origin-isolation (COOP/COEP) headers aren't present, rather than requiring them — worth knowing since forcing those headers site-wide could otherwise have risked breaking Google Sign-in's cross-origin flow.

**Noted as explicit future work, not built now:**
- Slide-to-lock gesture for hands-free recording.
- Fully client-side WASM/WebGPU Whisper (`transformers.js` or similar) — the closest web-native equivalent to WhatsApp's on-device privacy model (audio never leaves the device at all, works offline, zero ongoing cost even at scale). **Distinct from the VAD model above** — Silero VAD only answers "is there speech," it doesn't transcribe anything, so it doesn't reduce the need for Groq Whisper today. Worth revisiting once voice usage/priority justifies the extra build effort.

## Open questions / to refine later

These were deliberately left undecided rather than guessed at — surface them again before they become load-bearing. (For concrete, actionable planned features rather than open design questions, see `Roadmap.md`.)

- Does a recurring task's checklist reset each new occurrence, or carry unfinished items forward to the next cycle?
- Exact conflict-resolution strategy for near-simultaneous edits to the Drive-stored data file from two devices.
- Design of the stats/dashboard view for Habits (streaks, charts, etc.) — functionality is expected, visuals/metrics are not yet specified.
- Whether/when to revisit push notifications, given "no reminders" was affirmed for now but not ruled out permanently.
- Whether/when to build slide-to-lock recording and/or client-side WASM Whisper (see "Voice input" above).
