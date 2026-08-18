// Posts a recorded audio clip to /api/transcribe. Never talks to Groq
// directly — same "key stays server-side" pattern as agentClient.ts.

export async function transcribeAudio(audio: Blob, apiKey?: string | null): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "voice");
  if (apiKey) form.append("apiKey", apiKey);

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  const body = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Transcription failed (${res.status}).`);
  }
  return body.text ?? "";
}
