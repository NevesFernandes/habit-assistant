import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { handleAgentRequest, type AgentEnv, type Byok } from "./src/server/handleAgentRequest.ts";
import type { IncomingMessage } from "./src/server/providers/types.ts";

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

        let messages: IncomingMessage[];
        let byok: Byok | undefined;
        try {
          ({ messages, byok } = JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Invalid JSON body." }));
          return;
        }

        const result = await handleAgentRequest(messages, loadDevVars(), byok);
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

function loadDevVars(): AgentEnv {
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
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    localAgentApiPlugin(),
    VitePWA({
      registerType: "autoUpdate",
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
