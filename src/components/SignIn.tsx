interface SignInProps {
  onClick: () => void;
  loading: boolean;
  error: string | null;
}

export default function SignIn({ onClick, loading, error }: SignInProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Habit Assistant</h1>
      <p className="max-w-sm text-slate-400">
        Sign in with Google to load (or create) your data file in your own Drive.
      </p>
      <button
        onClick={onClick}
        disabled={loading}
        className="rounded-md bg-violet-500 px-4 py-2 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in with Google"}
      </button>
      {error && <p className="max-w-sm text-sm text-red-400">{error}</p>}
    </div>
  );
}
