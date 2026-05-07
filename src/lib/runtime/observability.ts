export type RuntimeLogLevel = "info" | "warn" | "error";

export interface RuntimeLogEvent {
  level: RuntimeLogLevel;
  message: string;
  correlationId: string;
  workspaceId?: string;
  conversationId?: string;
  messageId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RuntimeExecutionContext {
  correlationId: string;
  workspaceId?: string;
  conversationId?: string;
  messageId?: string;
}

export function createCorrelationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `corr-${Math.random().toString(36).slice(2, 10)}`;
}

export function createExecutionContext(
  partial: Partial<RuntimeExecutionContext> = {},
): RuntimeExecutionContext {
  return {
    correlationId: partial.correlationId ?? createCorrelationId(),
    workspaceId: partial.workspaceId,
    conversationId: partial.conversationId,
    messageId: partial.messageId,
  };
}

export function createLogEvent(
  context: RuntimeExecutionContext,
  event: Omit<RuntimeLogEvent, "correlationId" | "createdAt">,
): RuntimeLogEvent {
  return {
    ...event,
    correlationId: context.correlationId,
    createdAt: new Date().toISOString(),
    workspaceId: event.workspaceId ?? context.workspaceId,
    conversationId: event.conversationId ?? context.conversationId,
    messageId: event.messageId ?? context.messageId,
  };
}
