// §51: plain assert-based check, same pattern as classifyIntent.test.ts.
// Run: node src/server/providerErrorMessage.test.ts
import assert from "node:assert/strict";
import { GENERIC_PROVIDER_ERROR, isKeyRejected, providerErrorMessage } from "./providerErrorMessage.ts";

const GROQ_TOO_LARGE =
  '{"error":{"message":"Request too large for model `openai/gpt-oss-120b` … on tokens per minute (TPM): Limit 8000, Requested 12828, please reduce your message size and try again.","type":"tokens","code":"rate_limit_exceeded"}}';
const GROQ_RATE_LIMIT = '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` … on tokens per minute (TPM): Limit 8000, Used 3891, Requested 4400."}}';

// Own Groq key, one request over the limit: say what happened and what to do.
const tooLarge = providerErrorMessage(413, GROQ_TOO_LARGE, "groq", true);
assert.match(tooLarge, /^That request was too large for Groq's free tier\./);
assert.match(tooLarge, /clear action word/);
assert.match(tooLarge, /switch in Settings/);
// Recognised by its text too, whatever status it arrives with.
assert.equal(providerErrorMessage(400, GROQ_TOO_LARGE, "groq", true), tooLarge);

// Another provider: no claim about a free tier, no pointer to Gemini.
const other = providerErrorMessage(413, "payload too big", "gemini", true);
assert.match(other, /^That request was too large for Gemini\. /);
assert.doesNotMatch(other, /free tier|Settings/);

// Own key, rate limited.
assert.equal(providerErrorMessage(429, GROQ_RATE_LIMIT, "groq", true), "Groq's rate limit was reached. Wait a minute and try again.");
assert.equal(providerErrorMessage(429, "", "someNewProvider", true), "The provider's rate limit was reached. Wait a minute and try again.");

// Anything else, and everything on the shared trial, keeps the generic text.
assert.equal(providerErrorMessage(500, "boom", "groq", true), GENERIC_PROVIDER_ERROR);
assert.equal(providerErrorMessage(400, "Invalid JSON payload", "gemini", true), GENERIC_PROVIDER_ERROR);
assert.equal(providerErrorMessage(413, GROQ_TOO_LARGE, "groq", false), GENERIC_PROVIDER_ERROR);
assert.equal(providerErrorMessage(429, GROQ_RATE_LIMIT, "groq", false), GENERIC_PROVIDER_ERROR);
assert.equal(providerErrorMessage(400, "API_KEY_INVALID", "gemini", false), GENERIC_PROVIDER_ERROR);

// §48: the key itself was refused. Gemini says so with a 400, the others with 401/403.
assert.ok(isKeyRejected(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'));
assert.ok(isKeyRejected(400, "API_KEY_INVALID"));
assert.ok(isKeyRejected(401, ""));
assert.ok(isKeyRejected(403, ""));
assert.ok(!isKeyRejected(400, "Invalid JSON payload"));
assert.ok(!isKeyRejected(429, GROQ_RATE_LIMIT));
assert.ok(!isKeyRejected(500, "API_KEY_INVALID"));

// Own key rejected: say so, and where to fix it.
assert.equal(providerErrorMessage(400, "API_KEY_INVALID", "gemini", true), "Your Gemini key was rejected. Check it in Settings (⚙).");
assert.equal(providerErrorMessage(401, "invalid_api_key", "groq", true), "Your Groq key was rejected. Check it in Settings (⚙).");
assert.equal(providerErrorMessage(401, "authentication_error", "anthropic", true), "Your Anthropic key was rejected. Check it in Settings (⚙).");
assert.equal(providerErrorMessage(403, "", "someNewProvider", true), "Your API key was rejected. Check it in Settings (⚙).");

// The raw provider text never leaks.
for (const message of [tooLarge, other]) assert.doesNotMatch(message, /TPM|gpt-oss|rate_limit_exceeded/);

console.log("providerErrorMessage.test.ts: all passed");
