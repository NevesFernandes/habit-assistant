// Reads the local-only `.dev.vars` secrets file (same KEY=value format
// Wrangler uses) into the env shape the agent/transcribe handlers expect.
// Shared by the Vite dev middleware (vite.config.ts) and the headless
// chat-scenario tests (tests/chat/run.ts), so both see identical config.
// Lives outside src/server/ because that folder is also compiled for the
// Cloudflare Worker, which has no node:fs.
import fs from "node:fs";
import path from "node:path";
import type { AgentEnv } from "../src/server/handleAgentRequest.ts";
import type { TranscribeEnv } from "../src/server/handleTranscribeRequest.ts";

export function readDevVarsFile(rootDir: string): Record<string, string> {
  const filePath = path.join(rootDir, ".dev.vars");
  const values: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return values;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    values[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }
  return values;
}

export function loadDevVars(rootDir: string): AgentEnv & TranscribeEnv {
  const values = readDevVarsFile(rootDir);
  return {
    TRIAL_PROVIDER: values.TRIAL_PROVIDER,
    TRIAL_API_KEY: values.TRIAL_API_KEY,
    TRIAL_MODEL: values.TRIAL_MODEL,
    // §23/§26 in Roadmap.md: the failover chain's fallback and last-resort
    // tiers were once silently unreachable in local dev because only the
    // primary-tier vars were forwarded here — keep every tier listed.
    TRIAL_FALLBACK_PROVIDER: values.TRIAL_FALLBACK_PROVIDER,
    TRIAL_FALLBACK_API_KEY: values.TRIAL_FALLBACK_API_KEY,
    TRIAL_FALLBACK_MODEL: values.TRIAL_FALLBACK_MODEL,
    WORKERS_AI_ACCOUNT_ID: values.WORKERS_AI_ACCOUNT_ID,
    WORKERS_AI_API_TOKEN: values.WORKERS_AI_API_TOKEN,
    WORKERS_AI_MODEL: values.WORKERS_AI_MODEL,
    STT_TRIAL_API_KEY: values.STT_TRIAL_API_KEY,
  };
}
