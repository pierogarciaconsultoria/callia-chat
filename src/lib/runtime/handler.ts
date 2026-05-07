import type { RuntimeEnv } from "./config";
import { toErrorResponse } from "./errors";
import { jsonResponse } from "./http";
import {
  createExecutionContext,
  createLogEvent,
  type RuntimeExecutionContext,
  type RuntimeLogEvent,
} from "./observability";
import type { RuntimeRegistry } from "./registry";

export interface RuntimeServices {
  env: RuntimeEnv;
  registry: RuntimeRegistry;
}

export interface RuntimeRequestContext extends RuntimeExecutionContext {
  request: Request;
  services: RuntimeServices;
  log: (
    event: Omit<RuntimeLogEvent, "correlationId" | "createdAt">,
  ) => RuntimeLogEvent;
}

export async function handleRuntimeRequest(
  request: Request,
  services: RuntimeServices,
  handler: (context: RuntimeRequestContext) => Promise<Response>,
  partialContext: Partial<RuntimeExecutionContext> = {},
): Promise<Response> {
  const execution = createExecutionContext(partialContext);

  const context: RuntimeRequestContext = {
    ...execution,
    request,
    services,
    log: (event) => createLogEvent(execution, event),
  };

  try {
    return await handler(context);
  } catch (error) {
    const response = toErrorResponse(error);

    return jsonResponse(response.body, {
      status: response.status,
    });
  }
}
