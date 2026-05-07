import { z } from "zod";

const runtimeEnvSchema = z.object({
  VITE_RUNTIME_ENV: z
    .enum(["development", "staging", "production"])
    .default("development"),
  VITE_EVOLUTION_PROXY_URL: z.string().url().optional(),
  VITE_LOVABLE_AI_GATEWAY_URL: z.string().url().optional(),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

export function getRuntimeEnv(env: Record<string, string | undefined> = import.meta.env) {
  return runtimeEnvSchema.parse({
    VITE_RUNTIME_ENV: env.VITE_RUNTIME_ENV,
    VITE_EVOLUTION_PROXY_URL: env.VITE_EVOLUTION_PROXY_URL,
    VITE_LOVABLE_AI_GATEWAY_URL: env.VITE_LOVABLE_AI_GATEWAY_URL,
  });
}
