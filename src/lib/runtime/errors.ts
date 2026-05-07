export type RuntimeErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EXTERNAL_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createRuntimeError(
  code: RuntimeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): RuntimeError {
  const statusMap: Record<RuntimeErrorCode, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    EXTERNAL_PROVIDER_ERROR: 502,
    INTERNAL_ERROR: 500,
  };

  return new RuntimeError(code, message, statusMap[code], details);
}

export function toErrorResponse(error: unknown) {
  if (error instanceof RuntimeError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected runtime error.",
        details: null,
      },
    },
  };
}
