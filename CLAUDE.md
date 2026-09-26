# Habit Assistant

An agent-driven habit tracker and task manager. Instead of navigating menus, forms and checkboxes like typical apps (HabitNow, Focus To-Do, Todoist), the user talks to an agent in plain English ("add a habit to read every night," "mark gym done today," "add milk to my shopping list"). The agent performs the action and asks a follow-up question only when it genuinely can't act without one.

This friction (fighting an app's UI just to log something simple) is the reason the project exists. Judge every design decision by whether it reduces it.

Related docs: `README.md` (user-facing pitch), `CONTRIBUTING.md` (setup, running, testing, deploying, code map), `Roadmap.md` (prioritized backlog, and the `§N` ID/commit conventions).

## Interaction model

- **Chat-first.** A text box is the primary interface, and the agent acts directly rather than routing the user to forms. Creating and editing recurrence rules is chat-only by design; there is no form for them.
- **Ask, don't guess.** When information is missing, the agent asks. When a name matches several items, the app lists them and the user picks, by number or name. Confirmations are built from the item as it was actually saved, including any defaults the agent assumed, so the user can spot a misunderstanding.
- **Voice input.** Hold the mic button to record; on release, the clip is transcribed and **sent immediately**, with no review step. This is a deliberate trade of the usual caution for a voice-native feel. The transcript still shows up as the sent message. A user message is just text wherever it came from, so voice feeds the same pipeline as typing.
- **User manual: `public/help.html`**, linked from the `?` button in the top bar, from Settings and from the chat's empty state. It restates user-visible behaviour that's defined in code, so **any change to user-visible behaviour updates it in the same `Close §N` commit**.
- **No push notifications or reminders.** The app is pull-based. Don't build toward notifications, but don't design anything that would make adding them painful later.

## Item model (`src/types/models.ts`)

Three item types share a base: `name` (required), `description`, `category` (optional, but required on Habits), `priority` (numeric; sets display order), `startDate` (defaults to today), `endDate`.

- **Habit.** Recurring, with a completion type:
  - **Yes/No**: a toggle.
  - **Numeric value**: a number against a required target and a free-text unit, logged through chat (`logHabitProgress`).
  - **Timer**: minutes against a required target. Logged through chat, or with the live timer tab (`TimerView.tsx`, `useTimerSession.ts`). Timer state is device-local (`timerStore.ts`), survives backgrounding, and reopens *paused* after a full close; it never fast-forwards elapsed time. The user saves the result to the habit explicitly.
  - **Checklist**: resets per occurrence, with progress stored as a per-date snapshot in the completion log.
- **Recurring Task.** Same shape as a Habit (category, priority, dates, recurrence), but tracking is only done/not-done per occurrence: no completion types and no stats.
- **Single Task.** One-off, done/not-done. An undone task rolls forward to today rather than appearing on every future day.
- **Checklists.** One shared component (`Checklist.tsx`) in two roles: a Habit's completion type, which resets each occurrence, and a freeform attachment on either Task type (e.g. a weekly "go shopping" task used as a running list). A Recurring Task's attached checklist is currently a single persistent list that never resets. A task has a checklist once it's created with one ("…with a checklist inside", possibly empty) or gets its first item. The day view shows it behind a progress badge (`3/7`, even `0/0`) that expands to the list, and ticking the last item offers, never forces, marking the task done.
- **Archive** (Habits and Recurring Tasks) sets `endDate` to today, keeping history and stopping future occurrences. **Delete** erases the item and its history. Single Tasks have no archive.
- **Pause** (Habits and Recurring Tasks) is a list of `{from, resumeOn?}` periods; `resumeOn` is the first day back and is optional for an open-ended pause. Paused days are not scheduled days, so they count as neither done nor missed and don't break streaks. Finished pauses are kept forever; dropping one would turn its days back into misses. A pause can't start in the past.
- **No completion changes on future dates.** Habits and Recurring Tasks block it outright. For a Single Task, the agent confirms and then moves the task to today. Editing an item's other fields from a future day is still allowed.
- **Marking done through chat** (`setHabitDone`, `setRecurringTaskDone`) sets rather than toggles, for any past or current day the item is due. For a Numeric or Timer habit, "done" logs the full goal (a bigger logged amount is kept); for a Checklist habit it ticks every item. Replies spell out what was recorded ("with 8 glasses", "by marking all checklist items done"). A stated amount still goes through `logHabitProgress`.
- **Completion log.** Un-completing deletes the log entry instead of recording an event, so the log reflects current state, not a full history.

## Categories

A default starter set with icons ships out of the box: Quit a bad habit, Study, Sports, Social, Finance, Health, Work, Nutrition, Home, Outdoor, Other. Users can add their own. **Category is required on Habits only** (the agent picks the best fit, falling back to Other, so it never has to ask); it's optional on Recurring and Single Tasks. This keeps agent-created items low-friction.

## Recurrence (`src/lib/recurrence.ts`)

Supported rules: daily, specific weekdays, every N days, N times per week/month (flexible, not pinned to days), nth weekday of month (first to fifth, or last), specific yearly dates (MM-DD), and on/off cycles.

**`occursOn(item, date)` is the single source of truth for "is this due?"** Views, stats, streaks and the heatmap all ask it. That's why pausing needed no special cases elsewhere, so route new scheduling rules through it too. Weeks start on Sunday (0=Sunday), hardcoded.

## Stats (`src/lib/habitStats.ts`)

Streak, best streak, completion %, and this week/month/year/all-time counts, per habit (`HabitsView`) and per category (`CategoriesView`). The "stats" tab (`Dashboard.tsx`) adds an overall meter, KPI tiles, a per-category breakdown, and a hand-rolled SVG calendar heatmap (`CalendarHeatmap.tsx`). The same heatmap, via `HabitHeatmap.tsx`, also sits on each habit's own page in `HabitsView`. There's deliberately no charting library.

## Architecture

- **Frontend:** a PWA (React + Vite + Tailwind). One codebase serves Android (installed to the home screen) and desktop browsers.
- **Storage: the user's own Google Drive.** One JSON file in a *visible* "Habit Assistant" folder, not the hidden appDataFolder, so users can inspect and back it up. This is a deliberate choice over a hosted database: real data ownership, at a cost of $0 by construction. Near-simultaneous edits from two devices are detected with Drive's modifiedTime; on a conflict the app re-reads the file and replays the mutation (`driveClient.ts`, `DriveConflictError`), with no merge logic.
- **Auth:** Google Identity Services with scope `drive.file`, used for both sign-in and Drive access. Access tokens last an hour and are never renewed silently: once one is about to expire (or a save gets a 401), a Reconnect banner appears, the Google popup opens only from its tap, and any save waiting on it is replayed afterwards (`persist` in `App.tsx`, GitHub issue #7).
- **Server: one small Cloudflare Worker** (`src/server/worker.ts`; static assets served via `wrangler.jsonc`'s `assets`). Its only jobs are `/api/agent` and `/api/transcribe`, so provider keys never reach the browser. Storage still goes straight from the browser to Drive. This is a narrow, deliberate exception to "no backend," not an always-on server.
- **Chat turn logic is UI-free.** Everything after "send" lives in `ChatSession` (`src/lib/chatEngine.ts`): calling the agent, running the tool call it chose, follow-ups ("which one?", confirmations) and the reply text. `App.tsx` drives it with the real Drive persist; `npm run test:chat` drives the same code headless against real models. **New chat behavior belongs in the engine and comes with a targeted scenario.**
- **Name matching** (`src/lib/itemSelection.ts`): an exact name wins; otherwise the app tries word forms and ignores generic words, and offers every match closest-first.

### LLM provider strategy

The agent layer is provider-agnostic: one `ProviderAdapter` per provider in `src/server/providers/` (Anthropic, Groq, Gemini, Workers AI, and a zero-cost `mock`). The app uses a hybrid cost model:

- **Shared free trial by default**, funded by the operator's key. **Gemini is the primary** (`gemini-flash-lite-latest`; plain Flash allows only 20 free requests a day) in both dev and prod. `TRIAL_PROVIDER` is committed in `wrangler.jsonc`'s `vars` because a dashboard variable of the same name gets silently overwritten on every deploy; this caused real incidents twice. Change providers in `wrangler.jsonc`, never the dashboard.
- **Failover chain:** primary → optional `TRIAL_FALLBACK_*` → optional Workers AI last resort. It moves to the next tier on transient errors (429/5xx), with a per-provider retry and a request timeout. All three tiers have been verified live, but only Gemini is enabled in production.
- **Groq is not the fallback yet.** The free tier's token limits can't take the full tool-schema payload. `classifyIntent.ts` sends only the relevant subset of tools for a confidently classified message, which fits, but an unclassified message still gets the full payload. That gap has to close before `TRIAL_FALLBACK_PROVIDER=groq` ships.
- **Bring your own key (BYOK)** is first-class: in Settings, users can plug in an Anthropic, Groq or Gemini key. BYOK settings sync across devices as plain text in the Drive file (reconciled at sign-in). The user chose this knowingly: without a backend there's no honest way to encrypt them, so Drive is the security boundary.
- **Shared-trial cap:** a client-trusted per-user message counter (`SHARED_KEY_MESSAGE_CAP` in `dataStore.ts`) nudges users toward BYOK. It's **currently set to `Infinity`** (lifted temporarily).
- **Debug log:** a password-gated Settings section shows the last 50 model calls (provider/model, latency, retries, intent bucket, message, reply/error). It's device-local, never synced, and the `VITE_DEBUG_LOG_PASSWORD` gate is a speed bump, not security. **When the agent replies badly, check which provider answered first.**
- The shared trial is a bootstrap mechanism. If it's ever strained, move users to BYOK or a paid tier; don't over-build for scale.

### Voice input

- The browser records audio with `MediaRecorder` and sends it to `/api/transcribe`, which forwards it to **Groq Whisper**. Audio is never stored or logged. STT has its own key (`STT_TRIAL_API_KEY`) and its own BYOK toggle, independent of the chat provider.
- **Guards against Whisper hallucinating on silence** (1.2s of silence came back as "Thank you."):
  - **Client-side:** Silero VAD (`voiceActivityDetection.ts`, `NonRealTimeVAD`) skips both API calls when a recording contains no speech. It **fails open**: if the model can't load, the recording goes through. The ~13MB `onnxruntime-web` WASM runtime is self-hosted in `public/ort/` and precached by the service worker. It doesn't need COOP/COEP headers, which could break Google Sign-in.
  - **Server-side:** a blocklist of known hallucination phrases in `handleTranscribeRequest.ts` acts as a backstop.
- Agent replies can be read aloud (browser speech synthesis; toggle in Settings).
- **Future work, not built:** slide-to-lock recording, and fully on-device Whisper (WASM/WebGPU) for privacy and offline use.

## Open questions

Deliberately undecided; raise them before they become load-bearing. (Concrete planned work lives in `Roadmap.md`.)

- Should a Recurring Task's attached checklist reset each occurrence, or carry unfinished items forward? Today it's one persistent list.
- Should the completion log record un-completions as events (a true history) instead of deleting entries?
- Whether and when to revisit push notifications.
- Whether and when to build slide-to-lock recording and/or on-device Whisper.
- Should the first day of the week be a user setting? It's hardcoded to Sunday.
