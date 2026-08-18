import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface GroqToolCall {
  function: { name: string; arguments: string };
}

interface GroqResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: GroqToolCall[] };
  }>;
}

// Free, no-credit-card tier with tool-calling support — the default for the
// shared trial. OpenAI-compatible Chat Completions API.
const groqAdapter: ProviderAdapter = {
  defaultModel: "llama-3.3-70b-versatile",

  async send({ messages, tools, systemPrompt, apiKey, model }: ProviderCallArgs): Promise<ProviderResult> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? groqAdapter.defaultModel,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
    });

    if (!res.ok) throw new ProviderRequestError(502, await res.text());

    const result = (await res.json()) as GroqResponse;
    const message = result.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];

    return {
      reply: message?.content ?? undefined,
      toolCall: toolCall
        ? { name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments) }
        : undefined,
    };
  },
};

export default groqAdapter;
