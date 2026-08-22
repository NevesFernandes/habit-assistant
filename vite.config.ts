import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { handleAgentRequest, type AgentEnv, type Byok } from "./src/server/handleAgentRequest.ts";
import type { AgentHistoryMessage } from "./src/server/agentHistory.ts";
import { handleTranscribeRequest, type TranscribeEnv } from "./src/server/handleTranscribeRequest.ts";
import type { Category } from "./src/types/models.ts";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serves /api/agent directly inside `vite dev`, running the same logic as
 * functions/api/agent.ts. This exists because the Cloudflare Workers
 * emulator (workerd, via `wrangler pages dev`) can't run in this sandboxed
 * environment (it needs large aligned mmap regions the sandbox blocks) — see
 * README.md's "Local dev note". `wrangler pages dev` remains the more
 * faithful emulation and should work on a normal machine.
 */
function localAgentApiPlugin(): Plugin {
  return {
    name: "local-agent-api",
    configureServer(server) {
      server.middlewares.use("/api/agent", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);

        let messages: AgentHistoryMessage[];
        let byok: Byok | undefined;
        let categories: Category[] | undefined;
        let hasPendingConfirmation: boolean | undefined;
        try {
          ({ messages, byok, categories, hasPendingConfirmation } = JSON.parse(
            Buffer.concat(chunks).toString("utf-8"),
          ));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON body." }));
          return;
        }

        const result = await handleAgentRequest(
          messages,
          loadDevVars(),
          byok,
          categories,
          hasPendingConfirmation ?? false,
        );
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result.body));
      });

      server.middlewares.use("/api/transcribe", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);

        let form: FormData;
        try {
          const request = new Request("http://localhost/api/transcribe", {
            method: "POST",
            headers: req.headers as Record<string, string>,
            body,
          });
          form = await request.formData();
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid multipart body." }));
          return;
        }

        const audio = form.get("audio");
        const apiKey = form.get("apiKey");
        if (!(audio instanceof Blob)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Expected a multipart `audio` field." }));
          return;
        }

        const result = await handleTranscribeRequest(
          audio,
          audio.type,
          loadDevVars(),
          typeof apiKey === "string" && apiKey ? apiKey : undefined,
        );
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

function loadDevVars(): AgentEnv & TranscribeEnv {
  const filePath = path.join(rootDir, ".dev.vars");
  const values: Record<string, string> = {};
  if (fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      values[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
    }
  }
  return {
    TRIAL_PROVIDER: values.TRIAL_PROVIDER,
    TRIAL_API_KEY: values.TRIAL_API_KEY,
    TRIAL_MODEL: values.TRIAL_MODEL,
    STT_TRIAL_API_KEY: values.STT_TRIAL_API_KEY,
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    localAgentApiPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // Default is 2 MiB; the self-hosted onnxruntime-web WASM runtime
        // (public/ort/, used for client-side voice-activity detection) is
        // ~13MB. Precaching it means it's a one-time download, not
        // re-fetched on every visit — see CLAUDE.md's "Voice input" section.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Default glob doesn't include the VAD model/loader extensions.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,wasm,mjs,onnx}"],
      },
      manifest: {
        name: "Habit Assistant",
        short_name: "Habits",
        description: "Chat with an agent to manage your habits and tasks.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    }),
  ],
});
