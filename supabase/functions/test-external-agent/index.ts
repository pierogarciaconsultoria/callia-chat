// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import { callExternalAgent, isValidExternalAgentUrl } from "../_shared/external-agent.ts";

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

const SECRET_REF_RE = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/;

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { workspaceId, body } = await requireAdminContext(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const secretRef = typeof body.secretRef === "string" ? body.secretRef.trim() : "";
    const timeoutMs = Number(body.timeoutMs ?? 25000);

    if (!isValidExternalAgentUrl(url)) {
      return jsonResponse({ ok: false, error: "invalid_url" }, { status: 400 });
    }
    if (secretRef && !SECRET_REF_RE.test(secretRef)) {
      return jsonResponse({ ok: false, error: "invalid_secret_ref" }, { status: 400 });
    }
    const secret = secretRef ? getEnv(secretRef) : "";
    if (secretRef && !secret) {
      return jsonResponse({ ok: false, error: "secret_not_found" }, { status: 200 });
    }

    const payload = {
      workspace_id: workspaceId,
      conversation_id: "00000000-0000-0000-0000-000000000000",
      message_id: "00000000-0000-0000-0000-000000000000",
      contact: { name: "Cliente Teste", phone: "+5511999999999" },
      message: { type: "text", text: "Olá! Esta é uma mensagem de teste do Callia Chat.", media_url: null },
      history: [],
      timestamp: new Date().toISOString(),
      test: true,
    };

    const result = await callExternalAgent({ url, secret: secret ?? "", timeoutMs, payload });
    return jsonResponse(
      {
        ok: result.ok,
        error: result.ok ? null : result.error,
        status: result.status,
        durationMs: result.durationMs,
        body: result.body,
        parsed: result.ok ? result.value : null,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 400;
    return jsonResponse({ ok: false, error: message }, { status });
  }
});
