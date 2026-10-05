interface SignInProps {
  onClick: () => void;
  loading: boolean;
  error: string | null;
}

// §40 step 4: this screen is also the public homepage (what Google's brand
// verification reviews). Users see it on every visit, since sign-in isn't
// renewed silently, so the button stays at the top and the pitch goes below.
const EXAMPLES = [
  "Add a habit to read every night",
  "Mark gym done today",
  "I meditated for 12 minutes",
  "Add milk to my shopping list",
];

const POINTS: { title: string; text: string }[] = [
  {
    title: "Your data stays in your Drive.",
    text: "Everything is saved in one file, in a visible folder in your own Google Drive. The app can only see the files it created, and there's no account to make.",
  },
  {
    title: "Type or talk.",
    text: "Hold the mic button, say it, let go. What you said is sent as your message.",
  },
  {
    title: "Free.",
    text: "A shared trial lets you start right away. After that, add your own AI key: Google Gemini and Groq both give one for free.",
  },
  {
    title: "No ads, no tracking.",
    text: "No analytics, and your data isn't sold or shared.",
  },
];

// §49: real screenshots, so a visitor sees the app before signing in. Generated into
// public/screenshots/ by `npm run screenshots` (all 720×1492) and deliberately not
// precached by the service worker. They go stale when the UI changes: retake them then.
const HERO_SHOT = {
  src: "/screenshots/chat.webp",
  alt: "The chat: “Create a habit to do Calisthenics, on Mondays, Wednesdays and Fridays, starting only next week”, and the assistant's reply listing the habit it added.",
};

const MORE_SHOTS: { src: string; alt: string; caption: string }[] = [
  {
    src: "/screenshots/chat-voice.webp",
    alt: "The chat while recording a voice message, after marking a habit complete by text.",
    caption: "Type or talk",
  },
  { src: "/screenshots/today.webp", alt: "The day view, listing today's habits and tasks.", caption: "Your day" },
  {
    src: "/screenshots/habit.webp",
    alt: "A habit's page, with its streak, completion numbers and a calendar heatmap.",
    caption: "Each habit's history",
  },
  {
    src: "/screenshots/stats.webp",
    alt: "The stats tab, with an overall completion meter and a breakdown by category.",
    caption: "Stats",
  },
];

const SHOT_FRAME = "rounded-2xl border border-slate-700 shadow-lg";

export default function SignIn({ onClick, loading, error }: SignInProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <img src="/icon.svg" alt="" className="h-16 w-16" />
        <h1 className="text-2xl font-semibold">Habit Assistant</h1>
        <p className="text-slate-400">Track your habits and tasks by just saying what you did.</p>
        <button
          onClick={onClick}
          disabled={loading}
          className="mt-2 rounded-md bg-violet-500 px-4 py-2 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </header>

      <main className="mt-12 flex flex-col gap-8 text-sm text-slate-300">
        <p>
          Most habit trackers make you work for them: open the app, find the right screen, tap through a form, tick a
          box. Habit Assistant replaces that with a chat. Type or say what you want in plain English, and the assistant
          does it. If it needs more information, it asks one short question.
        </p>

        <img
          src={HERO_SHOT.src}
          alt={HERO_SHOT.alt}
          width={720}
          height={1492}
          className={`mx-auto h-auto w-64 ${SHOT_FRAME}`}
        />

        <section>
          <h2 className="mb-3 font-medium text-slate-100">Things you can say</h2>
          <ul className="flex flex-col gap-2">
            {EXAMPLES.map((example) => (
              <li key={example} className="rounded-md bg-slate-800 px-3 py-2 text-violet-300">
                “{example}”
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-medium text-slate-100">A look inside</h2>
          {/* Swipeable: bleeds to the screen edges (-mx-6) so the next image peeks in. */}
          <ul className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2">
            {MORE_SHOTS.map((shot) => (
              <li key={shot.src} className="w-44 shrink-0 snap-center">
                <img
                  src={shot.src}
                  alt={shot.alt}
                  width={720}
                  height={1492}
                  loading="lazy"
                  className={`h-auto w-full ${SHOT_FRAME}`}
                />
                <p className="mt-2 text-center text-xs text-slate-400">{shot.caption}</p>
              </li>
            ))}
          </ul>
        </section>

        <ul className="flex flex-col gap-4">
          {POINTS.map((point) => (
            <li key={point.title}>
              <span className="font-medium text-slate-100">{point.title}</span> {point.text}
            </li>
          ))}
        </ul>
      </main>

      <footer className="mt-12 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
        {/* §38: readable before signing in — it explains where data and chat messages go. */}
        <a href="/help.html" target="_blank" rel="noreferrer" className="text-violet-400 underline">
          How it works
        </a>
        {/* §40: Google's consent screen links here too, and requires the homepage to. */}
        <a href="/privacy.html" target="_blank" rel="noreferrer" className="text-violet-400 underline">
          Privacy policy
        </a>
        <a href="/terms.html" target="_blank" rel="noreferrer" className="text-violet-400 underline">
          Terms
        </a>
        <a href="mailto:hello@habitassistant.app" className="text-violet-400 underline">
          Contact
        </a>
        <a
          href="https://github.com/NevesFernandes/habit-assistant"
          target="_blank"
          rel="noreferrer"
          className="text-violet-400 underline"
        >
          Open source on GitHub
        </a>
      </footer>
    </div>
  );
}
