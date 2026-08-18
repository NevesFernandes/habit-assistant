import type { ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

const anthropicAdapter: ProviderAdapter = {
  defaultModel: "claude-sonnet-5",

  async send({ messages, tools, systemPrompt, apiKey, model }: ProviderCallArgs): Promise<ProviderResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model ?? anthropicAdapter.defaultModel,
        max_tokens: 1024,
        system: systemPrompt,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        messages,
      }),
    });

    if (!res.ok) throw new ProviderRequestError(502, await res.text());

    const result = (await res.json()) as { content: AnthropicContentBlock[] };
    const toolUse = result.content.find(
      (block): block is AnthropicToolUseBlock => block.type === "tool_use",
    );
    const text = result.content
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return {
      reply: text || undefined,
      toolCall: toolUse ? { name: toolUse.name, input: toolUse.input } : undefined,
    };
  },
};

export default anthropicAdapter;
