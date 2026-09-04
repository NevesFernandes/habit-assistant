import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";
import { sendOpenAiCompatible } from "./openaiCompatible.ts";

// Free, no-credit-card tier with tool-calling support — used as an
// opportunistic secondary in the shared trial's failover chain (see
// handleAgentRequest.ts), behind Gemini as the durable primary. OpenAI-
// compatible Chat Completions API — the request/response mechanics live in
// openaiCompatible.ts (shared with workersAI.ts, §26 in Roadmap.md); this
// file only holds what's actually Groq-specific: the model pick and the
// tool_use_failed quirk below.
//
// Model IDs on Groq's free tier shift over time (verify against
// https://api.groq.com/openai/v1/models with a real key if this ever 404s
// as "model_not_found" — llama-3.3-70b-versatile, this app's first pick to
// fix the TPM problem below, disappeared from the catalog entirely between
// 2026-09-03 and 2026-09-04). openai/gpt-oss-120b is the current pick over
// the smaller -20b: same free-tier TPM ceiling as -20b (see below, so no
// worse for the problem this app actually has), but a meaningfully more
// capable model for BYOK callers or anyone on a paid Groq tier where TPM
// isn't the constraint.
//
// IMPORTANT — verified 2026-09-04 against the real API: on this account's
// free tier, *every* current Groq model with tool-calling support hard-
// rejects this app's full ~17-tool request. gpt-oss-20b/120b cap at 8,000
// TPM; qwen3.6-27b/qwen3.8-27b cap at 7,000 ITPM. The payload itself is
// ~8,670-10,550 tokens depending on the model's own tokenizer — bigger than
// every one of those ceilings. §24 (closed 2026-09-04) narrowed the
// per-request payload for confidently-classified messages, which should
// help, but this needs re-verification against Groq's real tokenizer before
// Groq is enabled as the shared trial's fallback tier again — see §26 in
// Roadmap.md.
//
// That smaller/free model is measurably unreliable on ambiguous or
// corrective turns: reproduced directly against the real API, its own
// reasoning trace correctly concluded "ask a clarifying question" and then
// called the tool anyway — sometimes with a malformed/incomplete arguments
// object. Groq's API validates tool-call arguments server-side and hard-
// rejects those (code: "tool_use_failed") rather than passing along
// whatever the model generated for us to handle. Treat that specific
// failure as "no valid tool call" (a clarifying reply) rather than letting
// it surface as a raw provider error.
const TOOL_USE_FAILED_MESSAGE = "Sorry, I didn't quite catch that — could you rephrase what you'd like me to do?";

function isToolUseFailedError(errorText: string): boolean {
  try {
    const parsed = JSON.parse(errorText) as { error?: { code?: string } };
    return parsed.error?.code === "tool_use_failed";
  } catch {
    return false;
  }
}

const groqAdapter: ProviderAdapter = {
  defaultModel: "openai/gpt-oss-120b",

  async send(args: ProviderCallArgs): Promise<ProviderResult> {
    try {
      return await sendOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        { Authorization: `Bearer ${args.apiKey}` },
        args,
        groqAdapter.defaultModel,
      );
    } catch (err) {
      if (err instanceof ProviderRequestError && isToolUseFailedError(err.message)) {
        return { reply: TOOL_USE_FAILED_MESSAGE };
      }
      throw err;
    }
  },
};

export default groqAdapter;
