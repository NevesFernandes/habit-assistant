// Shared transcription logic, mirroring handleAgentRequest.ts's pattern —
// used by both functions/api/transcribe.ts (real deployment) and the local
// Vite dev middleware (vite.config.ts). Groq is the only viable free
// speech-to-text option today, so unlike the chat agent this doesn't need a
// multi-provider abstraction — just a direct call to Groq's Whisper
// endpoint. See CLAUDE.md's "Voice input" section.

export interface TranscribeEnv {
  STT_TRIAL_API_KEY?: string;
}

export interface TranscribeResult {
  status: number;
  body: { text?: string; error?: string };
}

const WHISPER_MODEL = "whisper-large-v3-turbo";

export async function handleTranscribeRequest(
  audio: Blob,
  mimeType: string,
  env: TranscribeEnv,
  byokApiKey?: string,
): Promise<TranscribeResult> {
  const apiKey = byokApiKey ?? env.STT_TRIAL_API_KEY;
  if (!apiKey) {
    return { status: 500, body: { error: "No Groq API key available for transcription." } };
  }
  if (audio.size === 0) {
    return { status: 400, body: { error: "Empty audio." } };
  }

  const extension = mimeType.includes("mp4") ? "m4a" : "webm";
  const form = new FormData();
  form.append("file", audio, `voice.${extension}`);
  form.append("model", WHISPER_MODEL);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    return { status: 502, body: { error: await res.text() } };
  }

  const result = (await res.json()) as { text?: string };
  return { status: 200, body: { text: result.text ?? "" } };
}
