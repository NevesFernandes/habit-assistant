// Posts a recorded audio clip to /api/transcribe. Never talks to Groq
// directly — same "key stays server-side" pattern as agentClient.ts.
import { fetchJson } from "./fetchJson";

export async function transcribeAudio(audio: Blob, apiKey?: string | null): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "voice");
  if (apiKey) form.append("apiKey", apiKey);

  const { ok, status, body } = await fetchJson<{ text?: string; error?: string }>("/api/transcribe", {
    method: "POST",
    body: form,
  });
  if (!ok) {
    throw new Error(body.error ?? `Transcription failed (${status}).`);
  }
  return body.text ?? "";
}
