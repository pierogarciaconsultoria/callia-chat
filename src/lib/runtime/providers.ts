import type {
  NormalizedInboundEvent,
  PublicApiMessageRequest,
  WebhookDispatchPayload,
} from "./contracts";

export interface WhatsAppProviderSendInput {
  workspaceId: string;
  instanceId: string;
  phoneNumber: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  correlationId: string;
}

export interface WhatsAppProviderResult {
  providerMessageId?: string;
  status: "queued" | "sent" | "failed";
  raw?: Record<string, unknown>;
}

export interface WhatsAppProvider {
  connectInstance(instanceId: string): Promise<void>;
  fetchInstanceStatus(instanceId: string): Promise<string>;
  sendText(input: WhatsAppProviderSendInput): Promise<WhatsAppProviderResult>;
  sendMedia(input: WhatsAppProviderSendInput): Promise<WhatsAppProviderResult>;
  normalizeInboundEvent(payload: Record<string, unknown>): Promise<NormalizedInboundEvent>;
}

export interface AiProviderInput {
  prompt: string;
  systemPrompt?: string;
  context?: Record<string, unknown>;
  correlationId: string;
}

export interface AiProviderOutput {
  text: string;
  model: string;
  tokensUsed?: number;
  raw?: Record<string, unknown>;
}

export interface AiProvider {
  generateText(input: AiProviderInput): Promise<AiProviderOutput>;
}

export interface SpeechProvider {
  transcribeAudio(input: {
    mediaUrl: string;
    correlationId: string;
  }): Promise<{ text: string; model: string }>;
  synthesizeSpeech(input: {
    text: string;
    voiceId: string;
    correlationId: string;
  }): Promise<{ mediaUrl: string; model: string }>;
}

export interface VisionProvider {
  analyzeImage(input: {
    mediaUrl: string;
    prompt?: string;
    correlationId: string;
  }): Promise<{ text: string; model: string }>;
}

export interface PublicApiAuthenticator {
  authenticate(headers: Headers): Promise<{
    workspaceId: string;
    apiKeyId: string;
    keyName: string;
  }>;
}

export interface PublicApiService {
  sendMessage(input: PublicApiMessageRequest): Promise<WhatsAppProviderResult>;
}

export interface WebhookDispatcher {
  dispatch(payload: WebhookDispatchPayload): Promise<void>;
}
