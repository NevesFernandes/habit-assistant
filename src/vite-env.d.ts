/// <reference types="vite/client" />

// Set at build time by vite.config.ts's `define`.
declare const __APP_VERSION__: string; // package.json's version
declare const __BUILD_COMMIT__: string; // short git commit, or "dev"
declare const __BUILD_TIME__: string; // ISO timestamp

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_DEBUG_LOG_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
