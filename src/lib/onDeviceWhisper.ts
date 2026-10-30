// §46: transcribe a voice clip on the phone instead of sending it to Groq (a trial,
// switched on per device in Settings). The model runs in whisperWorker.ts; this side
// decodes the audio, which needs an AudioContext the worker doesn't have.
import {
  markDownloaded,
  forgetDownloads,
  type DownloadedModel,
  type WhisperBackend,
  type WhisperSize,
} from "./onDeviceSttStore";
import type { WorkerRequest, WorkerResponse } from "./whisperWorker";
import { looksLikeHallucination } from "./whisperHallucination";

const SAMPLE_RATE = 16000; // what Whisper expects
const NO_SPEECH_MESSAGE = "No speech detected — please try again.";

type ProgressListener = (loaded: number, total: number) => void;

let worker: Worker | null = null;
let loading: { size: WhisperSize; promise: Promise<DownloadedModel> } | null = null;
let ready: { size: WhisperSize; backend: WhisperBackend } | null = null;
const progressListeners = new Set<ProgressListener>();
const pendingTranscriptions = new Map<
  number,
  { resolve: (result: { text: string; reloaded: boolean }) => void; reject: (err: Error) => void }
>();
let nextId = 1;
let settleLoad: { resolve: (model: DownloadedModel) => void; reject: (err: Error) => void } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./whisperWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    switch (message.type) {
      case "progress":
        progressListeners.forEach((listener) => listener(message.loaded, message.total));
        break;
      case "ready": {
        const model = { backend: message.backend, bytes: message.bytes, loadMs: message.loadMs };
        ready = { size: message.size, backend: message.backend };
        markDownloaded(message.size, model);
        settleLoad?.resolve(model);
        break;
      }
      case "loadError":
        settleLoad?.reject(new Error(message.message));
        break;
      case "result":
        pendingTranscriptions.get(message.id)?.resolve({ text: message.text, reloaded: message.reloaded });
        pendingTranscriptions.delete(message.id);
        break;
      case "transcribeError":
        pendingTranscriptions.get(message.id)?.reject(new Error(message.message));
        pendingTranscriptions.delete(message.id);
        break;
    }
  };
  return worker;
}

function post(request: WorkerRequest, transfer: Transferable[] = []) {
  getWorker().postMessage(request, transfer);
}

/**
 * Downloads the model on first use, then loads it from the browser's cache. `onProgress`
 * follows the download (bytes so far, of the total). Loading another size replaces it.
 */
export function loadWhisper(size: WhisperSize, onProgress?: ProgressListener): Promise<DownloadedModel> {
  if (onProgress) progressListeners.add(onProgress);
  const unsubscribe = () => onProgress && progressListeners.delete(onProgress);

  if (!loading || loading.size !== size) {
    const promise = (loading?.promise.catch(() => undefined) ?? Promise.resolve()).then(
      () =>
        new Promise<DownloadedModel>((resolve, reject) => {
          settleLoad = { resolve, reject };
          ready = null;
          post({ type: "load", size });
        }),
    );
    loading = { size, promise };
    // A failed load can be tried again.
    promise.catch(() => {
      if (loading?.promise === promise) loading = null;
    });
  }
  const promise = loading.promise;
  promise.then(unsubscribe, unsubscribe);
  return promise;
}

/** Starts loading in the background (from the cache), so a message doesn't wait on it. */
export function warmUpWhisper(size: WhisperSize): void {
  loadWhisper(size).catch(() => undefined);
}

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    return audioBuffer.getChannelData(0).slice();
  } finally {
    await audioContext.close();
  }
}

export interface OnDeviceResult {
  text: string;
  backend: WhisperBackend;
  audioSeconds: number;
  ms: number;
  reloaded: boolean; // the GPU had been lost and the model was loaded again first
}

/** Throws on failure, so the caller can send the clip to Groq instead. */
export async function transcribeOnDevice(blob: Blob, size: WhisperSize): Promise<OnDeviceResult> {
  const started = performance.now();
  const audio = await decodeToMono16k(blob);
  const audioSeconds = audio.length / SAMPLE_RATE;
  await loadWhisper(size);
  const id = nextId++;
  const { text, reloaded } = await new Promise<{ text: string; reloaded: boolean }>((resolve, reject) => {
    pendingTranscriptions.set(id, { resolve, reject });
    post({ type: "transcribe", id, audio }, [audio.buffer]);
  });
  if (looksLikeHallucination(text)) throw new NoSpeechError();
  // Read after the run: a reload can land on another backend.
  const backend = ready?.backend ?? "wasm";
  return { text, backend, audioSeconds, ms: Math.round(performance.now() - started), reloaded };
}

/** Whisper heard nothing: not a failure to hand to Groq, just nothing to send. */
export class NoSpeechError extends Error {
  constructor() {
    super(NO_SPEECH_MESSAGE);
  }
}

/** Frees the phone's storage: the downloaded models and the runtime go, and Groq takes over. */
export async function deleteWhisperDownloads(): Promise<void> {
  worker?.terminate();
  worker = null;
  loading = null;
  ready = null;
  settleLoad?.reject(new Error("Stopped."));
  settleLoad = null;
  pendingTranscriptions.forEach(({ reject }) => reject(new Error("Stopped.")));
  pendingTranscriptions.clear();
  if ("caches" in window) await caches.delete("transformers-cache");
  forgetDownloads();
}
