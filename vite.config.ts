/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Os módulos _shared das edge functions importam pacotes com especificador Deno (npm:pkg@x).
      { find: /^npm:(@?[^@]+)@[^/]+$/, replacement: "$1" },
    ],
  },
  server: { port: 8080 },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"],
    environmentMatchGlobs: [["src/test/**/*.test.tsx", "jsdom"]],
  },
});
