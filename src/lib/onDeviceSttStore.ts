// §46: on-device transcription (a trial). Device-local by design, like timerStore.ts:
// whether it's on, which model, what's been downloaded and how recent runs went all
// describe this phone, so none of it goes in the Drive file.

export type WhisperSize = "tiny" | "base";
export type WhisperBackend = "webgpu" | "wasm";

export interface DownloadedModel {
  backend: WhisperBackend;
  bytes: number; // what this download fetched; 0 when it all came from the cache
  loadMs: number;
}

/** One voice message, kept so the trial can be judged on real use. */
export interface OnDeviceRun {
  at: string; // ISO timestamp
  size: WhisperSize;
  backend?: WhisperBackend;
  audioSeconds: number;
  ms?: number; // time to text, decoding included
  error?: string; // set when it failed and the message went to Groq instead
}

interface OnDeviceSttState {
  enabled: boolean;
  size: WhisperSize;
  downloaded: Partial<Record<WhisperSize, DownloadedModel>>;
  runs: OnDeviceRun[];
}

const STORAGE_KEY = "habit-assistant:on-device-stt";
const MAX_RUNS = 10;

export function loadOnDeviceStt(): OnDeviceSttState {
  const fallback: OnDeviceSttState = { enabled: false, size: "base", downloaded: {}, runs: [] };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<OnDeviceSttState>) };
  } catch {
    return fallback;
  }
}

function save(state: OnDeviceSttState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setOnDeviceEnabled(enabled: boolean): void {
  save({ ...loadOnDeviceStt(), enabled });
}

export function setOnDeviceSize(size: WhisperSize): void {
  save({ ...loadOnDeviceStt(), size });
}

export function markDownloaded(size: WhisperSize, model: DownloadedModel): void {
  const state = loadOnDeviceStt();
  // A later load from the cache fetches nothing; keep the first download's size.
  const bytes = model.bytes || state.downloaded[size]?.bytes || 0;
  save({ ...state, downloaded: { ...state.downloaded, [size]: { ...model, bytes } } });
}

export function forgetDownloads(): void {
  save({ ...loadOnDeviceStt(), downloaded: {} });
}

export function recordRun(run: OnDeviceRun): void {
  const state = loadOnDeviceStt();
  save({ ...state, runs: [run, ...state.runs].slice(0, MAX_RUNS) });
}

/** The model to use for the next voice message, or null for Groq: on, and its model is on the phone. */
export function activeOnDeviceSize(): WhisperSize | null {
  const state = loadOnDeviceStt();
  return state.enabled && state.downloaded[state.size] ? state.size : null;
}
