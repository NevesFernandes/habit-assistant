import type { AgentHistoryMessage, ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface GroqToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface GroqResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: GroqToolCall[] };
  }>;
}

// OpenAI-style Chat Completions history: a tool call lives as a `tool_calls`
// array on the assistant turn, and its result is a separate `role: "tool"`
// message keyed by `tool_call_id`.
type GroqOutgoingMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

function toGroqMessages(history: AgentHistoryMessage[]): GroqOutgoingMessage[] {
  return history.map((message) => {
    if (message.role === "user") return { role: "user", content: message.content };
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.result };
    }
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.toolCall
        ? [
            {
              id: message.toolCall.id,
              type: "function",
              function: { name: message.toolCall.name, arguments: JSON.stringify(message.toolCall.input) },
            },
          ]
        : undefined,
    };
  });
}

// Free, no-credit-card tier with tool-calling support — used as an
// opportunistic secondary in the shared trial's failover chain (see
// handleAgentRequest.ts), behind Gemini as the durable primary. OpenAI-
// compatible Chat Completions API.
//
// If a second OpenAI-compatible provider (OpenAI itself, Together,
// Fireworks, Mistral, DeepSeek, ...) is ever added, toGroqMessages() below
// and this fetch call are good candidates to factor into a reusable
// openaiCompatibleAdapter(baseUrl, model) — not worth it for one provider.
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
// every one of those ceilings. This is not fixable by picking a different
// Groq model today; the actual fix is §24 in Roadmap.md (shrink the
// payload, not the model). Until then, Groq is not viable as the shared
// trial's *main* fallback tier (see handleAgentRequest.ts's failover
// chain) — it only actually helps the much smaller confirmPendingDeletion
// request (a single tool), not the general case.
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

  async send({ messages, tools, systemPrompt, apiKey, model, signal }: ProviderCallArgs): Promise<ProviderResult> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? groqAdapter.defaultModel,
        messages: [{ role: "system", content: systemPrompt }, ...toGroqMessages(messages)],
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (isToolUseFailedError(errorText)) {
        return { reply: TOOL_USE_FAILED_MESSAGE };
      }
      throw new ProviderRequestError(res.status, errorText);
    }

    const result = (await res.json()) as GroqResponse;
    const message = result.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];

    return {
      reply: message?.content ?? undefined,
      toolCall: toolCall
        ? { id: toolCall.id, name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments) }
        : undefined,
    };
  },
};

export default groqAdapter;
