// Shared transcription logic, mirroring handleAgentRequest.ts's pattern —
// used by both the real Worker entry point (worker.ts) and the local
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
const TOO_SHORT_MESSAGE = "Audio too short — please keep the button pressed while you speak.";
const NO_SPEECH_MESSAGE = "No speech detected — please try again.";

// Whisper is known to hallucinate these stock phrases (among a handful of
// others) for silent/near-silent audio rather than returning empty text —
// confirmed by testing: 1.2s of pure silence came back as "Thank you.",
// with the API's own confidence signals (no_speech_prob, avg_logprob) not
// flagging it either. This is a stopgap phrase-list mitigation; the more
// thorough fix (client-side silence detection before ever calling the API)
// is tracked separately — see CLAUDE.md's "Voice input" section.
const HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "please subscribe to my channel",
  "like and subscribe",
  "bye",
  "bye bye",
  "goodbye",
  "see you next time",
  "you",
]);

function looksLikeHallucination(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
  return normalized.length === 0 || HALLUCINATION_PHRASES.has(normalized);
}

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
    const errorText = await res.text();
    if (errorText.includes("too short")) {
      return { status: 400, body: { error: TOO_SHORT_MESSAGE } };
    }
    return { status: 502, body: { error: errorText } };
  }

  const result = (await res.json()) as { text?: string };
  const text = result.text ?? "";
  if (looksLikeHallucination(text)) {
    return { status: 400, body: { error: NO_SPEECH_MESSAGE } };
  }
  return { status: 200, body: { text } };
}
