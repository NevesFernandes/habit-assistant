import type { ProviderAdapter, ProviderId } from "./types.ts";
import anthropic from "./anthropic.ts";
import groq from "./groq.ts";
import gemini from "./gemini.ts";
import workersAI from "./workersAI.ts";
import mock from "./mock.ts";

const providers: Record<ProviderId, ProviderAdapter> = { anthropic, groq, gemini, workersAI, mock };

export function resolveProvider(id: string): ProviderAdapter {
  const provider = providers[id as ProviderId];
  if (!provider) {
    throw new Error(`Unknown provider "${id}". Expected one of: ${Object.keys(providers).join(", ")}.`);
  }
  return provider;
}

export type { ProviderAdapter, ProviderId } from "./types.ts";
