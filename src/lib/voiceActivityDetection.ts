// Client-side speech detection before a recording is ever sent to Whisper.
// Silero VAD (via @ricky0123/vad-web) is a small, purpose-built model — it
// only answers "was there speech," it doesn't transcribe anything. See
// CLAUDE.md's "Voice input" section for why this exists (Whisper hallucinates
// stock phrases like "Thank you." on silent audio) and the size trade-off
// (~15MB one-time download for the ONNX model + WASM runtime, cached by the
// service worker after first use).
import type { NonRealTimeVAD } from "@ricky0123/vad-web";

let vadPromise: Promise<NonRealTimeVAD> | null = null;

function getVad(): Promise<NonRealTimeVAD> {
  if (!vadPromise) {
    // Dynamic import so onnxruntime-web's JS wrapper is split into its own
    // chunk, fetched only on first recording rather than on every page load
    // — see Roadmap.md §11.
    vadPromise = import("@ricky0123/vad-web").then(({ NonRealTimeVAD }) =>
      NonRealTimeVAD.new({
        // Self-hosted (public/ort/) rather than the library's default CDN
        // fetch, consistent with this project's "don't depend on third-party
        // runtime fetches" pattern (see the Drive-storage and API-key-proxy
        // decisions in CLAUDE.md). Only the plain WASM execution provider is
        // shipped — we don't need WebGPU (ort.env.wasm.wasmPaths) for a model
        // this small.
        ortConfig: (ort) => {
          ort.env.wasm.wasmPaths = "/ort/";
        },
      }),
    );
  }
  return vadPromise;
}

/**
 * Fails open: if the model can't load or the audio can't be decoded for any
 * reason, this returns `true` (treat as "maybe speech") rather than silently
 * blocking voice input. The server-side hallucination-phrase filter
 * (handleTranscribeRequest.ts) remains as a backstop either way.
 */
export async function hasSpeech(blob: Blob): Promise<boolean> {
  try {
    const vad = await getVad();
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const samples = audioBuffer.getChannelData(0);

    for await (const _segment of vad.run(samples, audioBuffer.sampleRate)) {
      await audioContext.close();
      return true;
    }
    await audioContext.close();
    return false;
  } catch (err) {
    console.warn("Voice activity detection failed, letting the recording through:", err);
    return true;
  }
}
