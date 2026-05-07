import type {
  ParsedProviderSecretRef,
  ProviderSecretRef,
  RuntimeProviderType,
  RuntimeSecretScope,
} from "./contracts";
import { parseProviderSecretRef } from "./contracts";
import { createRuntimeError } from "./errors";

export interface ProviderSecretValue {
  baseUrl?: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
}

export interface SecretLookupResult {
  ref: ProviderSecretRef;
  value: ProviderSecretValue;
}

export interface ProviderSecretStore {
  getSecret(ref: ProviderSecretRef): Promise<ProviderSecretValue | null>;
}

export interface ResolveProviderSecretOptions {
  expectedProvider?: RuntimeProviderType;
  expectedScope?: RuntimeSecretScope;
  expectedWorkspaceId?: string;
}

export interface ResolvedProviderSecret {
  ref: ProviderSecretRef;
  parsed: ParsedProviderSecretRef;
  value: ProviderSecretValue;
}

export async function resolveProviderSecret(
  store: ProviderSecretStore,
  ref: string | null | undefined,
  options: ResolveProviderSecretOptions = {},
): Promise<ResolvedProviderSecret> {
  if (!ref) {
    throw createRuntimeError("NOT_FOUND", "Provider secret reference is missing.");
  }

  const parsed = parseProviderSecretRef(ref);
  if (!parsed) {
    throw createRuntimeError("BAD_REQUEST", "Invalid provider secret reference.");
  }

  if (options.expectedProvider && parsed.provider !== options.expectedProvider) {
    throw createRuntimeError("FORBIDDEN", "Provider secret belongs to another provider.", {
      expectedProvider: options.expectedProvider,
      actualProvider: parsed.provider,
    });
  }

  if (options.expectedScope && parsed.scope !== options.expectedScope) {
    throw createRuntimeError("FORBIDDEN", "Provider secret scope mismatch.", {
      expectedScope: options.expectedScope,
      actualScope: parsed.scope,
    });
  }

  if (
    options.expectedWorkspaceId &&
    parsed.workspaceId !== options.expectedWorkspaceId
  ) {
    throw createRuntimeError(
      "FORBIDDEN",
      "Provider secret belongs to another workspace.",
      {
        expectedWorkspaceId: options.expectedWorkspaceId,
        actualWorkspaceId: parsed.workspaceId,
      },
    );
  }

  const value = await store.getSecret(ref as ProviderSecretRef);
  if (!value) {
    throw createRuntimeError("NOT_FOUND", "Provider secret value was not found.", {
      ref,
    });
  }

  return {
    ref: ref as ProviderSecretRef,
    parsed,
    value,
  };
}

export class InMemoryProviderSecretStore implements ProviderSecretStore {
  constructor(
    private readonly secrets: Record<string, ProviderSecretValue> = {},
  ) {}

  async getSecret(ref: ProviderSecretRef): Promise<ProviderSecretValue | null> {
    return this.secrets[ref] ?? null;
  }
}
