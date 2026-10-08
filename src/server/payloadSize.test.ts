// §58 in Roadmap.md: a budget on the size of what is sent to the model. Groq's free tier
// rejects any single request above 8,000 tokens, and both §54 and §56 grew the payload
// without anything noticing. Each family alone must stay well under that, leaving room for
// the chat history and the reply; the first call of the too-large route must stay tiny.
// When this fails, shorten a rule or split a family — don't raise the number.
// Run: npm run test:payloadSize   (sizes: npm run measure:payload)
import assert from "node:assert/strict";
import {
  buildRouterPayload,
  buildSystemPrompt,
  buildTools,
  ESCAPE_TOOL_NAME,
  estimatePayloadTokens,
  FAMILIES,
} from "./handleAgentRequest.ts";
import { DEFAULT_CATEGORIES } from "../types/models.ts";

const TODAY = "2026-10-08";
const FAMILY_BUDGET = 5500; // estimated at 4 characters a token; Groq's own count is ~15% lower
const ROUTER_BUDGET = 1000;

for (const family of FAMILIES) {
  const tools = buildTools(DEFAULT_CATEGORIES, false, [family], { escapeHatch: true });
  const systemPrompt = buildSystemPrompt(DEFAULT_CATEGORIES, TODAY, [family], 0, { escapeHatch: true });
  const size = estimatePayloadTokens({ systemPrompt, tools });
  assert.ok(size <= FAMILY_BUDGET, `the "${family}" family is ${size} estimated tokens, over the ${FAMILY_BUDGET} budget`);
  // Every narrowed request can ask for other tools.
  assert.ok(tools.some((tool) => tool.name === ESCAPE_TOOL_NAME), `"${family}" has no escape tool`);
  assert.ok(tools.length > 1, `"${family}" has no tools of its own`);
}

const router = estimatePayloadTokens(buildRouterPayload(TODAY));
assert.ok(router <= ROUTER_BUDGET, `the router call is ${router} estimated tokens, over the ${ROUTER_BUDGET} budget`);

// The full list has no escape tool (there is nothing more to ask for), and every tool is in some family.
const all = buildTools(DEFAULT_CATEGORIES, false, "all");
assert.ok(!all.some((tool) => tool.name === ESCAPE_TOOL_NAME));
const inFamilies = new Set(FAMILIES.flatMap((family) => buildTools(DEFAULT_CATEGORIES, false, [family]).map((tool) => tool.name)));
for (const tool of all) assert.ok(inFamilies.has(tool.name), `${tool.name} is in no family, so a narrowed request can never reach it`);

console.log("payloadSize.test.ts: all passed");
