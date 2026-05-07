import type { PublicApiMessageRequest } from "./contracts";
import type { RuntimeExecutionContext } from "./observability";
import { createExecutionContext } from "./observability";
import {
  resolveWorkspaceInstance,
  type WorkspaceWhatsAppInstance,
} from "./whatsapp";

export interface PublicApiRequestContextInput {
  workspaceId: string;
  payload: PublicApiMessageRequest;
  instances: WorkspaceWhatsAppInstance[];
  correlationId?: string;
}

export interface ResolvedPublicApiRequestContext {
  execution: RuntimeExecutionContext;
  workspaceId: string;
  whatsappInstanceId: string;
  instanceSelection: "explicit" | "default";
  payload: PublicApiMessageRequest;
}

export function createPublicApiRequestContext(
  input: PublicApiRequestContextInput,
): ResolvedPublicApiRequestContext {
  const resolvedInstance = resolveWorkspaceInstance(
    input.instances,
    input.payload.instanceId,
  );

  const execution = createExecutionContext({
    correlationId: input.correlationId,
    workspaceId: input.workspaceId,
  });

  return {
    execution,
    workspaceId: input.workspaceId,
    whatsappInstanceId: resolvedInstance.instance.id,
    instanceSelection: resolvedInstance.strategy,
    payload: input.payload,
  };
}
