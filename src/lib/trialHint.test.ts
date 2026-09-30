// §40 in Roadmap.md: when the shared free trial's models are unavailable, the chat's
// error reply nudges the user toward their own key — but only on the shared trial, and
// only for "unavailable" failures (rate limit, overload, timeout), not a bad request.
// Plain-assert style, run under tsx.
// Run: npm run test:trialHint
import assert from "node:assert/strict";
import { ChatSession, SHARED_TRIAL_UNAVAILABLE_HINT } from "./chatEngine.ts";
import { AgentRequestError } from "./agentClient.ts";
import type { AppData } from "../types/models.ts";

const data = { habits: [], recurringTasks: [], singleTasks: [], categories: [], completionLog: [] } as unknown as AppData;

async function lastReply(error: unknown, usingSharedTrial: boolean): Promise<string> {
  const session = new ChatSession({
    getData: () => data,
    persist: async () => true,
    callAgent: async () => {
      throw error;
    },
    todayISO: () => "2026-09-30",
    usingSharedTrial: () => usingSharedTrial,
  });
  await session.send("add a habit to read");
  const last = session.messages[session.messages.length - 1];
  assert.ok(last.role === "assistant" && "content" in last);
  return last.content as string;
}

const overloaded = () => new AgentRequestError("The assistant provider had a problem answering. Please try again in a moment.", undefined, 503);

// Shared trial + unavailable → original message, then the hint.
for (const status of [429, 500, 502, 503]) {
  const reply = await lastReply(new AgentRequestError("provider trouble", undefined, status), true);
  assert.ok(reply.startsWith("provider trouble"), `keeps the original message (${status})`);
  assert.ok(reply.includes(SHARED_TRIAL_UNAVAILABLE_HINT), `hint on ${status}`);
}
const timeout = new Error("The operation timed out.");
timeout.name = "TimeoutError";
assert.ok((await lastReply(timeout, true)).includes(SHARED_TRIAL_UNAVAILABLE_HINT), "hint on a client timeout");

// Own key → no hint (the user already did what it would suggest).
assert.ok(!(await lastReply(overloaded(), false)).includes(SHARED_TRIAL_UNAVAILABLE_HINT), "no hint with BYOK");

// Not an availability problem → no hint.
assert.ok(!(await lastReply(new AgentRequestError("Expected a non-empty `messages` array.", undefined, 400), true)).includes(SHARED_TRIAL_UNAVAILABLE_HINT), "no hint on 400");
assert.ok(!(await lastReply(new TypeError("Failed to fetch"), true)).includes(SHARED_TRIAL_UNAVAILABLE_HINT), "no hint when offline");

console.log("trialHint: all assertions passed");
