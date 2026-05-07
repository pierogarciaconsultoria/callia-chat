// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import {
  generateRawApiKey,
  getApiKeyLast4,
  getApiKeyPrefix,
  sanitizeApiKeyRecord,
  sha256Hex,
} from "../_shared/api-keys.ts";
import { createAuditLog } from "../_shared/webhooks.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function createApiKeyRecord(supabase, input) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rawKey = generateRawApiKey();
    const keyHash = await sha256Hex(rawKey);

    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        prefix: getApiKeyPrefix(),
        key_hash: keyHash,
        last4: getApiKeyLast4(rawKey),
        created_by: input.userId,
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();

    if (!error) {
      return {
        rawKey,
        record: data,
      };
    }

    if (error.code !== "23505") {
      throw error;
    }
  }

  throw new Error("api_key_generation_failed");
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      userId,
      workspaceId,
      supabase,
      body,
    } = await requireAdminContext(request);
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "list") {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return jsonResponse(
        {
          ok: true,
          keys: (data ?? []).map(sanitizeApiKeyRecord),
        },
        { status: 200 },
      );
    }

    if (action === "create") {
      const name = normalizeName(body.name);
      if (!name) {
        return jsonResponse({ error: "name_required" }, { status: 400 });
      }

      const created = await createApiKeyRecord(supabase, {
        workspaceId,
        userId,
        name,
        metadata: asRecord(body.metadata) ?? {},
      });

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: "api_key.created",
        target: created.record.id,
        metadata: {
          name,
          prefix: created.record.prefix,
          last4: created.record.last4,
        },
      });

      return jsonResponse(
        {
          ok: true,
          key: sanitizeApiKeyRecord(created.record),
          rawKey: created.rawKey,
        },
        { status: 201 },
      );
    }

    const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId : null;
    if (!apiKeyId) {
      return jsonResponse({ error: "api_key_id_required" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("api_keys")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", apiKeyId)
      .maybeSingle();

    if (!existing) {
      return jsonResponse({ error: "api_key_not_found" }, { status: 404 });
    }

    if (action === "revoke") {
      const { data, error } = await supabase
        .from("api_keys")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: userId,
        })
        .eq("id", apiKeyId)
        .select("*")
        .single();

      if (error) throw error;

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: "api_key.revoked",
        target: apiKeyId,
        metadata: {
          name: data.name,
          last4: data.last4,
        },
      });

      return jsonResponse(
        {
          ok: true,
          key: sanitizeApiKeyRecord(data),
        },
        { status: 200 },
      );
    }

    if (action === "rotate") {
      await supabase
        .from("api_keys")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: userId,
        })
        .eq("id", apiKeyId);

      const created = await createApiKeyRecord(supabase, {
        workspaceId,
        userId,
        name: existing.name,
        metadata: existing.metadata ?? {},
      });

      await createAuditLog(supabase, {
        workspaceId,
        actorType: "user",
        actorId: userId,
        action: "api_key.rotated",
        target: created.record.id,
        metadata: {
          previous_api_key_id: existing.id,
          name: existing.name,
          last4: created.record.last4,
        },
      });

      return jsonResponse(
        {
          ok: true,
          rotatedFrom: sanitizeApiKeyRecord(existing),
          key: sanitizeApiKeyRecord(created.record),
          rawKey: created.rawKey,
        },
        { status: 200 },
      );
    }

    return jsonResponse({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "unauthorized" ? 401 :
      message === "forbidden" ? 403 :
      message === "workspace_required" ? 400 :
      500;

    return jsonResponse({ error: message }, { status });
  }
});
