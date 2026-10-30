import { useState } from "react";
import {
  loadOnDeviceStt,
  setOnDeviceEnabled,
  setOnDeviceSize,
  type OnDeviceRun,
  type WhisperSize,
} from "../lib/onDeviceSttStore";
import { deleteWhisperDownloads, loadWhisper } from "../lib/onDeviceWhisper";

// §46: on-device transcription, a trial switched on per device. The numbers below
// (download size, load time, time to text per message) are what decides whether it stays.

// Download sizes with WebGPU, where the encoder stays full precision and the 4-bit decoder
// keeps its vocabulary table unquantized (Base measured at 209 MB, Tiny estimated). Without
// WebGPU the 8-bit CPU models are smaller (roughly 40 and 80 MB). Once downloaded, the
// measured size is shown instead.
const SIZES: { id: WhisperSize; label: string; approx: string }[] = [
  { id: "tiny", label: "Tiny", approx: "about 120 MB" },
  { id: "base", label: "Base", approx: "about 210 MB" },
];

const BACKEND_LABEL = { webgpu: "WebGPU", wasm: "CPU" } as const;

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function describeRun(run: OnDeviceRun): string {
  const time = new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const audio = `${run.audioSeconds.toFixed(1)} s of speech`;
  if (run.error) return `${time} · ${run.size} · ${audio}: failed, sent to Groq (${run.error})`;
  const backend = run.backend ? BACKEND_LABEL[run.backend] : "";
  return `${time} · ${run.size} · ${backend} · ${audio} → text in ${seconds(run.ms ?? 0)}`;
}

export default function OnDeviceSttSettings() {
  const [state, setState] = useState(loadOnDeviceStt);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => setState(loadOnDeviceStt());

  const downloaded = state.downloaded[state.size];
  const downloading = progress !== null;

  async function download(size: WhisperSize) {
    setError(null);
    setProgress({ loaded: 0, total: 0 });
    try {
      await loadWhisper(size, (loaded, total) => setProgress({ loaded, total }));
    } catch (err) {
      setError(`The download failed: ${err instanceof Error ? err.message : "unknown error"}. Voice messages still go to Groq.`);
    } finally {
      setProgress(null);
      refresh();
    }
  }

  function handleToggle() {
    const next = !state.enabled;
    setOnDeviceEnabled(next);
    refresh();
    if (next && !state.downloaded[state.size]) void download(state.size);
  }

  function handleSize(size: WhisperSize) {
    setOnDeviceSize(size);
    refresh();
    if (state.enabled && !state.downloaded[size]) void download(size);
  }

  async function handleDelete() {
    await deleteWhisperDownloads();
    setOnDeviceEnabled(false);
    refresh();
  }

  return (
    <div className="mt-4">
      <h3 className="mb-1 font-medium">On this device (trial)</h3>
      <p className="mb-3 text-slate-400">
        Turns speech into text on this phone instead of sending the recording to Groq: private, and it works
        offline once the model is downloaded. English only. If it fails, the message goes to Groq as before.
      </p>
      <div className="flex items-center justify-between rounded-md bg-slate-900 px-3 py-2">
        <span>{state.enabled ? "On for this device" : "Off"}</span>
        <button
          onClick={handleToggle}
          disabled={downloading}
          className="rounded-md bg-violet-500 px-2 py-1 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {state.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>

      {state.enabled && (
        <>
          <div className="mt-2 flex gap-2">
            {SIZES.map((size) => (
              <button
                key={size.id}
                onClick={() => handleSize(size.id)}
                disabled={downloading}
                className={
                  "flex-1 rounded-md px-2 py-1 text-xs disabled:opacity-40 " +
                  (state.size === size.id ? "bg-violet-500 text-white" : "bg-slate-900 text-slate-300")
                }
              >
                {size.label} ({state.downloaded[size.id]?.bytes ? megabytes(state.downloaded[size.id]!.bytes) : size.approx})
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {downloading
              ? progress.total > 0
                ? `Downloading… ${megabytes(progress.loaded)} of ${megabytes(progress.total)}`
                : "Starting the download…"
              : downloaded
                ? `Ready: ${BACKEND_LABEL[downloaded.backend]}, loaded in ${seconds(downloaded.loadMs)}.`
                : "Not downloaded yet, so voice messages still go to Groq."}
          </p>
          {!downloading && !downloaded && (
            <button
              onClick={() => void download(state.size)}
              className="mt-1 rounded-md bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600"
            >
              Download
            </button>
          )}
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </>
      )}

      {state.runs.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-300">Recent voice messages on this device</p>
          <ul className="space-y-0.5 text-xs text-slate-400">
            {state.runs.map((run) => (
              <li key={run.at}>{describeRun(run)}</li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(state.downloaded).length > 0 && (
        <button
          onClick={() => void handleDelete()}
          disabled={downloading}
          className="mt-3 rounded-md bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600 disabled:opacity-40"
        >
          Delete downloaded models
        </button>
      )}
    </div>
  );
}
