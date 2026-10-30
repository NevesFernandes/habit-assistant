import { execSync } from "node:child_process";
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
import { loadDevVars as loadDevVarsFrom } from "./scripts/devVars.ts";
import type { Category, WeekStart } from "./src/types/models.ts";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serves /api/agent directly inside `vite dev`, running the same logic as
 * src/server/worker.ts (the real deployment's entry point). This exists
 * because the Cloudflare Workers emulator (workerd, via `wrangler dev`)
 * can't run in this sandboxed environment (it needs large aligned mmap
 * regions the sandbox blocks) — see CONTRIBUTING.md's "Running locally".
 * `wrangler dev` remains the more faithful emulation and should work on a
 * normal machine.
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
        let weekStartsOn: WeekStart | undefined;
        let todayISO: string | undefined;
        try {
          ({ messages, byok, categories, hasPendingConfirmation, weekStartsOn, todayISO } = JSON.parse(
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
          weekStartsOn === 1 ? 1 : 0,
          todayISO,
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
  return loadDevVarsFrom(rootDir);
}

// §46: onnxruntime-web (inside @huggingface/transformers, used by the on-device Whisper
// worker) names its WASM runtime with `new URL(..., import.meta.url)` as a fallback, which
// makes Vite emit the 27 MB file into dist/. That's over Cloudflare's 25 MiB per-file limit
// (the deploy would fail), and it's never used: transformers.js always sets
// `ort.env.wasm.wasmPaths` itself and fetches the runtime from jsDelivr, cached after the
// first load. So the reference is turned into a plain string Vite leaves alone.
function dropUnusedOrtWasmPlugin(): Plugin {
  return {
    name: "drop-unused-ort-wasm",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("onnxruntime-web") || !code.includes("asyncify.wasm")) return null;
      return code.replace(/new URL\(("ort-wasm-simd-threaded\.asyncify\.wasm"),\s*import\.meta\.url\)/g, "{href:$1}");
    },
  };
}

// The version and build stamp shown under the title and in Settings, so the owner can
// tell whether the phone runs the latest deploy. Cloudflare's builder names the commit in
// WORKERS_CI_COMMIT_SHA; elsewhere git is asked, and a checkout without git says "dev".
function buildCommit(): string {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

const packageVersion = (JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version: string })
  .version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  worker: {
    plugins: () => [dropUnusedOrtWasmPlugin()],
  },
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
        // Default glob doesn't include the VAD model/loader extensions. It leaves out
        // .webp/.jpg on purpose (§49): the homepage screenshots aren't precached.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,wasm,mjs,onnx}"],
      },
      manifest: {
        name: "Habit Assistant",
        short_name: "Habits",
        description: "Chat with an agent to manage your habits and tasks.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        // §40 step 8: all generated from branding/logo.svg by `npm run icons`.
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // §49: gives Android's install dialog its richer, store-like look. JPEG
        // because WebP isn't reliably accepted there; phone-shaped only, so desktop
        // keeps the plain dialog. Generated by `npm run screenshots`.
        screenshots: [
          { src: "screenshots/chat.jpg", sizes: "720x1492", type: "image/jpeg", form_factor: "narrow", label: "Chat with the assistant" },
          { src: "screenshots/today.jpg", sizes: "720x1492", type: "image/jpeg", form_factor: "narrow", label: "Your day" },
          { src: "screenshots/stats.jpg", sizes: "720x1492", type: "image/jpeg", form_factor: "narrow", label: "Stats" },
        ],
      },
    }),
  ],
});
