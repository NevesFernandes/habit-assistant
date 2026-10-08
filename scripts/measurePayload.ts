// §58: how big the request to the model is, per tool family. Groq's free tier rejects any
// single request above 8,000 tokens, so this is the number to watch when a tool or a
// prompt rule is added. Sizes are estimates at 4 characters a token (Groq's own count
// came out about 15% lower on 2026-10-05), without the chat history.
//
//   npm run measure:payload
import {
  buildRouterPayload,
  buildSystemPrompt,
  buildTools,
  estimatePayloadTokens,
  FAMILIES,
} from "../src/server/handleAgentRequest.ts";
import type { IntentBucket } from "../src/server/classifyIntent.ts";
import { DEFAULT_CATEGORIES } from "../src/types/models.ts";

const TODAY = new Date().toISOString().slice(0, 10);
// As the server sends them: a narrowed request carries the escape tool, the full list doesn't.
const payloadFor = (families: IntentBucket[] | "all") => ({
  systemPrompt: buildSystemPrompt(DEFAULT_CATEGORIES, TODAY, families, 0, { escapeHatch: families !== "all" }),
  tools: buildTools(DEFAULT_CATEGORIES, false, families, { escapeHatch: families !== "all" }),
});
const routerPayload = () => buildRouterPayload(TODAY);

const row = (label: string, tokens: number) => console.log(`${label.padEnd(28)} ${String(tokens).padStart(6)}`);

console.log("Estimated tokens per request (system prompt + tool schemas)\n");
for (const family of FAMILIES) row(family, estimatePayloadTokens(payloadFor([family])));
console.log("");
for (const pair of [["delete", "edit"], ["edit", "progress"], ["progress", "checklist"], ["create", "edit"], ["delete", "checklist"]] as const) {
  row(pair.join(" + "), estimatePayloadTokens(payloadFor([...pair])));
}
console.log("");
row("router (choose families)", estimatePayloadTokens(routerPayload()));
row("full list", estimatePayloadTokens(payloadFor("all")));
