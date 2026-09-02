// Worker entry point for the real deployment (see wrangler.jsonc). Routes
// the two API paths to the same shared, runtime-agnostic handlers the local
// Vite dev middleware uses (vite.config.ts) — everything else falls through
// to the static assets binding, since a non-matching request always reaches
// this fetch handler (assets.directory serves matching files first).
import { handleAgentRequest, type AgentEnv, type Byok } from "./handleAgentRequest.ts";
import { handleTranscribeRequest, type TranscribeEnv } from "./handleTranscribeRequest.ts";
import type { AgentHistoryMessage } from "./agentHistory.ts";
import type { Category } from "../types/models.ts";

interface Env extends AgentEnv, TranscribeEnv {
  ASSETS: Fetcher;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleAgent(request: Request, env: Env): Promise<Response> {
  let messages: AgentHistoryMessage[];
  let byok: Byok | undefined;
  let categories: Category[] | undefined;
  let hasPendingConfirmation = false;
  try {
    const body = (await request.json()) as {
      messages: AgentHistoryMessage[];
      byok?: Byok;
      categories?: Category[];
      hasPendingConfirmation?: boolean;
    };
    messages = body.messages;
    byok = body.byok;
    categories = body.categories;
    hasPendingConfirmation = body.hasPendingConfirmation ?? false;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const result = await handleAgentRequest(messages, env, byok, categories, hasPendingConfirmation);
  return jsonResponse(result.body, result.status);
}

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const audio = form.get("audio");
  const apiKey = form.get("apiKey");

  if (!(audio instanceof Blob)) {
    return jsonResponse({ error: "Expected a multipart `audio` field." }, 400);
  }

  const result = await handleTranscribeRequest(
    audio,
    audio.type,
    env,
    typeof apiKey === "string" && apiKey ? apiKey : undefined,
  );
  return jsonResponse(result.body, result.status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/agent") {
      return handleAgent(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/transcribe") {
      return handleTranscribe(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
