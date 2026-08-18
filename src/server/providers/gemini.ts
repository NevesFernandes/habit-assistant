import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiResponse {
  candidates: Array<{ content: { parts: GeminiPart[] } }>;
}

// Documented fallback free tier alongside Groq. "-latest" alias avoids
// having to track Gemini's fast-moving version numbers here.
const geminiAdapter: ProviderAdapter = {
  defaultModel: "gemini-flash-latest",

  async send({ messages, tools, systemPrompt, apiKey, model }: ProviderCallArgs): Promise<ProviderResult> {
    const chosenModel = model ?? geminiAdapter.defaultModel;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
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

    if (!res.ok) throw new ProviderRequestError(502, await res.text());

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
