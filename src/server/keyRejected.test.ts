// §48: a provider rejecting the shared trial's own key is an outage of that tier (fail over,
// else answer 503 so the chat shows its add-your-own-key hint); a rejected own key is said
// plainly. Drives handleAgentRequest with fetch stubbed, so no provider is called.
// Plain-assert style, same pattern as classifyIntent.test.ts.
// Run: node src/server/keyRejected.test.ts
import assert from "node:assert/strict";
import { handleAgentRequest } from "./handleAgentRequest.ts";
import { GENERIC_PROVIDER_ERROR } from "./providerErrorMessage.ts";
import type { AgentHistoryMessage } from "./agentHistory.ts";

const GEMINI_KEY_INVALID =
  '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}';
const GROQ_KEY_INVALID = '{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}';
const GROQ_OK = JSON.stringify({ choices: [{ message: { content: "Hello from the fallback." } }] });

const messages: AgentHistoryMessage[] = [{ role: "user", content: "add a habit to read" }];

type Answer = { status: number; body: string };

/** Stubs fetch per provider host and returns the hosts called, in order. */
function stubFetch(answers: { gemini?: Answer; groq?: Answer }): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const provider = String(input).includes("groq.com") ? "groq" : "gemini";
    calls.push(provider);
    const answer = answers[provider];
    assert.ok(answer, `unexpected call to ${provider}`);
    return new Response(answer.body, { status: answer.status });
  }) as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
console.error = () => {}; // the handler logs every failure; keep the test output readable
try {
  // Shared trial, one tier, key rejected: 503 with the generic text, and no retry.
  let calls = stubFetch({ gemini: { status: 400, body: GEMINI_KEY_INVALID } });
  let result = await handleAgentRequest(messages, { TRIAL_PROVIDER: "gemini", TRIAL_API_KEY: "bad" });
  assert.equal(result.status, 503);
  assert.equal(result.body.error, GENERIC_PROVIDER_ERROR);
  assert.deepEqual(calls, ["gemini"]);
  // The debug log still shows the real cause.
  assert.match((result.body.debug?.result as { error: string }).error, /API_KEY_INVALID/);

  // Shared trial, primary's key rejected, fallback healthy: the fallback answers.
  calls = stubFetch({ gemini: { status: 400, body: GEMINI_KEY_INVALID }, groq: { status: 200, body: GROQ_OK } });
  result = await handleAgentRequest(messages, {
    TRIAL_PROVIDER: "gemini",
    TRIAL_API_KEY: "bad",
    TRIAL_FALLBACK_PROVIDER: "groq",
    TRIAL_FALLBACK_API_KEY: "good",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, "Hello from the fallback.");
  assert.deepEqual(calls, ["gemini", "groq"]);

  // Shared trial, every tier's key rejected: still 503.
  calls = stubFetch({ gemini: { status: 400, body: GEMINI_KEY_INVALID }, groq: { status: 401, body: GROQ_KEY_INVALID } });
  result = await handleAgentRequest(messages, {
    TRIAL_PROVIDER: "gemini",
    TRIAL_API_KEY: "bad",
    TRIAL_FALLBACK_PROVIDER: "groq",
    TRIAL_FALLBACK_API_KEY: "bad",
  });
  assert.equal(result.status, 503);
  assert.deepEqual(calls, ["gemini", "groq"]);

  // Shared trial, an ordinary bad request: unchanged — 400, no failover.
  calls = stubFetch({ gemini: { status: 400, body: '{"error":{"message":"Invalid JSON payload"}}' } });
  result = await handleAgentRequest(messages, {
    TRIAL_PROVIDER: "gemini",
    TRIAL_API_KEY: "good",
    TRIAL_FALLBACK_PROVIDER: "groq",
    TRIAL_FALLBACK_API_KEY: "good",
  });
  assert.equal(result.status, 400);
  assert.deepEqual(calls, ["gemini"]);

  // Own key rejected: the provider's status, a plain message, no retry.
  calls = stubFetch({ groq: { status: 401, body: GROQ_KEY_INVALID } });
  result = await handleAgentRequest(messages, {}, { provider: "groq", apiKey: "bad" });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "Your Groq key was rejected. Check it in Settings (⚙).");
  assert.deepEqual(calls, ["groq"]);

  calls = stubFetch({ gemini: { status: 400, body: GEMINI_KEY_INVALID } });
  result = await handleAgentRequest(messages, {}, { provider: "gemini", apiKey: "bad" });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Your Gemini key was rejected. Check it in Settings (⚙).");
} finally {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
}

console.log("keyRejected.test.ts: all passed");
