import { createRuntimeError } from "./errors";
import type { PublicApiAuthenticator } from "./providers";

export interface ApiKeyLookupResult {
  apiKeyId: string;
  workspaceId: string;
  keyName: string;
  prefix: string;
  revokedAt?: string | null;
}

export interface ApiKeyResolver {
  findByRawKey(rawKey: string): Promise<ApiKeyLookupResult | null>;
}

export interface AuthenticatedApiRequest {
  workspaceId: string;
  apiKeyId: string;
  keyName: string;
}

export class HeaderApiKeyAuthenticator implements PublicApiAuthenticator {
  constructor(private readonly resolver: ApiKeyResolver) {}

  async authenticate(headers: Headers): Promise<AuthenticatedApiRequest> {
    const rawKey = headers.get("x-api-key")?.trim();

    if (!rawKey) {
      throw createRuntimeError("UNAUTHORIZED", "Missing x-api-key header.");
    }

    const prefixSeparator = rawKey.indexOf("_");
    if (prefixSeparator <= 0) {
      throw createRuntimeError("UNAUTHORIZED", "Invalid API key format.");
    }

    const prefix = rawKey.slice(0, prefixSeparator);
    const result = await this.resolver.findByRawKey(rawKey);

    if (!result) {
      throw createRuntimeError("UNAUTHORIZED", "API key not found.");
    }

    if (result.prefix !== prefix) {
      throw createRuntimeError("UNAUTHORIZED", "API key prefix mismatch.");
    }

    if (result.revokedAt) {
      throw createRuntimeError("FORBIDDEN", "API key has been revoked.", {
        apiKeyId: result.apiKeyId,
      });
    }

    return {
      workspaceId: result.workspaceId,
      apiKeyId: result.apiKeyId,
      keyName: result.keyName,
    };
  }
}
