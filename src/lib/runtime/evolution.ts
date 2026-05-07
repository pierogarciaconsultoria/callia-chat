import type { NormalizedInboundEvent } from "./contracts";
import { createRuntimeError } from "./errors";
import type {
  WhatsAppProvider,
  WhatsAppProviderResult,
  WhatsAppProviderSendInput,
} from "./providers";
import type { ProviderSecretStore } from "./secrets";
import { resolveProviderSecret } from "./secrets";

type FetchLike = typeof fetch;

type EvolutionPayload = Record<string, unknown>;

export interface EvolutionProviderOptions {
  secretStore: ProviderSecretStore;
  fetchImpl?: FetchLike;
  resolveSecretRef?: (input: {
    instanceId: string;
    workspaceId?: string;
  }) => string | null | Promise<string | null>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

type EvolutionRequestResult = Record<string, unknown> & {
  raw: Record<string, unknown>;
  key?: Record<string, unknown>;
  instance?: Record<string, unknown>;
};

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  private readonly secretStore: ProviderSecretStore;
  private readonly fetchImpl: FetchLike;
  private readonly resolveSecretRef?: EvolutionProviderOptions["resolveSecretRef"];

  constructor(options: EvolutionProviderOptions) {
    this.secretStore = options.secretStore;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveSecretRef = options.resolveSecretRef;
  }

  async connectInstance(instanceId: string): Promise<void> {
    await this.request(instanceId, {
      pathFactory: (resolvedInstanceId) => `/instance/connect/${resolvedInstanceId}`,
      method: "GET",
    });
  }

  async fetchInstanceStatus(instanceId: string): Promise<string> {
    const response = await this.request(instanceId, {
      pathFactory: (resolvedInstanceId) =>
        `/instance/connectionState/${resolvedInstanceId}`,
      method: "GET",
    });

    const state =
      asString(response.instance?.state) ??
      asString(response.state) ??
      asString(response.status);

    return state ?? "unknown";
  }

  async sendText(input: WhatsAppProviderSendInput): Promise<WhatsAppProviderResult> {
    const response = await this.request(input.instanceId, {
      pathFactory: (resolvedInstanceId) => `/message/sendText/${resolvedInstanceId}`,
      method: "POST",
      body: {
        number: input.phoneNumber,
        text: input.text ?? "",
      },
      expectedWorkspaceId: input.workspaceId,
    });

    return {
      providerMessageId:
        asString(response.key?.id) ??
        asString(response.messageId) ??
        asString(response.id) ??
        undefined,
      status: "sent",
      raw: response.raw,
    };
  }

  async sendMedia(input: WhatsAppProviderSendInput): Promise<WhatsAppProviderResult> {
    const response = await this.request(input.instanceId, {
      pathFactory: (resolvedInstanceId) => `/message/sendMedia/${resolvedInstanceId}`,
      method: "POST",
      body: {
        number: input.phoneNumber,
        mediatype: input.mimeType ?? "application/octet-stream",
        media: input.mediaUrl,
        caption: input.text,
      },
      expectedWorkspaceId: input.workspaceId,
    });

    return {
      providerMessageId:
        asString(response.key?.id) ??
        asString(response.messageId) ??
        asString(response.id) ??
        undefined,
      status: "sent",
      raw: response.raw,
    };
  }

  async normalizeInboundEvent(payload: EvolutionPayload): Promise<NormalizedInboundEvent> {
    const rawData = asRecord(payload.data) ?? payload;
    const key = asRecord(rawData.key);
    const message = asRecord(rawData.message);
    const instance = asString(payload.instance) ?? asString(rawData.instance);
    const providerEventId =
      asString(key?.id) ??
      asString(rawData.id) ??
      asString(payload.event) ??
      crypto.randomUUID();
    const customerPhone =
      asString(key?.remoteJid)?.replace(/@.+$/, "") ??
      asString(rawData.sender) ??
      asString(rawData.from);
    const text =
      asString(message?.conversation) ??
      asString(asRecord(message?.extendedTextMessage)?.text) ??
      asString(rawData.text);

    if (!instance) {
      throw createRuntimeError("BAD_REQUEST", "Evolution payload is missing the instance identifier.");
    }

    if (!customerPhone) {
      throw createRuntimeError("BAD_REQUEST", "Evolution payload is missing the customer phone.");
    }

    return {
      workspaceId: asString(rawData.workspaceId) ?? "",
      whatsappInstanceId: asString(rawData.whatsappInstanceId) ?? instance,
      provider: "evolution",
      eventType: asString(payload.event) ?? "message.received",
      providerEventId,
      customerPhone,
      customerName: asString(rawData.pushName) ?? asString(rawData.senderName),
      correlationId: asString(rawData.correlationId) ?? undefined,
      message: {
        type: text ? "text" : "system",
        text,
        mediaUrl: asString(rawData.mediaUrl),
        mimeType: asString(rawData.mimetype),
        externalMessageId: providerEventId,
      },
      rawPayload: payload,
    };
  }

  private async request(
    instanceId: string,
    options: {
      pathFactory: (instanceId: string) => string;
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      expectedWorkspaceId?: string;
    },
  ): Promise<EvolutionRequestResult> {
    const secretRef =
      (await this.resolveSecretRef?.({
        instanceId,
        workspaceId: options.expectedWorkspaceId,
      })) ??
      null;

    const resolvedSecret = await resolveProviderSecret(
      this.secretStore,
      secretRef,
      {
        expectedProvider: "evolution",
        expectedScope: "instance",
        expectedWorkspaceId: options.expectedWorkspaceId,
      },
    );

    const baseUrl = resolvedSecret.value.baseUrl;
    const apiKey = resolvedSecret.value.apiKey;

    if (!baseUrl || !apiKey) {
      throw createRuntimeError(
        "EXTERNAL_PROVIDER_ERROR",
        "Evolution provider secret is incomplete.",
      );
    }

    const response = await this.fetchImpl(
      joinUrl(baseUrl, options.pathFactory(instanceId)),
      {
        method: options.method,
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
    );

    if (!response.ok) {
      throw createRuntimeError(
        "EXTERNAL_PROVIDER_ERROR",
        `Evolution request failed with status ${response.status}.`,
      );
    }

    const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    const parsed: EvolutionRequestResult = {
      raw,
      ...raw,
      key: asRecord(raw.key) ?? undefined,
      instance: asRecord(raw.instance) ?? undefined,
    };

    return parsed;
  }
}

export function createEvolutionWhatsAppProvider(
  options: EvolutionProviderOptions,
) {
  return new EvolutionWhatsAppProvider(options);
}
