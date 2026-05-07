// @ts-nocheck
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, content-type",
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

export function createAnonClient(authHeader: string | null) {
  const supabaseUrl = getEnv("SUPABASE_URL") ?? "";
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY") ?? "";

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

export function createServiceClient() {
  const supabaseUrl = getEnv("SUPABASE_URL") ?? "";
  const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function requireAdminContext(request: Request): Promise<{
  userId: string;
  workspaceId: string;
  supabase: SupabaseClient;
  body: Record<string, unknown>;
}> {
  const authHeader = request.headers.get("Authorization");
  const anonClient = createAnonClient(authHeader);
  const serviceClient = createServiceClient();

  const { data: authData, error: authError } = await anonClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("unauthorized");
  }

  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) {
    throw new Error("workspace_required");
  }

  const { data: member } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new Error("forbidden");
  }

  return {
    userId: authData.user.id,
    workspaceId,
    supabase: serviceClient,
    body,
  };
}

export async function requireWorkspaceMemberContext(request: Request): Promise<{
  userId: string;
  workspaceId: string;
  supabase: SupabaseClient;
  body: Record<string, unknown>;
}> {
  const authHeader = request.headers.get("Authorization");
  const anonClient = createAnonClient(authHeader);
  const serviceClient = createServiceClient();

  const { data: authData, error: authError } = await anonClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("unauthorized");
  }

  const body = (await request.json()) as Record<string, unknown>;
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) {
    throw new Error("workspace_required");
  }

  const { data: member } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!member) {
    throw new Error("forbidden");
  }

  return {
    userId: authData.user.id,
    workspaceId,
    supabase: serviceClient,
    body,
  };
}
