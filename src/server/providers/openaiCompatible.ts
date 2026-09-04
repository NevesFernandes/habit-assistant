// Shared plumbing for any provider whose REST API follows OpenAI's Chat
// Completions shape — currently groq.ts and workersAI.ts (§26 in
// Roadmap.md). Provider-specific quirks (Groq's `tool_use_failed` handling,
// Workers AI's account-id-in-URL) stay in each adapter; this file only
// covers the shape both APIs actually share: request/response JSON and
// message-history conversion.
import type { AgentHistoryMessage, ProviderCallArgs, ProviderResult } from "./types.ts";
import { ProviderRequestError } from "./types.ts";

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAiChatResponse {
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
}

// A tool call lives as a `tool_calls` array on the assistant turn, and its
// result is a separate `role: "tool"` message keyed by `tool_call_id`.
type OpenAiOutgoingMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAiMessages(history: AgentHistoryMessage[]): OpenAiOutgoingMessage[] {
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

// Sends a Chat-Completions-shaped request to `url` and parses the (also
// OpenAI-shaped) response into this app's ProviderResult. A non-2xx
// response throws ProviderRequestError with the raw response body — the
// caller decides what to do with a provider-specific error shape (see
// groq.ts's tool_use_failed handling), since this helper doesn't know any
// one provider's error envelope.
export async function sendOpenAiCompatible(
  url: string,
  headers: Record<string, string>,
  args: ProviderCallArgs,
  defaultModel: string,
): Promise<ProviderResult> {
  const res = await fetch(url, {
    method: "POST",
    signal: args.signal,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: args.model ?? defaultModel,
      messages: [{ role: "system", content: args.systemPrompt }, ...toOpenAiMessages(args.messages)],
      tools: args.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    }),
  });

  if (!res.ok) {
    throw new ProviderRequestError(res.status, await res.text());
  }

  const result = (await res.json()) as OpenAiChatResponse;
  const message = result.choices[0]?.message;
  const toolCall = message?.tool_calls?.[0];

  return {
    reply: message?.content ?? undefined,
    toolCall: toolCall
      ? { id: toolCall.id, name: toolCall.function.name, input: JSON.parse(toolCall.function.arguments) }
      : undefined,
  };
}
