# Habit Assistant

See `CLAUDE.md` for the product vision and architecture decisions. This README is just the "how do I run it" instructions.

**Status**: first scaffold plus a provider-agnostic agent layer and voice input. Sign in, chat (typed or spoken — press-and-hold the mic button) with the assistant on a shared free trial by default, or your own key via the Settings panel, and it can create simple one-off tasks — that's the whole vertical slice for now. Habits, recurring tasks, and everything else in `CLAUDE.md` come next.

## One-time setup (things only you can do)

### 1. Google OAuth client (for Drive sign-in)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (any name).
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the required fields (app name, your email), and leave it in *Testing* mode — that's fine since only you will use it. Add your own Google account under "Test users".
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**: type *Web application*. Under "Authorized JavaScript origins" add `http://localhost:5173`.
4. Copy the resulting **Client ID** (looks like `123...apps.googleusercontent.com`) — it's not secret.
5. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to that value.
6. **APIs & Services → Library**, search **Google Drive API**, open it, click **Enable**. (Easy to miss — the OAuth client alone doesn't turn the API on. Without this step, sign-in works but loading/creating the data file fails with a 403 `accessNotConfigured` error.)

### 2. A key for the shared "free trial" provider (for the chat assistant)

The app defaults to **Groq**, which has a genuinely free, no-credit-card API tier — this funds the experience anyone gets before they add their own key in the app's Settings panel. See CLAUDE.md's "Cost model / provider strategy" for why.

1. Create a free key at [console.groq.com](https://console.groq.com/keys).
2. Create a file named `.dev.vars` in the project root (gitignored) with:
   ```
   TRIAL_PROVIDER=groq
   TRIAL_API_KEY=gsk_...
   ```

Prefer a different default, or want to test without spending anything at all?
- Swap `TRIAL_PROVIDER` to `gemini` (free tier at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)) or `anthropic` ([console.anthropic.com](https://console.anthropic.com/) — separate billing from a Claude.ai subscription).
- Set `TRIAL_PROVIDER=mock` and skip `TRIAL_API_KEY` entirely — a zero-cost, keyword-matching stand-in for iterating on anything that isn't agent reasoning itself.

Anthropic, Groq, and Gemini are also the three choices in the app's own Settings panel, for anyone who wants to bring their own key instead of using the shared trial.

### 3. A key for the shared voice-transcription trial

Voice input (press-and-hold the mic button in chat) always uses Groq's Whisper API — it's the only viable free speech-to-text option, so unlike chat there's no provider choice here. This is a **separate** trial key from step 2's, even though it's likely the same physical Groq key.

Add to the same `.dev.vars` file:
```
STT_TRIAL_API_KEY=gsk_...
```

(You can reuse the same Groq key from step 2, or create a second one — either works.) Anyone can also switch to their *own* Groq key for voice specifically in the Settings panel, independent of whichever provider they're chatting with.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. This runs the frontend *and* a local stand-in for `/api/agent` and `/api/transcribe` (a small Vite dev-server plugin, `vite.config.ts`, that calls the same shared code as the real Cloudflare Functions). It reads the trial keys straight from `.dev.vars`. Microphone access requires HTTPS or `localhost` — both `http://localhost:5173` here and the real Cloudflare Pages deployment already satisfy that, nothing extra to configure.

There's also `npm run pages:dev`, which uses Cloudflare's own `wrangler pages dev` — a more faithful emulation of the real deployment. It should work on a normal machine, but the Workers runtime it uses (`workerd`) needs to reserve large aligned memory regions that some sandboxed/restricted environments block, so if it crashes with an `mmap`/`tcmalloc` error, use plain `npm run dev` instead — that's what this project was actually verified against.

## Testing on your Android phone

Since most real usage will be on a phone, it's worth testing there directly during development — without deploying anywhere public. `adb reverse` (standard Android developer tooling) forwards the phone's own `http://localhost:5173` to your laptop's dev server over the USB cable, so the phone's browser sees the exact same origin your laptop already uses. That means **no new Google OAuth origin, no HTTPS cert, no Vite config changes, and no traffic ever leaves the USB cable** — the cleanest way to avoid a public deployment just for testing.

One-time setup:
1. On the phone: **Settings → About phone** → tap "Build number" 7 times to unlock **Developer Options** → enable **USB debugging**.
2. On the laptop: install `adb` (Debian/Ubuntu: `sudo apt install adb`).
3. Connect via USB cable, and accept the "Allow USB debugging?" prompt that appears on the phone.
4. Verify: `adb devices` should list the phone as `device` (not `unauthorized`).

Day to day:
```bash
npm run dev:phone
```
This is just `adb reverse tcp:5173 tcp:5173 && vite` — then open `http://localhost:5173` in Chrome **on the phone**. It behaves identically to the laptop: same OAuth origin, same secure-context treatment for microphone access, live-reload included. For remote debugging (console, network, elements), open `chrome://inspect/#devices` in desktop Chrome to inspect the phone's tab directly.

One caveat: this only covers the app itself, not the PWA install layer. `npm run dev` never enables the service worker (`vite-plugin-pwa` only turns it on for production builds), so no "Add to Home Screen" prompt and no offline caching will show up this way — that's true on the laptop too, not phone-specific. To test the actual installed-app experience, build first instead:
```bash
npm run build
npm run preview
```
Note the port `vite preview` prints (`4173` by default), forward that one instead (`adb reverse tcp:4173 tcp:4173`), and open it on the phone — that's the build where the service worker, install prompt, and offline caching are all actually active.

Prefer no cable? Android 11+ supports wireless `adb` (`adb pair`/`adb connect`, paired over the same Wi-Fi network) — same `adb reverse` command afterward, still fully local, nothing internet-facing.

## Deploying (when you're ready)

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account.
2. **Workers & Pages → Create → Pages → Connect to Git**, pick this GitHub repo.
3. Build command: `npm run build`. Build output directory: `dist`.
4. In the Pages project's **Settings → Environment variables**, add `TRIAL_PROVIDER`, `TRIAL_API_KEY`, `STT_TRIAL_API_KEY` (and optionally `TRIAL_MODEL`) as secrets — same idea as `.dev.vars`, but for production.
5. Add the deployed `*.pages.dev` URL as another "Authorized JavaScript origin" on the Google OAuth client from step 1.

I'll walk through each of these with you when we get there.
