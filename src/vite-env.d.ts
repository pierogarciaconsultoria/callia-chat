/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RUNTIME_ENV?: "development" | "staging" | "production";
  readonly VITE_EVOLUTION_PROXY_URL?: string;
  readonly VITE_LOVABLE_AI_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
