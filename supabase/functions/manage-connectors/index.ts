// Teste de conectores pelo painel (admin). A configuração é gravada direto via RLS em workspace_connectors.
import { createHandler, readJson, RuntimeError } from "../_shared/http.ts";
import { type HbookConfig, hbookLinkOnly } from "../_shared/hbook.ts";
import { adminDb, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";
import { assertActive, assertFeature, loadEntitlements } from "../_shared/entitlements.ts";

Deno.serve(createHandler("manage-connectors", async ({ req }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<{ action?: string; workspace_id?: string; checkin?: string; checkout?: string; adults?: number; children?: number; children_ages?: number[] }>(req);
  if (body.action !== "test_hbook") throw new RuntimeError("invalid_request", "Ação desconhecida.");
  await requireWorkspaceRole(user.id, body.workspace_id);
  const entitlements = await loadEntitlements(adminDb(), body.workspace_id as string);
  assertActive(entitlements);
  assertFeature(entitlements, "connectors_enabled");

  const { data } = await adminDb()
    .from("workspace_connectors")
    .select("config")
    .eq("workspace_id", body.workspace_id)
    .eq("kind", "hbook")
    .maybeSingle();
  // O teste funciona mesmo com o conector desligado, para validar antes de ativar.
  if (!data?.config?.base_url || !data.config.company_id) {
    throw new RuntimeError("unprocessable", "Salve base_url e company_id do hbook antes de testar.");
  }
  return hbookLinkOnly(data.config as HbookConfig, {
    checkin: body.checkin ?? "",
    checkout: body.checkout ?? "",
    adults: body.adults,
    children: body.children,
    childrenAges: Array.isArray(body.children_ages) ? body.children_ages : undefined,
  });
}));
