/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_DEBUG_LOG_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
