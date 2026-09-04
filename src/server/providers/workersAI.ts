import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { sendOpenAiCompatible } from "./openaiCompatible.ts";

// Cloudflare Workers AI, called via its OpenAI-compatible REST endpoint
// rather than the native `AI` binding (`env.AI.run(...)`) — see §26 in
// Roadmap.md for why: this codebase can't exercise a binding-based call in
// this sandboxed dev environment (`wrangler dev` doesn't run here — see
// README.md's "Local dev note"), and handleAgentRequest.ts is deliberately
// runtime-agnostic (plain data in, plain data out) so the same code path
// works in both the real Worker and the local Vite dev middleware. REST
// keeps this adapter the same shape as the other three. The tradeoff:
// needs both an API token (apiKey) and an account id (accountId) — every
// other provider here only needs one secret.
//
// Verified live 2026-09-05 against the real API (see Claude's memory, "§26
// Workers AI adapter"): response/error shape matches OpenAI's Chat
// Completions shape closely enough to reuse sendOpenAiCompatible unchanged.
// `message.content` holds a clean reply — the model's visible
// chain-of-thought lives in separate `reasoning`/`reasoning_content`
// fields, never inside `content`, so there's no leakage into what the user
// sees. `tool_calls` comes back as `[]` (not missing) when no tool is
// called. Non-2xx error bodies use Cloudflare's own envelope
// (`{success:false,errors:[{code,message}]}`), not OpenAI's `{error:{...}}`
// shape, but sendOpenAiCompatible only needs the raw status + body text, so
// this needs no special-casing here (unlike groq.ts's tool_use_failed
// handling).
//
// Last-resort tier only (§26): opportunistic third fallback behind
// Gemini/Groq in the shared trial's chain (handleAgentRequest.ts), not
// BYOK-exposed. Real headroom is small — live-tested 2026-09-03 at
// ~62-78 neurons/request, ~145 requests/day on this account's free
// allocation — and latency is variable (3.1s-16.6s observed), which is why
// handleAgentRequest.ts gives this tier a longer per-attempt timeout than
// the default.
const workersAIAdapter: ProviderAdapter = {
  defaultModel: "@cf/zai-org/glm-4.7-flash",

  async send(args: ProviderCallArgs): Promise<ProviderResult> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/ai/v1/chat/completions`;
    return sendOpenAiCompatible(url, { Authorization: `Bearer ${args.apiKey}` }, args, workersAIAdapter.defaultModel);
  },
};

export default workersAIAdapter;
