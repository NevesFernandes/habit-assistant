import type { AgentHistoryMessage, ProviderAdapter, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

// Anthropic content-block history: a tool call is a `tool_use` block on an
// assistant turn; its result is a `tool_result` block, but — unlike Groq's
// separate role:"tool" — Anthropic requires that block inside the *next
// user*-role turn. There is no role:"tool" at all in this API.
type AnthropicUserBlock = { type: "text"; text: string } | { type: "tool_result"; tool_use_id: string; content: string };
type AnthropicAssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type AnthropicOutgoingMessage =
  | { role: "user"; content: AnthropicUserBlock[] }
  | { role: "assistant"; content: AnthropicAssistantBlock[] };

function toAnthropicMessages(history: AgentHistoryMessage[]): AnthropicOutgoingMessage[] {
  return history.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: [{ type: "text", text: message.content }] };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.result }],
      };
    }
    const content: AnthropicAssistantBlock[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    if (message.toolCall) {
      content.push({
        type: "tool_use",
        id: message.toolCall.id,
        name: message.toolCall.name,
        input: message.toolCall.input,
      });
    }
    return { role: "assistant", content };
  });
}

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
        messages: toAnthropicMessages(messages),
      }),
    });

    if (!res.ok) throw new ProviderRequestError(res.status, await res.text());

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
      toolCall: toolUse ? { id: toolUse.id, name: toolUse.name, input: toolUse.input } : undefined,
    };
  },
};

export default anthropicAdapter;
