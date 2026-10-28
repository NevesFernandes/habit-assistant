// Whisper is known to hallucinate these stock phrases (among a handful of
// others) for silent/near-silent audio rather than returning empty text —
// confirmed by testing: 1.2s of pure silence came back as "Thank you.",
// with the API's own confidence signals (no_speech_prob, avg_logprob) not
// flagging it either. A backstop behind the client-side silence detection
// (voiceActivityDetection.ts), shared by the Groq path
// (handleTranscribeRequest.ts) and the on-device one (§46, onDeviceWhisper.ts),
// since a smaller Whisper on the phone hallucinates the same way.
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

export function looksLikeHallucination(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
  return normalized.length === 0 || HALLUCINATION_PHRASES.has(normalized);
}
