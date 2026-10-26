import type { Config } from "tailwindcss";

// Cores de marca vêm de workspace_branding e são aplicadas como variáveis CSS (ver src/lib/branding.ts).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          fg: "rgb(var(--brand-fg) / <alpha-value>)",
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
        },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
