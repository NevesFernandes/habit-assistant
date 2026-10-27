// §58 in Roadmap.md: what the server does around a model call, with a scripted stand-in
// for the provider — the escape tool on a narrowed request, and the two-step route when a
// provider rejects a request as too large. No network, no key.
// Run: npm run test:routing
import assert from "node:assert/strict";
import { ESCAPE_TOOL_NAME, handleAgentRequest, ROUTER_TOOL_NAME } from "./handleAgentRequest.ts";
import { ProviderRequestError, type ProviderAdapter, type ProviderCallArgs, type ProviderResult } from "./providers/types.ts";

type Step = (args: ProviderCallArgs) => ProviderResult;
const tooLarge: Step = () => {
  throw new ProviderRequestError(413, "Request too large for model: Limit 8000, Requested 12828");
};
const call = (name: string, input: Record<string, unknown> = {}): Step => () => ({ toolCall: { name, input } });

async function run(text: string, steps: Step[], fallback?: Step[]) {
  const seen: { provider: string; tools: string[] }[] = [];
  const scripted = (id: string, script: Step[]): ProviderAdapter => ({
    defaultModel: "scripted",
    async send(args) {
      seen.push({ provider: id, tools: args.tools.map((tool) => tool.name) });
      const step = script.shift();
      assert.ok(step, `${id} was called more often than scripted: ${JSON.stringify(seen)}`);
      return step(args);
    },
  });
  const adapters: Record<string, ProviderAdapter> = { groq: scripted("groq", steps), gemini: scripted("gemini", fallback ?? []) };
  const env = {
    TRIAL_PROVIDER: "groq",
    TRIAL_API_KEY: "k",
    ...(fallback ? { TRIAL_FALLBACK_PROVIDER: "gemini", TRIAL_FALLBACK_API_KEY: "k" } : {}),
  };
  const result = await handleAgentRequest([{ role: "user", content: text }], env, undefined, [], false, 0, undefined, {
    resolveProvider: (id) => adapters[id],
  });
  return { result, seen, left: steps.length + (fallback?.length ?? 0) };
}

// A classified message that works: one call, with the escape tool on offer.
{
  const { result, seen, left } = await run("pause my gym habit", [call("pauseHabit", { name: "gym" })]);
  assert.equal(result.body.toolCall?.name, "pauseHabit");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].tools.includes(ESCAPE_TOOL_NAME));
  assert.ok(seen[0].tools.includes("archiveHabit") && !seen[0].tools.includes("deleteHabits"), "§59: pause no longer brings the delete tools");
  assert.equal(result.body.debug?.bucket, "schedule");
  assert.equal(left, 0);
}

// The model says the narrowed tools don't fit, naming what it needs: one more call, with those tools.
{
  const { result, seen } = await run("pause my gym habit", [
    call(ESCAPE_TOOL_NAME, { families: ["edit"] }),
    call("updateHabit", { name: "gym", newEndDate: "2026-12-01" }),
  ]);
  assert.equal(result.body.toolCall?.name, "updateHabit");
  assert.equal(seen.length, 2);
  assert.ok(seen[1].tools.includes("updateHabit") && !seen[1].tools.includes("pauseHabit"));
  assert.ok(!seen[1].tools.includes(ESCAPE_TOOL_NAME), "no second escape");
  assert.equal(result.body.debug?.bucket, "schedule → asked:edit");
}

// ...naming nothing usable: the full list. And it can't escape twice.
{
  const { result, seen } = await run("pause my gym habit", [call(ESCAPE_TOOL_NAME, { families: ["everything"] }), call(ESCAPE_TOOL_NAME)]);
  assert.equal(seen.length, 2);
  assert.ok(seen[1].tools.includes("createHabit") && seen[1].tools.includes("deleteHabits"));
  assert.equal(result.status, 200);
  assert.equal(result.body.toolCall, undefined, "a helper tool is never handed to the app");
}

// An unclassified message that is too large: the model picks the families, then gets only those.
{
  const { result, seen, left } = await run("handle my stuff", [
    tooLarge,
    call(ROUTER_TOOL_NAME, { families: ["progress"] }),
    call("setHabitDone", { name: "stuff" }),
  ]);
  assert.equal(result.body.toolCall?.name, "setHabitDone");
  assert.deepEqual(seen[1].tools, [ROUTER_TOOL_NAME]);
  assert.ok(seen[2].tools.includes("setHabitDone") && !seen[2].tools.includes("createHabit"));
  assert.equal(result.body.debug?.bucket, "fallback:full → routed:progress");
  assert.equal(left, 0);
}

// The router may simply answer (a greeting needs no tools).
{
  const { result, seen } = await run("handle my stuff", [tooLarge, () => ({ reply: "Hi! What would you like to do?" })]);
  assert.equal(result.body.reply, "Hi! What would you like to do?");
  assert.equal(seen.length, 2);
}

// Still too large after routing, or a router answer that names nothing: the old outcome,
// once — the provider's 413 as an error reply, with no further routing.
{
  const stillTooLarge = await run("handle my stuff", [tooLarge, call(ROUTER_TOOL_NAME, { families: ["edit"] }), tooLarge]);
  assert.equal(stillTooLarge.result.status, 413);
  assert.ok(stillTooLarge.result.body.error, "answered as an error, in the provider-error wording");
  assert.equal(stillTooLarge.seen.length, 3);

  const nothingChosen = await run("handle my stuff", [tooLarge, call(ROUTER_TOOL_NAME, { families: [] })]);
  assert.equal(nothingChosen.result.status, 413);
  assert.equal(nothingChosen.seen.length, 2);
}

// With a next provider in the chain, a request that can't be routed moves on to it, as before.
{
  const { result, seen } = await run("handle my stuff", [tooLarge, call(ROUTER_TOOL_NAME, { families: ["edit"] }), tooLarge], [
    call("updateHabit", { name: "stuff", newName: "things" }),
  ]);
  assert.equal(result.body.toolCall?.name, "updateHabit");
  assert.deepEqual(seen.map((entry) => entry.provider), ["groq", "groq", "groq", "gemini"]);
  assert.ok(seen[3].tools.includes("createHabit"), "the next provider gets the original, full request");
}

// A narrowed request that is itself too large is routed too; an escape after that isn't offered.
{
  const { result, seen } = await run("pause my gym habit", [tooLarge, call(ROUTER_TOOL_NAME, { families: ["schedule"] }), call("pauseHabit", { name: "gym" })]);
  assert.equal(result.body.toolCall?.name, "pauseHabit");
  assert.ok(!seen[2].tools.includes(ESCAPE_TOOL_NAME));
}

// A pending yes/no confirmation is never routed or narrowed.
{
  const seen: string[][] = [];
  const adapter: ProviderAdapter = {
    defaultModel: "scripted",
    async send(args) {
      seen.push(args.tools.map((tool) => tool.name));
      throw new ProviderRequestError(413, "Request too large");
    },
  };
  const result = await handleAgentRequest([{ role: "user", content: "yes" }], { TRIAL_PROVIDER: "groq", TRIAL_API_KEY: "k" }, undefined, [], true, 0, undefined, {
    resolveProvider: () => adapter,
  });
  assert.equal(result.status, 413);
  assert.deepEqual(seen, [["confirmPendingAction"]]);
}

// §62: the model's "today" is the date the app sends (the device's local date); a missing
// or malformed one, from an older cached app, falls back to the server's UTC date.
{
  const promptFor = async (clientToday: string | undefined) => {
    let prompt = "";
    const adapter: ProviderAdapter = {
      defaultModel: "scripted",
      async send(args) {
        prompt = args.systemPrompt;
        return { reply: "ok" };
      },
    };
    await handleAgentRequest([{ role: "user", content: "pause my gym habit" }], { TRIAL_PROVIDER: "groq", TRIAL_API_KEY: "k" }, undefined, [], false, 0, clientToday, {
      resolveProvider: () => adapter,
    });
    return prompt;
  };
  assert.match(await promptFor("2026-01-15"), /Today's date is 2026-01-15 \(Thursday\)/);
  const utcToday = new Date().toISOString().slice(0, 10);
  assert.match(await promptFor("15/01/2026"), new RegExp(`Today's date is ${utcToday}`));
  assert.match(await promptFor(undefined), new RegExp(`Today's date is ${utcToday}`));
}

console.log("routing.test.ts: all passed");
