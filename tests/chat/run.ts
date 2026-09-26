// §33 in Roadmap.md: headless chat-scenario runner. Plays each scenario's turns
// through the app's own ChatSession (src/lib/chatEngine.ts) against a REAL
// model — handleAgentRequest called directly with .dev.vars keys, no HTTP, no
// Google Drive (an in-memory persist over a JSON fixture instead).
//
//   npm run test:chat -- s32-identical      scenarios whose name contains this (a filter is required)
//   npm run test:chat -- --all               every scenario — only on explicit request, see below
//   npm run test:chat -- --repeat 5          each scenario 5x, prints pass rates
//   npm run test:chat -- --provider groq     gemini | groq | workersAI | chain (the full failover chain)
//   npm run test:chat -- --delay 3000        ms to wait between model calls (free-tier rate limits)
//   npm run test:chat -- --verbose           also show the server's own console logging
//
// Scenarios are meant to be written and run ad-hoc, for the specific behavior being
// changed or investigated — every turn is a real model call on free-tier quota, so the
// runner refuses to run the whole set without an explicit --all.
//
// A full report (every message, reply, tool call and debug entry) is written to
// test-results/chat-<timestamp>.json (gitignored). Exit code 1 if anything failed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatSession } from "../../src/lib/chatEngine.ts";
import { AgentRequestError, type AgentResponse } from "../../src/lib/agentClient.ts";
import { handleAgentRequest, type AgentDebugEntry, type AgentEnv } from "../../src/server/handleAgentRequest.ts";
import { toDisplayMessages } from "../../src/server/agentHistory.ts";
import { DEFAULT_CATEGORIES, type AppData } from "../../src/types/models.ts";
import { readDevVarsFile, loadDevVars } from "../../scripts/devVars.ts";
import type { Scenario, TextMatch, Turn } from "./types.ts";
import { scenarios as s28 } from "./scenarios/s28-pause.ts";
import { scenarios as s29 } from "./scenarios/s29-future-dates.ts";
import { scenarios as s31 } from "./scenarios/s31-confirmations.ts";
import { scenarios as s32 } from "./scenarios/s32-disambiguation.ts";
import { scenarios as s34 } from "./scenarios/s34-name-matching.ts";
import { scenarios as s35 } from "./scenarios/s35-word-forms.ts";
import { scenarios as s39 } from "./scenarios/s39-task-checklist.ts";
import { scenarios as checklistAdd } from "./scenarios/checklist-add-multiple.ts";
import { scenarios as s41 } from "./scenarios/s41-mark-done.ts";

const ALL_SCENARIOS: Scenario[] = [...s28, ...s29, ...s31, ...s32, ...s34, ...s35, ...s39, ...checklistAdd, ...s41];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type ProviderChoice = "gemini" | "groq" | "workersAI" | "chain";

interface Options {
  filters: string[];
  repeat: number;
  provider: ProviderChoice;
  delayMs: number;
  verbose: boolean;
  all: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { filters: [], repeat: 1, provider: "gemini", delayMs: 1500, verbose: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repeat") options.repeat = Math.max(1, Number(argv[++i]));
    else if (arg === "--provider") options.provider = argv[++i] as ProviderChoice;
    else if (arg === "--delay") options.delayMs = Number(argv[++i]);
    else if (arg === "--verbose") options.verbose = true;
    else if (arg === "--all") options.all = true;
    else options.filters.push(arg);
  }
  if (!["gemini", "groq", "workersAI", "chain"].includes(options.provider)) {
    throw new Error(`Unknown --provider "${options.provider}" (gemini | groq | workersAI | chain).`);
  }
  return options;
}

/**
 * A single-provider env by default, so a failing model shows up as a failure instead of
 * being silently covered by the failover chain (which is exactly what hid Gemini's daily
 * quota running out during §32 testing). TEST_GEMINI_API_KEY, if set in .dev.vars, keeps
 * test runs off the quota the dev app and shared trial use.
 */
function buildEnv(provider: ProviderChoice): { env: AgentEnv; expectedProviderId?: string } {
  const all = loadDevVars(rootDir);
  const raw = readDevVarsFile(rootDir);
  switch (provider) {
    case "chain":
      return { env: all };
    case "gemini":
      return {
        env: {
          TRIAL_PROVIDER: "gemini",
          TRIAL_API_KEY: raw.TEST_GEMINI_API_KEY || (all.TRIAL_PROVIDER === "gemini" ? all.TRIAL_API_KEY : undefined),
          TRIAL_MODEL: all.TRIAL_PROVIDER === "gemini" ? all.TRIAL_MODEL : undefined,
        },
        expectedProviderId: "gemini",
      };
    case "groq": {
      const key = all.TRIAL_FALLBACK_PROVIDER === "groq" ? all.TRIAL_FALLBACK_API_KEY : undefined;
      return {
        env: { TRIAL_PROVIDER: "groq", TRIAL_API_KEY: key, TRIAL_MODEL: all.TRIAL_FALLBACK_MODEL },
        expectedProviderId: "groq",
      };
    }
    case "workersAI":
      return {
        env: {
          WORKERS_AI_ACCOUNT_ID: all.WORKERS_AI_ACCOUNT_ID,
          WORKERS_AI_API_TOKEN: all.WORKERS_AI_API_TOKEN,
          WORKERS_AI_MODEL: all.WORKERS_AI_MODEL,
        },
        expectedProviderId: "workersAI",
      };
  }
}

function loadFixture(name: string): AppData {
  const raw = JSON.parse(fs.readFileSync(path.join(rootDir, "tests/chat/fixtures", `${name}.json`), "utf-8"));
  delete raw._comment;
  return { categories: DEFAULT_CATEGORIES, habits: [], recurringTasks: [], singleTasks: [], completionLog: [], ...raw };
}

function matches(text: string, pattern: TextMatch): boolean {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

function asList<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TurnReport {
  user: string;
  reply: string;
  toolCalls: string[];
  /** The model's tool-call arguments this turn (e.g. which name fragment it sent). */
  toolInputs: Record<string, unknown>[];
  debug: AgentDebugEntry[];
  failures: string[];
}

interface ScenarioReport {
  name: string;
  run: number;
  passed: boolean;
  turns: TurnReport[];
  finalData?: AppData;
}

async function runScenario(
  scenario: Scenario,
  run: number,
  env: AgentEnv,
  expectedProviderId: string | undefined,
  delayMs: number,
): Promise<ScenarioReport> {
  let data = loadFixture(scenario.fixture);
  let turnDebug: AgentDebugEntry[] = [];
  let calledModelBefore = false;

  const session = new ChatSession({
    getData: () => data,
    persist: async (mutate) => {
      data = mutate(data);
      return true;
    },
    callAgent: async (messages, categories, hasPendingConfirmation): Promise<AgentResponse> => {
      if (calledModelBefore) await sleep(delayMs);
      calledModelBefore = true;
      const call = () => handleAgentRequest(messages, env, undefined, categories, hasPendingConfirmation);
      const result = verbose ? await call() : await quietly(call);
      if (result.status !== 200) throw new AgentRequestError(result.body.error ?? `status ${result.status}`, result.body.debug);
      return result.body as AgentResponse;
    },
    todayISO: () => new Date().toISOString().slice(0, 10),
    onDebug: (entry) => turnDebug.push(entry),
  });

  const turns: TurnReport[] = [];
  for (const turn of scenario.turns) {
    turnDebug = [];
    const before = session.messages.length;
    await session.send(turn.user);
    const reply = toDisplayMessages(session.messages.slice(before))
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
      .join("\n");
    const toolInputs = session.messages
      .slice(before)
      .flatMap((message) => (message.role === "assistant" && message.toolCall ? [message.toolCall.input] : []));
    const toolCalls = turnDebug.flatMap((entry) => ("toolCallName" in entry.result && entry.result.toolCallName ? [entry.result.toolCallName] : []));
    turns.push({ user: turn.user, reply, toolCalls, toolInputs, debug: turnDebug, failures: checkTurn(turn, reply, toolCalls, turnDebug, data, expectedProviderId) });
  }
  return { name: scenario.name, run, passed: turns.every((t) => t.failures.length === 0), turns, finalData: data };
}

function checkTurn(
  turn: Turn,
  reply: string,
  toolCalls: string[],
  debug: AgentDebugEntry[],
  data: AppData,
  expectedProviderId: string | undefined,
): string[] {
  const failures: string[] = [];
  const expect = turn.expect ?? {};

  for (const entry of debug) {
    if ("error" in entry.result) failures.push(`model call failed: ${entry.result.error.slice(0, 200)}`);
    if (expectedProviderId && entry.providerId !== expectedProviderId) {
      failures.push(`answered by ${entry.providerId} (${entry.label}), expected ${expectedProviderId}`);
    }
  }
  if (expect.noModelCall && debug.length > 0) failures.push("expected no model call, but the model was called");
  if (!expect.noModelCall && debug.length === 0) failures.push("expected a model call, but none happened");

  if (expect.toolCall === null && toolCalls.length > 0) failures.push(`expected no tool call, got ${toolCalls.join(", ")}`);
  if (expect.toolCall) {
    const allowed = asList(expect.toolCall);
    if (!toolCalls.some((name) => allowed.includes(name))) {
      failures.push(`expected tool ${allowed.join(" | ")}, got ${toolCalls.join(", ") || "none (plain reply)"}`);
    }
  }
  for (const pattern of asList(expect.reply)) {
    if (!matches(reply, pattern)) failures.push(`reply missing ${pattern}`);
  }
  for (const pattern of asList(expect.notReply)) {
    if (matches(reply, pattern)) failures.push(`reply should not contain ${pattern}`);
  }
  if (expect.data) {
    const result = expect.data(data);
    if (result !== true) failures.push(`data: ${result}`);
  }
  return failures;
}

function indent(text: string, prefix = "      "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/** Runs `fn` with the server code's console.log/error muted — the same detail is in the report. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

let verbose = false;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  verbose = options.verbose;
  const { env, expectedProviderId } = buildEnv(options.provider);
  if (options.filters.length === 0 && !options.all) {
    console.error(
      "Pass a scenario name filter (e.g. npm run test:chat -- s32-identical) — or --all to run every scenario.\n" +
        "Scenarios:\n" +
        ALL_SCENARIOS.map((scenario) => `  ${scenario.name}`).join("\n"),
    );
    process.exit(1);
  }
  const selected = ALL_SCENARIOS.filter(
    (scenario) => options.all || options.filters.some((filter) => scenario.name.includes(filter)),
  );
  if (selected.length === 0) {
    console.error(`No scenarios match: ${options.filters.join(", ")}`);
    process.exit(1);
  }

  console.log(`Chat scenarios: ${selected.length} × ${options.repeat} run(s), provider: ${options.provider}\n`);
  const reports: ScenarioReport[] = [];
  for (const scenario of selected) {
    for (let run = 1; run <= options.repeat; run++) {
      const report = await runScenario(scenario, run, env, expectedProviderId, options.delayMs);
      reports.push(report);
      const label = options.repeat > 1 ? `${scenario.name} (run ${run})` : scenario.name;
      console.log(`${report.passed ? "PASS" : "FAIL"}  ${label}`);
      for (const turn of report.turns) {
        const via = turn.debug.map((d) => `${d.providerId}/${d.model} ${d.latencyMs}ms`).join(", ") || "no model call";
        const names = turn.toolInputs.flatMap((input) => (typeof input.name === "string" ? [`name="${input.name}"`] : []));
        console.log(`    > ${turn.user}   [${[turn.toolCalls.join(", ") || "-", ...names].join(" ")} · ${via}]`);
        if (turn.failures.length > 0 || !report.passed) console.log(indent(turn.reply || "(no reply)"));
        for (const failure of turn.failures) console.log(`      ✗ ${failure}`);
      }
    }
  }

  const passed = reports.filter((r) => r.passed).length;
  console.log(`\n${passed}/${reports.length} passed`);
  if (options.repeat > 1) {
    for (const scenario of selected) {
      const runs = reports.filter((r) => r.name === scenario.name);
      console.log(`  ${runs.filter((r) => r.passed).length}/${runs.length}  ${scenario.name}`);
    }
  }

  const outDir = path.join(rootDir, "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `chat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ options, reports }, null, 2));
  console.log(`Report: ${path.relative(rootDir, outFile)}`);
  process.exit(passed === reports.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
