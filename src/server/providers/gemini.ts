import type { AgentHistoryMessage, ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiResponse {
  candidates: Array<{ content: { parts: GeminiPart[] } }>;
}

interface GeminiOutgoingContent {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: { result: string } } }
  >;
}

// Gemini has no id in its tool-call format at all — a call and its result
// are correlated purely by function name/position, unlike Groq's/
// Anthropic's id-keyed pairing. AgentHistoryMessage's toolCall.id /
// toolCallId still exist (used to build the paired history entries
// upstream) but are simply not part of the wire payload here.
//
// TODO(verify before relying on this in production): the function-response
// turn's `role` is inconsistent across Gemini's docs/API versions ("user"
// vs "function"). Using "user" here per the REST examples at the time of
// writing — confirm against a live call with a real key before treating
// this as settled, and adjust if the API rejects it.
function toGeminiMessages(history: AgentHistoryMessage[]): GeminiOutgoingContent[] {
  return history.map((message) => {
    if (message.role === "user") {
      return { role: "user", parts: [{ text: message.content }] };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        parts: [{ functionResponse: { name: message.toolName, response: { result: message.result } } }],
      };
    }
    const parts: GeminiOutgoingContent["parts"] = [];
    if (message.content) parts.push({ text: message.content });
    if (message.toolCall) {
      parts.push({ functionCall: { name: message.toolCall.name, args: message.toolCall.input } });
    }
    return { role: "model", parts };
  });
}

// Documented fallback free tier alongside Groq. "-latest" alias avoids
// having to track Gemini's fast-moving version numbers here.
const geminiAdapter: ProviderAdapter = {
  defaultModel: "gemini-flash-latest",

  async send({ messages, tools, systemPrompt, apiKey, model, signal }: ProviderCallArgs): Promise<ProviderResult> {
    const chosenModel = model ?? geminiAdapter.defaultModel;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: toGeminiMessages(messages),
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
        }),
      },
    );

    if (!res.ok) throw new ProviderRequestError(res.status, await res.text());

    const result = (await res.json()) as GeminiResponse;
    const parts = result.candidates[0]?.content?.parts ?? [];
    const functionCallPart = parts.find((part) => part.functionCall);
    const text = parts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("\n");

    return {
      reply: text || undefined,
      toolCall: functionCallPart?.functionCall
        ? { name: functionCallPart.functionCall.name, input: functionCallPart.functionCall.args }
        : undefined,
    };
  },
};

export default geminiAdapter;
