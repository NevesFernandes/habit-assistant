# Habit Assistant

See `CLAUDE.md` for the product vision and architecture decisions. This README is just the "how do I run it" instructions.

**Status**: first scaffold plus a provider-agnostic agent layer. Sign in, chat with the assistant (on a shared free trial by default, or your own key via the Settings panel), and it can create simple one-off tasks — that's the whole vertical slice for now. Habits, recurring tasks, and everything else in `CLAUDE.md` come next.

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

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. This runs the frontend *and* a local stand-in for `/api/agent` (a small Vite dev-server plugin, `vite.config.ts`, that calls the same shared code as the real Cloudflare Function). It reads the trial provider's key straight from `.dev.vars`.

There's also `npm run pages:dev`, which uses Cloudflare's own `wrangler pages dev` — a more faithful emulation of the real deployment. It should work on a normal machine, but the Workers runtime it uses (`workerd`) needs to reserve large aligned memory regions that some sandboxed/restricted environments block, so if it crashes with an `mmap`/`tcmalloc` error, use plain `npm run dev` instead — that's what this project was actually verified against.

## Deploying (when you're ready)

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account.
2. **Workers & Pages → Create → Pages → Connect to Git**, pick this GitHub repo.
3. Build command: `npm run build`. Build output directory: `dist`.
4. In the Pages project's **Settings → Environment variables**, add `TRIAL_PROVIDER`, `TRIAL_API_KEY` (and optionally `TRIAL_MODEL`) as secrets — same idea as `.dev.vars`, but for production.
5. Add the deployed `*.pages.dev` URL as another "Authorized JavaScript origin" on the Google OAuth client from step 1.

I'll walk through each of these with you when we get there.
