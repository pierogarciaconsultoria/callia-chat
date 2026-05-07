import type {
  AiProvider,
  SpeechProvider,
  VisionProvider,
  WebhookDispatcher,
  WhatsAppProvider,
} from "./providers";
import { createRuntimeError } from "./errors";

function notImplemented(name: string): never {
  throw createRuntimeError(
    "EXTERNAL_PROVIDER_ERROR",
    `${name} is not implemented yet.`,
  );
}

export function createEvolutionWhatsAppStub(): WhatsAppProvider {
  return {
    async connectInstance() {
      notImplemented("Evolution connectInstance");
    },
    async fetchInstanceStatus() {
      notImplemented("Evolution fetchInstanceStatus");
    },
    async sendText() {
      notImplemented("Evolution sendText");
    },
    async sendMedia() {
      notImplemented("Evolution sendMedia");
    },
    async normalizeInboundEvent() {
      notImplemented("Evolution normalizeInboundEvent");
    },
  };
}

export function createAiProviderStub(): AiProvider {
  return {
    async generateText() {
      notImplemented("AI generateText");
    },
  };
}

export function createSpeechProviderStub(): SpeechProvider {
  return {
    async transcribeAudio() {
      notImplemented("Speech transcribeAudio");
    },
    async synthesizeSpeech() {
      notImplemented("Speech synthesizeSpeech");
    },
  };
}

export function createVisionProviderStub(): VisionProvider {
  return {
    async analyzeImage() {
      notImplemented("Vision analyzeImage");
    },
  };
}

export function createWebhookDispatcherStub(): WebhookDispatcher {
  return {
    async dispatch() {
      notImplemented("Webhook dispatch");
    },
  };
}
