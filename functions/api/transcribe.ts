// Cloudflare Pages Function. Holds the shared trial's Groq key server-side
// (or forwards a BYOK key, never persisted) and proxies audio to Groq's
// Whisper endpoint — the browser never sees the key, and the audio itself
// is never written anywhere, just forwarded and discarded. See CLAUDE.md's
// "Voice input" section. Logic lives in src/server/handleTranscribeRequest.ts,
// shared with the local Vite dev path.
import { handleTranscribeRequest, type TranscribeEnv } from "../../src/server/handleTranscribeRequest.ts";

export const onRequestPost: PagesFunction<TranscribeEnv> = async (context) => {
  const form = await context.request.formData();
  const audio = form.get("audio");
  const apiKey = form.get("apiKey");

  if (!(audio instanceof Blob)) {
    return jsonResponse({ error: "Expected a multipart `audio` field." }, 400);
  }

  const result = await handleTranscribeRequest(
    audio,
    audio.type,
    context.env,
    typeof apiKey === "string" && apiKey ? apiKey : undefined,
  );
  return jsonResponse(result.body, result.status);
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
