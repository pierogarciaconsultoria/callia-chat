import type { ZodSchema } from "zod";
import { createRuntimeError } from "./errors";

export async function readJsonRequest<T>(
  request: Request,
  schema?: ZodSchema<T>,
): Promise<T> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw createRuntimeError("BAD_REQUEST", "Invalid JSON request body.");
  }

  if (!schema) {
    return payload as T;
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw createRuntimeError("BAD_REQUEST", "Request payload validation failed.", {
      issues: result.error.issues,
    });
  }

  return result.data;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function noContentResponse(init: ResponseInit = {}) {
  return new Response(null, {
    ...init,
    status: init.status ?? 204,
  });
}
