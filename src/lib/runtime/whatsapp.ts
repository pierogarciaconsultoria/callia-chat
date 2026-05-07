import type {
  InstanceSelectionStrategy,
  ProviderSecretRef,
  RuntimeProviderType,
} from "./contracts";
import { buildProviderSecretRef } from "./contracts";

export type WhatsAppRuntimeStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "error";

export interface WorkspaceWhatsAppInstance {
  id: string;
  workspaceId: string;
  instanceName: string;
  providerType: RuntimeProviderType;
  providerSecretRef: ProviderSecretRef | null;
  isDefault: boolean;
  status: WhatsAppRuntimeStatus;
}

export interface ResolvedWorkspaceInstance {
  instance: WorkspaceWhatsAppInstance;
  strategy: InstanceSelectionStrategy;
}

export function createInstanceSecretRef(
  workspaceId: string,
  instanceId: string,
): ProviderSecretRef {
  return buildProviderSecretRef({
    provider: "evolution",
    workspaceId,
    scope: "instance",
    targetId: instanceId,
  });
}

export function getDefaultInstance(
  instances: WorkspaceWhatsAppInstance[],
): WorkspaceWhatsAppInstance | null {
  const defaults = instances.filter((instance) => instance.isDefault);

  if (defaults.length > 1) {
    throw new Error("Only one WhatsApp instance can be default per workspace.");
  }

  return defaults[0] ?? null;
}

export function resolveWorkspaceInstance(
  instances: WorkspaceWhatsAppInstance[],
  requestedInstanceId?: string | null,
): ResolvedWorkspaceInstance {
  if (instances.length === 0) {
    throw new Error("No WhatsApp instances configured for this workspace.");
  }

  if (requestedInstanceId) {
    const explicitInstance = instances.find(
      (instance) => instance.id === requestedInstanceId,
    );

    if (!explicitInstance) {
      throw new Error("Requested WhatsApp instance was not found in this workspace.");
    }

    return {
      instance: explicitInstance,
      strategy: "explicit",
    };
  }

  const defaultInstance = getDefaultInstance(instances);

  if (!defaultInstance) {
    throw new Error(
      "No default WhatsApp instance configured for this workspace.",
    );
  }

  return {
    instance: defaultInstance,
    strategy: "default",
  };
}
