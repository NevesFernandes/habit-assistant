import { useState } from "react";
import {
  getSavedKey,
  saveProviderKey,
  setActiveProvider,
  forgetProviderKey,
  getSttUsesOwnKey,
  setSttUsesOwnKey,
  getTtsEnabled,
  setTtsEnabled,
  type ByokProvider,
} from "../lib/settingsStore";
import { isTtsSupported, cancelSpeech } from "../lib/textToSpeech";
import type { DebugLogEntry } from "../lib/debugLogStore";

interface SettingsProps {
  activeProvider: ByokProvider | null;
  sharedKeyExhausted: boolean;
  onChange: () => void;
  onClose: () => void;
  // §27 in Roadmap.md: owned by App.tsx (not loaded/cleared locally here) so
  // the list stays live while this panel is open during a chat turn, instead
  // of only reflecting a one-time snapshot taken when it was unlocked.
  debugLog: DebugLogEntry[];
  onClearDebugLog: () => void;
}

const PROVIDERS: { id: ByokProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "groq", label: "Groq" },
  { id: "gemini", label: "Google Gemini" },
];

// §27 in Roadmap.md: a casual-access speed bump, not real security — the
// expected value ships in the client bundle and is trivially visible via
// devtools. Fails closed (never unlocks) if the env var itself is unset.
function checkUnlockPassword(input: string): boolean {
  const expected = import.meta.env.VITE_DEBUG_LOG_PASSWORD;
  return Boolean(expected) && input === expected;
}

export default function Settings({
  activeProvider,
  sharedKeyExhausted,
  onChange,
  onClose,
  debugLog,
  onClearDebugLog,
}: SettingsProps) {
  const [selected, setSelected] = useState<ByokProvider>(activeProvider ?? "groq");
  const [apiKey, setApiKey] = useState(() => getSavedKey(selected)?.apiKey ?? "");
  const [model, setModel] = useState(() => getSavedKey(selected)?.model ?? "");
  const [sttOwnKey, setSttOwnKey] = useState(getSttUsesOwnKey());
  const [ttsOn, setTtsOn] = useState(getTtsEnabled());
  const [debugPasswordInput, setDebugPasswordInput] = useState("");
  const [debugUnlocked, setDebugUnlocked] = useState(false);

  function handleSelect(provider: ByokProvider) {
    setSelected(provider);
    const saved = getSavedKey(provider);
    setApiKey(saved?.apiKey ?? "");
    setModel(saved?.model ?? "");
  }

  function handleSave() {
    if (!apiKey.trim()) return;
    saveProviderKey(selected, apiKey.trim(), model.trim() || undefined);
    onChange();
  }

  function handleUseTrial() {
    setActiveProvider(null);
    onChange();
  }

  function handleForget() {
    forgetProviderKey(selected);
    setApiKey("");
    setModel("");
    onChange();
  }

  const hasSavedKey = getSavedKey(selected) !== null;
  const hasGroqKey = getSavedKey("groq") !== null;

  function handleToggleStt() {
    const next = !sttOwnKey;
    setSttOwnKey(next);
    setSttUsesOwnKey(next);
    onChange();
  }

  const ttsSupported = isTtsSupported();

  function handleToggleTts() {
    const next = !ttsOn;
    setTtsOn(next);
    setTtsEnabled(next);
    if (!next) cancelSpeech();
    onChange();
  }

  function handleUnlockDebugLog() {
    if (checkUnlockPassword(debugPasswordInput)) setDebugUnlocked(true);
    setDebugPasswordInput("");
  }

  return (
    <div className="rounded-md bg-slate-800 p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">API keys</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          ✕
        </button>
      </div>
      <p className="mb-3 text-slate-400">
        You're on the free shared trial by default. Save a key per provider below, then switch
        between them any time — each one stays saved in this browser (never synced to your Drive
        data) until you remove it, so testing back and forth doesn't lose anything.
      </p>

      <div className="mb-3 flex items-center justify-between rounded-md bg-slate-900 px-3 py-2">
        <span>Free trial (shared)</span>
        {sharedKeyExhausted && activeProvider !== null ? (
          <span className="text-xs text-slate-500">Trial used up</span>
        ) : (
          <button
            onClick={handleUseTrial}
            disabled={activeProvider === null}
            className="rounded-md bg-violet-500 px-2 py-1 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
          >
            {activeProvider === null ? "Active" : "Use this"}
          </button>
        )}
      </div>
      {sharedKeyExhausted && (
        <p className="mb-3 text-xs text-slate-500">
          You've used your free trial messages.{" "}
          <a href="/groq-setup.html" target="_blank" rel="noreferrer" className="text-violet-400 underline">
            Get a free groq or gemini key →
          </a>
        </p>
      )}

      <label className="mb-1 block text-slate-300">Provider</label>
      <select
        value={selected}
        onChange={(event) => handleSelect(event.target.value as ByokProvider)}
        className="mb-3 w-full rounded-md bg-slate-900 px-2 py-1.5"
      >
        {PROVIDERS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {activeProvider === option.id ? " (active)" : ""}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-slate-300">API key</label>
      <input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder="sk-..."
        className="mb-3 w-full rounded-md bg-slate-900 px-2 py-1.5"
      />

      <label className="mb-1 block text-slate-300">Model override (optional)</label>
      <input
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder="Leave blank for the default"
        className="mb-4 w-full rounded-md bg-slate-900 px-2 py-1.5"
      />

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!apiKey.trim()}
          className="rounded-md bg-violet-500 px-3 py-1.5 font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {activeProvider === selected ? "Update" : "Save & use"}
        </button>
        {hasSavedKey && (
          <button onClick={handleForget} className="rounded-md bg-slate-700 px-3 py-1.5 hover:bg-slate-600">
            Forget this key
          </button>
        )}
      </div>

      <hr className="my-4 border-slate-700" />

      <h2 className="mb-2 font-medium">Voice transcription</h2>
      <p className="mb-3 text-slate-400">
        Independent of the chat provider above — uses a free shared trial by default, or your own
        Groq key (the same one saved above, if you have one).
      </p>
      <div className="flex items-center justify-between rounded-md bg-slate-900 px-3 py-2">
        <span>{sttOwnKey ? "Using your Groq key" : "Using free trial"}</span>
        <button
          onClick={handleToggleStt}
          disabled={!sttOwnKey && !hasGroqKey}
          className="rounded-md bg-violet-500 px-2 py-1 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {sttOwnKey ? "Switch to trial" : "Use my Groq key"}
        </button>
      </div>
      {!hasGroqKey && !sttOwnKey && (
        <p className="mt-1 text-xs text-slate-500">Save a Groq key above first to enable this.</p>
      )}

      <hr className="my-4 border-slate-700" />

      <h2 className="mb-2 font-medium">Spoken responses</h2>
      <p className="mb-3 text-slate-400">
        Read the assistant's replies aloud using your browser's built-in voice — no key or trial
        involved.
      </p>
      <div className="flex items-center justify-between rounded-md bg-slate-900 px-3 py-2">
        <span>{ttsOn ? "Reading replies aloud" : "Not reading replies aloud"}</span>
        <button
          onClick={handleToggleTts}
          disabled={!ttsSupported}
          className="rounded-md bg-violet-500 px-2 py-1 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {ttsOn ? "Turn off" : "Turn on"}
        </button>
      </div>
      {!ttsSupported && <p className="mt-1 text-xs text-slate-500">Not supported in this browser.</p>}

      <hr className="my-4 border-slate-700" />

      <h2 className="mb-2 font-medium">Debug log</h2>
      <p className="mb-3 text-slate-400">
        Recent model calls (provider, latency, retries, replies/errors) — useful for diagnosing
        issues like the shared trial's message cap. Password-gated as a casual-access speed bump
        only, not real security; re-locks whenever you close this panel.
      </p>
      {!debugUnlocked ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={debugPasswordInput}
            onChange={(event) => setDebugPasswordInput(event.target.value)}
            placeholder="Password"
            className="flex-1 rounded-md bg-slate-900 px-2 py-1.5"
          />
          <button
            onClick={handleUnlockDebugLog}
            className="rounded-md bg-violet-500 px-3 py-1.5 font-medium text-white hover:bg-violet-400"
          >
            Unlock
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-slate-400">
              {debugLog.length} entr{debugLog.length === 1 ? "y" : "ies"}
            </span>
            <button
              onClick={onClearDebugLog}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
            >
              Clear
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {[...debugLog].reverse().map((entry, index) => (
              <div key={index} className="rounded-md bg-slate-900 px-3 py-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>
                    {entry.label} · {entry.model}
                  </span>
                  <span>
                    {entry.latencyMs}ms · retry {entry.retryCount}
                  </span>
                </div>
                <div className="text-slate-500">bucket: {entry.bucket}</div>
                <div className="mt-1 truncate text-slate-300">"{entry.requestSummary.lastUserMessage}"</div>
                <div className="mt-1">
                  {"error" in entry.result ? (
                    <span className="text-red-400">{entry.result.error}</span>
                  ) : (
                    <span className="text-slate-300">
                      {entry.result.toolCallName ?? entry.result.reply ?? "(empty)"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
