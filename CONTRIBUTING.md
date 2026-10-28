# Contributing to Habit Assistant

This guide is for developers: how to run the app locally, test it, deploy your own copy, and find your way around the code. For what the app does, see [README.md](README.md). For why it's built the way it is, see [CLAUDE.md](CLAUDE.md).

## Stack at a glance

- **Frontend:** React 19 + TypeScript + Tailwind 4, built with Vite as an installable PWA (`vite-plugin-pwa`).
- **Storage:** a JSON file in the user's own Google Drive, reached from the browser through the Drive API. There's no database.
- **Server:** one small Cloudflare Worker (`src/server/worker.ts`) with two routes. `/api/agent` calls the LLM and `/api/transcribe` calls Groq Whisper. It exists so API keys never reach the browser.
- **LLM providers:** Gemini (default), Groq, Anthropic and Cloudflare Workers AI, each behind one adapter in `src/server/providers/`, plus a zero-cost `mock` adapter.

## 1. One-time setup

### Google OAuth client (sign-in and Drive access)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → OAuth consent screen:** choose *External*, fill in the required fields, and leave it in *Testing* mode. Add every Google account that should be able to sign in under "Test users".
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID:** choose *Web application*, and add `http://localhost:5173` under "Authorized JavaScript origins".
4. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to the Client ID. It's not a secret.
5. **APIs & Services → Library → Google Drive API → Enable.** This is easy to miss. Without it, sign-in works but loading the data file fails with a 403 `accessNotConfigured`.

### Server-side keys (`.dev.vars`)

Create `.dev.vars` in the project root (it's gitignored). At minimum:

```
TRIAL_PROVIDER=gemini
TRIAL_API_KEY=...          # free Gemini key: aistudio.google.com/apikey
STT_TRIAL_API_KEY=gsk_...  # free Groq key for voice: console.groq.com
```

- `TRIAL_*` funds the shared free trial that every user gets before adding their own key.
- `STT_TRIAL_API_KEY` funds voice transcription. Groq Whisper is the only speech-to-text provider, so voice has its own key, separate from chat.
- `TRIAL_PROVIDER=mock` needs no key at all. It matches keywords and doesn't reason, which makes it useful for UI work that doesn't depend on the model.
- Optional failover tiers (`TRIAL_FALLBACK_*`, `WORKERS_AI_*`), `TRIAL_MODEL` overrides and `VITE_DEBUG_LOG_PASSWORD` are all documented in [`.env.example`](.env.example).

Users can bring their own Anthropic, Groq or Gemini key in the app's Settings panel. `public/api-key-setup.html` is the step-by-step guide the app links to for getting one.

## 2. Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

A small Vite dev-server plugin (`vite.config.ts`) stands in for the Worker. It serves `/api/agent` and `/api/transcribe` with the same shared code as production and reads keys from `.dev.vars`.

`npm run workers:dev` runs the real Workers runtime (`wrangler dev`) instead. It's more faithful to production, but it crashes with an `mmap`/`tcmalloc` error in some sandboxed environments. Plain `npm run dev` is the verified path.

The service worker (install prompt, offline cache) is only active in production builds. To test it, use `npm run build && npm run preview`.

### On an Android phone, over USB

`adb reverse` makes the phone's `localhost:5173` point at your dev server, so there's no new OAuth origin, no HTTPS certificate and nothing exposed to the internet.

1. Enable **Developer Options → USB debugging** on the phone, install `adb` (`sudo apt install adb`), connect the cable and accept the prompt. `adb devices` should list the phone as `device`.
2. Run `npm run dev:phone` and open `http://localhost:5173` in Chrome on the phone.
3. To debug the phone's tab from desktop Chrome, open `chrome://inspect/#devices`.

To test the installed PWA, run `npm run preview` and forward port `4173` instead. Wireless `adb` (`adb pair`/`adb connect`) also works on Android 11+.

## 3. Testing

```bash
npm run typecheck
npm run build
```

**Unit tests** are plain scripts, one per area: `test:classify`, `test:payloadSize`, `test:routing`, `test:recurrenceSpec`, `test:confirmations`, `test:itemSelection`, `test:futureCompletion`, `test:pause`, `test:heatmap`, `test:markDone`, `test:recurringChecklist`, `test:checklistRemoval`, `test:deviceOnlyKeys`, `test:dayParts`, `test:driveToken`, `test:weekStart`, `test:history`, `test:dayNotes`, `test:skip`, `test:taskStats`, `test:statsReset`, `test:historySummary`, `test:unarchive`, `test:settingsByChat`, `test:missed`, `test:bulk`, `test:exportCsv`, `test:pack`, `test:undo`, `test:goals`, `test:mcp`. Run them with, for example, `npm run test:pause`. `test:mcp` also replays the chat scenarios the Claude connector covers as tool calls (`src/mcp/scenarios.test.ts`): same fixtures and data checks, no model. When a connector tool gains a behaviour that has a chat scenario, port the scenario there too.

**Chat scenario tests** play scripted conversations against a *real* model with no browser and no Google login. They drive the same chat engine the app uses (`src/lib/chatEngine.ts`), with fixture data from `tests/chat/fixtures/*.json`.

```bash
npm run test:chat -- s32-identical                    # scenarios whose name contains this (a filter is required)
npm run test:chat -- s32-identical --repeat 5         # pass rate over 5 runs
npm run test:chat -- s32-identical --provider groq    # gemini (default) | groq | workersAI | chain
npm run test:chat -- s32-identical --delay 3000       # ms between calls, for tight rate limits
```

- Each model turn is a real API call, so run only the scenarios for what you changed. `--all` exists but is rarely worth the cost. Setting `TEST_GEMINI_API_KEY` in `.dev.vars` keeps test runs off the dev app's quota.
- Full transcripts go to `test-results/chat-<timestamp>.json` (gitignored).
- To add a scenario, add a `{ user, expect }` turn list to a file in `tests/chat/scenarios/`, and register any new file in `tests/chat/run.ts`. `tests/chat/types.ts` shows what `expect` can check.

## 4. Deploying your own copy (Cloudflare Workers, free)

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account, then **Create app → Connect to Git**, and pick your fork, branch `main`.
2. Keep the pre-filled build command (`npm run build`) and deploy command (`npx wrangler deploy`). `wrangler.jsonc` already points at the `dist` assets and the Worker entry point. The project name must match `wrangler.jsonc`'s `"name"` (`habit-assistant`); rename one or the other if they differ.
3. Under **Settings → Variables and Secrets**, add the secrets: `TRIAL_API_KEY`, `STT_TRIAL_API_KEY`, and any optional failover keys.
4. Also add `VITE_GOOGLE_CLIENT_ID` as a plain **build** variable. Vite bakes it into the bundle at build time, and without it sign-in silently breaks.
5. Add the deployed `*.workers.dev` URL (or your custom domain) as another "Authorized JavaScript origin" on your OAuth client.
6. **No custom domain?** The official deployment uses one (`habitassistant.app`), so `wrangler.jsonc` sets `"workers_dev": false`, which switches the `*.workers.dev` address off. Set it to `true` in your fork, or your copy has no address at all.

**Gotcha:** `TRIAL_PROVIDER` (and `TRIAL_FALLBACK_PROVIDER`, if used) belongs in `wrangler.jsonc`'s `vars`, not the dashboard. A dashboard variable of the same name is silently overwritten by the committed value on every Git-triggered deploy. To change providers, edit `wrangler.jsonc` and push.

### The Claude connector (MCP Worker, §61)

A second Worker, `habit-assistant-mcp` (`wrangler.mcp.jsonc`, code in `src/mcp/`), lets Claude read and change the same Drive file as the app through a custom connector at `https://mcp.habitassistant.app/mcp`. It deploys separately from the app, so a broken connector can't take the app down.

1. In Google Cloud, in the app's project, create a second OAuth client (Web application) with the redirect URI `https://mcp.habitassistant.app/callback`. Put its client ID in `wrangler.mcp.jsonc`'s `GOOGLE_CLIENT_ID`.
2. `npx wrangler kv namespace create OAUTH_KV`, and put the id in `wrangler.mcp.jsonc`.
3. In Cloudflare, **Create app → Connect to Git** on the same repo, name it `habit-assistant-mcp`, no build command, deploy command `npx wrangler deploy --config wrangler.mcp.jsonc`. Add `GOOGLE_CLIENT_SECRET` as a runtime secret (Settings → Variables and Secrets) on this Worker only. To deploy a branch other than `main`, set it under Settings → Build → Branch control; a build only picks it up on the next push to that branch, since retrying a failed build rebuilds the same commit.
4. Locally: `npm run mcp:dev` (port 8788; put `GOOGLE_CLIENT_SECRET` in `.dev.vars` and add `http://localhost:8788/callback` to the OAuth client). `--local-upstream` in that script stops wrangler from rewriting the host to the custom domain, which would break OAuth discovery.

## 5. Finding your way around

| Path | What's there |
|---|---|
| `src/App.tsx` | App shell: sign-in, tabs, Drive load/save |
| `src/components/` | UI views: `DayView` (today), `HabitsView`, `Dashboard` (stats), `TimerView`, `Settings`, `Chat`, … |
| `src/lib/chatEngine.ts` | Everything after "send": calls the agent, runs its tool calls, asks follow-ups. UI-free. |
| `src/lib/dataStore.ts` | Every data mutation, as pure functions over the Drive file's contents |
| `src/lib/driveClient.ts` | Drive API calls, with write-conflict detection |
| `src/lib/recurrence.ts` | `occursOn()`: the single answer to "is this item due on this date?" |
| `src/lib/habitStats.ts` | Streaks, completion %, period counts, heatmap data |
| `src/lib/history.ts`, `historyReply.ts` | §66: what was done, missed or is coming up over a period; the app chat's reply text |
| `src/lib/dayNotes.ts` | §67: one note per item per day, kept apart from the completion log |
| `src/lib/skip.ts` | §68: skip one day (today or later), stored as a flagged one-day pause |
| `src/lib/undo.ts` | §70: the last chat change per side, recorded by diffing the file, and undoing it safely |
| `src/lib/pack.ts` | §76: several new items made for the user, checked, previewed and added after a yes |
| `src/lib/goals.ts` | §71: goals and challenges on a habit or recurring task: progress, pace, achieved or not, and setting, changing and removing them |
| `src/lib/exportCsv.ts` | §72: a period's history as a CSV, one row per item per day |
| `src/lib/bulk.ts` | §75: one action (done, skip, pause, resume) on several items, by names or filters; §78: one edit on several items |
| `src/lib/missed.ts` | §73: what did I miss: a period's misses, carried-over tasks, and forward nudges |
| `src/lib/settingsByChat.ts` | §69: the settings a chat can show and change (first day of the week, read-aloud) |
| `src/lib/historySummary.ts` | §65: a period's done rate vs the one before, weekly totals and highlights |
| `src/lib/statsReset.ts` | §64: start the stats over (a count-from date, history kept), and undo it |
| `src/lib/taskStats.ts`, `statsReply.ts` | §63: recurring tasks' stats (as yes/no habits) and one-off tasks' counts; the app chat's stats replies |
| `src/server/handleAgentRequest.ts` | Tool schemas, system prompt, provider failover chain |
| `src/server/classifyIntent.ts` | Narrows which tool families are sent to the model, per message (sizes: `npm run measure:payload`) |
| `src/server/providers/` | One adapter per LLM provider |
| `src/types/models.ts` | The data model: items, recurrence rules, completion log |
| `src/mcp/` | The Claude connector: `worker.ts` (OAuth wiring), `googleAuth.ts` (consent page, Google sign-in), `server.ts` (MCP tools), `getDay.ts`, `writeTools.ts` (which items a write means, and whether it's allowed), `manageTools.ts` (checklists, schedule, delete, stats, and the `HANDLERS` several tools call), `persist.ts` (save with conflict replay), `drive.ts`; tests in `*.test.ts` with fakes in `testing/` |
| `branding/` | The logo (`logo.svg`, the one source file) and the rejected concepts. `npm run icons` regenerates every icon in `public/` from it; commit the output |
| `branding/Screenshots/` | Full-size phone screenshots. `npm run screenshots` regenerates the web-sized copies in `public/screenshots/` (homepage and install dialog) from them; commit the output. Retake them when the UI they show changes |

## 6. How work is organized

- **Roadmap items.** Planned work lives in [Roadmap.md](Roadmap.md), identified as `§N`. Never write `#N`, which GitHub turns into a link to issue or PR N. IDs are permanent and never reused.
- **One branch per item.** An item's implementation lands in a commit titled `Close §N: <description>`, which also removes its Roadmap entry. The merge into `main` is titled `Merge §N: <same description>`, so the history keeps a readable record after the entry is gone.
- **Chat behavior** belongs in `chatEngine.ts`, not in React components, and each change there should come with a targeted chat scenario.
