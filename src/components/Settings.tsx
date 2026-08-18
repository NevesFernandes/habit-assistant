import { useState } from "react";
import type { ByokProvider, ByokSettings } from "../lib/settingsStore";

interface SettingsProps {
  current: ByokSettings | null;
  onSave: (settings: ByokSettings) => void;
  onClear: () => void;
  onClose: () => void;
}

const PROVIDERS: { id: ByokProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "groq", label: "Groq" },
  { id: "gemini", label: "Google Gemini" },
];

export default function Settings({ current, onSave, onClear, onClose }: SettingsProps) {
  const [provider, setProvider] = useState<ByokProvider>(current?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [model, setModel] = useState(current?.model ?? "");

  function handleSave() {
    if (!apiKey.trim()) return;
    onSave({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined });
    onClose();
  }

  function handleClear() {
    setApiKey("");
    setModel("");
    onClear();
  }

  return (
    <div className="rounded-md bg-slate-800 p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Your own API key (optional)</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
          ✕
        </button>
      </div>
      <p className="mb-3 text-slate-400">
        By default you're using a shared free trial. Add your own key here for unlimited use with
        the provider of your choice — it's stored only in this browser, never synced to your Drive
        data.
      </p>

      <label className="mb-1 block text-slate-300">Provider</label>
      <select
        value={provider}
        onChange={(event) => setProvider(event.target.value as ByokProvider)}
        className="mb-3 w-full rounded-md bg-slate-900 px-2 py-1.5"
      >
        {PROVIDERS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
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
          Save
        </button>
        {current && (
          <button onClick={handleClear} className="rounded-md bg-slate-700 px-3 py-1.5 hover:bg-slate-600">
            Remove key (use free trial)
          </button>
        )}
      </div>
    </div>
  );
}
