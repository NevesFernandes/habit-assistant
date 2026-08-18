// Cloudflare Pages Function. Holds ANTHROPIC_API_KEY server-side and proxies
// chat turns to Anthropic — the browser never sees the key. See the
// "API key security" decision in CLAUDE.md. Actual logic lives in
// src/server/handleAgentRequest.ts, shared with the local Vite dev path.
import { handleAgentRequest, type AgentEnv, type IncomingMessage } from "../../src/server/handleAgentRequest";

export const onRequestPost: PagesFunction<AgentEnv> = async (context) => {
  let messages: IncomingMessage[];
  try {
    const body = (await context.request.json()) as { messages: IncomingMessage[] };
    messages = body.messages;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const result = await handleAgentRequest(messages, context.env);
  return jsonResponse(result.body, result.status);
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
