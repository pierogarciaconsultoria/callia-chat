import type { RuntimeProviderType } from "./contracts";
import { createRuntimeError } from "./errors";
import type {
  AiProvider,
  SpeechProvider,
  VisionProvider,
  WebhookDispatcher,
  WhatsAppProvider,
} from "./providers";

export interface RuntimeRegistryInput {
  aiProvider?: AiProvider;
  speechProvider?: SpeechProvider;
  visionProvider?: VisionProvider;
  webhookDispatcher?: WebhookDispatcher;
  whatsappProviders?: Partial<Record<RuntimeProviderType, WhatsAppProvider>>;
}

export class RuntimeRegistry {
  private readonly whatsappProviders: Partial<
    Record<RuntimeProviderType, WhatsAppProvider>
  >;
  private readonly aiProvider?: AiProvider;
  private readonly speechProvider?: SpeechProvider;
  private readonly visionProvider?: VisionProvider;
  private readonly webhookDispatcher?: WebhookDispatcher;

  constructor(input: RuntimeRegistryInput) {
    this.whatsappProviders = input.whatsappProviders ?? {};
    this.aiProvider = input.aiProvider;
    this.speechProvider = input.speechProvider;
    this.visionProvider = input.visionProvider;
    this.webhookDispatcher = input.webhookDispatcher;
  }

  getWhatsAppProvider(provider: RuntimeProviderType) {
    const instance = this.whatsappProviders[provider];
    if (!instance) {
      throw createRuntimeError(
        "INTERNAL_ERROR",
        `WhatsApp provider "${provider}" is not registered.`,
      );
    }

    return instance;
  }

  getAiProvider() {
    if (!this.aiProvider) {
      throw createRuntimeError("INTERNAL_ERROR", "AI provider is not registered.");
    }

    return this.aiProvider;
  }

  getSpeechProvider() {
    if (!this.speechProvider) {
      throw createRuntimeError(
        "INTERNAL_ERROR",
        "Speech provider is not registered.",
      );
    }

    return this.speechProvider;
  }

  getVisionProvider() {
    if (!this.visionProvider) {
      throw createRuntimeError(
        "INTERNAL_ERROR",
        "Vision provider is not registered.",
      );
    }

    return this.visionProvider;
  }

  getWebhookDispatcher() {
    if (!this.webhookDispatcher) {
      throw createRuntimeError(
        "INTERNAL_ERROR",
        "Webhook dispatcher is not registered.",
      );
    }

    return this.webhookDispatcher;
  }
}

export function createRuntimeRegistry(input: RuntimeRegistryInput) {
  return new RuntimeRegistry(input);
}
