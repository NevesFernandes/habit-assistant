# Habit Assistant

See `CLAUDE.md` for the product vision and architecture decisions. This README is just the "how do I run it" instructions.

**Status**: first scaffold. Sign in, chat with the assistant, and it can create simple one-off tasks — that's the whole vertical slice for now. Habits, recurring tasks, and everything else in `CLAUDE.md` come next.

## One-time setup (things only you can do)

### 1. Google OAuth client (for Drive sign-in)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (any name).
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the required fields (app name, your email), and leave it in *Testing* mode — that's fine since only you will use it. Add your own Google account under "Test users".
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**: type *Web application*. Under "Authorized JavaScript origins" add `http://localhost:5173`.
4. Copy the resulting **Client ID** (looks like `123...apps.googleusercontent.com`) — it's not secret.
5. Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` to that value.

### 2. Anthropic API key (for the chat assistant)

1. Create a key at [console.anthropic.com](https://console.anthropic.com/) → API Keys. (Note: this is separate from a Claude.ai subscription — it has its own pay-as-you-go billing.)
2. Create a file named `.dev.vars` in the project root (gitignored) with:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

## Running locally

```bash
npm install
npm run pages:dev
```

This starts the Vite dev server *and* emulates the Cloudflare Pages Function together, so `/api/agent` works locally. Open the URL it prints (usually `http://localhost:8788`).

If you only need the frontend (no chat, e.g. while styling), `npm run dev` alone is faster.

## Deploying (when you're ready)

1. Create a free [Cloudflare](https://dash.cloudflare.com/) account.
2. **Workers & Pages → Create → Pages → Connect to Git**, pick this GitHub repo.
3. Build command: `npm run build`. Build output directory: `dist`.
4. In the Pages project's **Settings → Environment variables**, add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) as a secret — same idea as `.dev.vars`, but for production.
5. Add the deployed `*.pages.dev` URL as another "Authorized JavaScript origin" on the Google OAuth client from step 1.

I'll walk through each of these with you when we get there.
