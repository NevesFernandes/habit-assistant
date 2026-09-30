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
