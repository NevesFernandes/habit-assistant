// §46: runs Whisper off the main thread, so the chat stays responsive while a clip is
// transcribed. Started and spoken to only by onDeviceWhisper.ts.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WhisperBackend, WhisperSize } from "./onDeviceSttStore";

export type WorkerRequest =
  | { type: "load"; size: WhisperSize }
  | { type: "transcribe"; id: number; audio: Float32Array };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; size: WhisperSize; backend: WhisperBackend; bytes: number; loadMs: number }
  | { type: "loadError"; size: WhisperSize; message: string }
  | { type: "result"; id: number; text: string }
  | { type: "transcribeError"; id: number; message: string };

// English-only models, by the owner's choice: more accurate for English than the
// multilingual ones of the same size. Fetched from the Hugging Face CDN once, then
// read from the browser's cache ("transformers-cache").
const MODEL_IDS: Record<WhisperSize, string> = {
  tiny: "onnx-community/whisper-tiny.en",
  base: "onnx-community/whisper-base.en",
};

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let loaded: { size: WhisperSize; asr: AutomaticSpeechRecognitionPipeline } | null = null;

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function load(size: WhisperSize) {
  if (loaded?.size === size) return;
  await loaded?.asr.dispose();
  loaded = null;

  const started = performance.now();
  // Bytes per file, so the progress bar covers the whole model, not one file at a time.
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== "progress" || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let sumLoaded = 0;
    let sumTotal = 0;
    for (const file of files.values()) {
      sumLoaded += file.loaded;
      sumTotal += file.total;
    }
    scope.postMessage({ type: "progress", loaded: sumLoaded, total: sumTotal });
  };

  // WebGPU where the phone has it (the recommended mix for Whisper there: a full-precision
  // encoder, a 4-bit decoder); otherwise WASM on the CPU with 8-bit weights.
  let backend: WhisperBackend = (await hasWebGpu()) ? "webgpu" : "wasm";
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    asr = await createPipeline(size, backend, progress_callback);
  } catch (err) {
    if (backend === "wasm") throw err;
    console.warn("Whisper on WebGPU failed, trying WASM:", err);
    backend = "wasm";
    files.clear();
    asr = await createPipeline(size, backend, progress_callback);
  }
  loaded = { size, asr };

  let bytes = 0;
  for (const file of files.values()) bytes += file.total;
  scope.postMessage({ type: "ready", size, backend, bytes, loadMs: Math.round(performance.now() - started) });
}

function createPipeline(
  size: WhisperSize,
  backend: WhisperBackend,
  progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  return pipeline("automatic-speech-recognition", MODEL_IDS[size], {
    device: backend,
    dtype: backend === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback,
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
}

scope.onmessage = async (event) => {
  const request = event.data;
  if (request.type === "load") {
    try {
      await load(request.size);
    } catch (err) {
      scope.postMessage({ type: "loadError", size: request.size, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  try {
    if (!loaded) throw new Error("No model loaded.");
    // Whisper reads 30 seconds at a time; a locked recording (§45) can run longer.
    const long = request.audio.length > 30 * 16000;
    const output = await loaded.asr(request.audio, long ? { chunk_length_s: 30, stride_length_s: 5 } : {});
    const text = Array.isArray(output) ? output.map((part) => part.text).join(" ") : output.text;
    scope.postMessage({ type: "result", id: request.id, text: text.trim() });
  } catch (err) {
    scope.postMessage({ type: "transcribeError", id: request.id, message: err instanceof Error ? err.message : String(err) });
  }
};
