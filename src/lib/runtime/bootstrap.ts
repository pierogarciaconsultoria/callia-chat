import { getRuntimeEnv } from "./config";
import { createEvolutionWhatsAppProvider } from "./evolution";
import {
  createAiProviderStub,
  createSpeechProviderStub,
  createVisionProviderStub,
  createWebhookDispatcherStub,
} from "./provider-stubs";
import { createRuntimeRegistry } from "./registry";
import type { ProviderSecretStore } from "./secrets";

export interface RuntimeBootstrapOptions {
  secretStore: ProviderSecretStore;
  env?: Record<string, string | undefined>;
  resolveEvolutionSecretRef?: (input: {
    instanceId: string;
    workspaceId?: string;
  }) => string | null | Promise<string | null>;
}

export function bootstrapRuntime(options: RuntimeBootstrapOptions) {
  const env = getRuntimeEnv(options.env);

  const evolutionProvider = createEvolutionWhatsAppProvider({
    secretStore: options.secretStore,
    resolveSecretRef: options.resolveEvolutionSecretRef,
  });

  return {
    env,
    registry: createRuntimeRegistry({
      whatsappProviders: {
        evolution: evolutionProvider,
      },
      aiProvider: createAiProviderStub(),
      speechProvider: createSpeechProviderStub(),
      visionProvider: createVisionProviderStub(),
      webhookDispatcher: createWebhookDispatcherStub(),
    }),
  };
}
