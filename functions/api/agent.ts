// Cloudflare Pages Function. Holds the shared trial provider's key
// server-side and proxies chat turns to it (or to a user's own BYOK
// provider/key, passed through per-request, never persisted) — the browser
// never sees the shared secret. See CLAUDE.md's "Cost model / provider
// strategy". Actual logic lives in src/server/handleAgentRequest.ts, shared
// with the local Vite dev path.
import { handleAgentRequest, type AgentEnv, type Byok } from "../../src/server/handleAgentRequest.ts";
import type { IncomingMessage } from "../../src/server/providers/types.ts";

export const onRequestPost: PagesFunction<AgentEnv> = async (context) => {
  let messages: IncomingMessage[];
  let byok: Byok | undefined;
  try {
    const body = (await context.request.json()) as { messages: IncomingMessage[]; byok?: Byok };
    messages = body.messages;
    byok = body.byok;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const result = await handleAgentRequest(messages, context.env, byok);
  return jsonResponse(result.body, result.status);
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
