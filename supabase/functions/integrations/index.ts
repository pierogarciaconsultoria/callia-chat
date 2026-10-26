// Integrações simplificadas: o cliente informa o mínimo; o Callia descobre, testa e mostra o resultado.
import { createHandler, json, readJson, RuntimeError } from "../_shared/http.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { hospedinClientFor, loadAvailabilityProvider, loadConnectors, nextWeekend } from "../_shared/availability.ts";
import { assertActive, assertFeature, loadEntitlements } from "../_shared/entitlements.ts";
import { type HbookConfig, hbookLinkOnly } from "../_shared/hbook.ts";
import { accountFromClaims, detectPriceUnit, fetchHospedinAvailability, HospedinClient, type HospedinConfig } from "../_shared/hospedin.ts";
import { assertPublicHttpUrl } from "../_shared/net.ts";
import { adminDb, audit, type Db, env, optionalEnv, requireUser, requireWorkspaceRole } from "../_shared/supabase.ts";

type Body = Record<string, unknown> & { action?: string; workspace_id?: string };
const KINDS = ["hospedin", "hbook", "booking_link"] as const;
const TITLES: Record<string, string> = { whatsapp: "WhatsApp", hospedin: "Hospedin", hbook: "hbook", booking_link: "Link de reservas" };

async function listIntegrations(db: Db, workspaceId: string) {
  const [connectors, { data: instances }] = await Promise.all([
    db.from("workspace_connectors").select("kind, enabled, status, summary, config, last_checked_at, last_error").eq("workspace_id", workspaceId),
    db.from("whatsapp_instances").select("id, name, status, phone_number, profile_name, is_default, last_error").eq("workspace_id", workspaceId).order("is_default", { ascending: false }),
  ]);
  const open = (instances ?? []).find((i: { status: string }) => i.status === "open");
  const pending = (instances ?? []).find((i: { status: string }) => i.status === "qr" || i.status === "connecting");
  const whatsapp = {
    kind: "whatsapp",
    title: TITLES.whatsapp,
    status: open ? "connected" : pending ? "pending" : (instances ?? []).length ? "error" : "disconnected",
    summary: open ? `${open.phone_number ? `+${open.phone_number}` : open.name}${open.profile_name ? ` · ${open.profile_name}` : ""} conectado` : pending ? "Aguardando leitura do QR ou do código" : null,
    last_checked_at: null,
    last_error: open ? null : (instances ?? [])[0]?.last_error ?? null,
    details: { instance_id: (open ?? pending ?? (instances ?? [])[0])?.id ?? null, instances: (instances ?? []).length },
  };
  const rows = new Map((connectors.data ?? []).map((r: { kind: string }) => [r.kind, r]));
  const others = KINDS.map((kind) => {
    // deno-lint-ignore no-explicit-any
    const r: any = rows.get(kind);
    if (!r) return { kind, title: TITLES[kind], status: "disconnected", summary: null, last_checked_at: null, last_error: null, details: {} };
    const cfg = r.config ?? {};
    const details = kind === "hospedin"
      ? { account_id: cfg.account_id, account_name: cfg.account_name ?? null, categories: cfg.categories ?? [], price_unit: cfg.price_unit ?? "reais" }
      : kind === "booking_link" ? { booking_link: cfg.url ?? null }
      : {
        company_id: cfg.company_id,
        base_url: cfg.base_url,
        booking_link: cfg.base_url && cfg.company_id ? `${String(cfg.base_url).replace(/\/$/, "")}/Booking?companyId=${cfg.company_id}` : null,
      };
    return {
      kind,
      title: TITLES[kind],
      status: r.enabled ? r.status : "disconnected",
      summary: r.summary,
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
      details,
    };
  });
  return [whatsapp, ...others];
}

async function upsertConnector(db: Db, workspaceId: string, kind: string, patch: Record<string, unknown>) {
  const { error } = await db.from("workspace_connectors").upsert(
    { workspace_id: workspaceId, kind, enabled: true, ...patch },
    { onConflict: "workspace_id,kind" },
  );
  if (error) throw new RuntimeError("internal_error", "Falha ao salvar a integração.", { db: error.message });
}

function testQuery(body: Body) {
  const fallback = nextWeekend();
  const ages = Array.isArray(body.children_ages) ? body.children_ages.map(Number) : [];
  return {
    checkin: typeof body.checkin === "string" && body.checkin ? body.checkin : fallback.checkin,
    checkout: typeof body.checkout === "string" && body.checkout ? body.checkout : fallback.checkout,
    adults: body.adults === undefined ? 2 : Number(body.adults),
    childrenAges: ages,
  };
}

async function runTest(db: Db, workspaceId: string, kind: string, body: Body) {
  const connectors = await loadConnectors(db, workspaceId);
  const row = connectors.get(kind);
  if (!row) throw new RuntimeError("unprocessable", `Conecte o ${TITLES[kind] ?? kind} antes de testar.`);
  const q = testQuery(body);
  // Sem consulta automática no hbook: devolve o link de reserva sem marcar a integração com erro.
  if (kind === "hbook") hbookLinkOnly(row.config as unknown as HbookConfig, q);
  try {
    let result;
    if (kind === "hospedin") {
      if (!row.secret_ciphertext) throw new RuntimeError("unprocessable", "Reconecte o Hospedin.");
      const provider = await loadAvailabilityProvider(db, workspaceId);
      result = provider?.kind === "hospedin"
        ? await provider.fn(q)
        : await fetchHospedinAvailability(row.config as unknown as HospedinConfig, await hospedinClientFor(row.secret_ciphertext), q);
    } else {
      throw new RuntimeError("invalid_request", "Esta integração não tem consulta de disponibilidade.");
    }
    await db.from("workspace_connectors").update({ status: "connected", last_checked_at: new Date().toISOString(), last_error: null })
      .eq("workspace_id", workspaceId).eq("kind", kind);
    return { provider: kind, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("workspace_connectors").update({ status: "error", last_checked_at: new Date().toISOString(), last_error: message.slice(0, 300) })
      .eq("workspace_id", workspaceId).eq("kind", kind);
    throw err;
  }
}

Deno.serve(createHandler("integrations", async ({ req, correlationId }) => {
  if (req.method !== "POST") throw new RuntimeError("invalid_request", "Use POST.");
  const user = await requireUser(req);
  const body = await readJson<Body>(req);
  const db = adminDb();
  await requireWorkspaceRole(user.id, body.workspace_id);
  const workspaceId = body.workspace_id as string;
  const log = (action: string, details: Record<string, unknown> = {}) =>
    audit(db, { workspace_id: workspaceId, actor_user_id: user.id, action: `integration.${action}`, entity: "workspace_connector", details, correlation_id: correlationId });
  const requireConnectable = async () => {
    const entitlements = await loadEntitlements(db, workspaceId);
    assertActive(entitlements);
    assertFeature(entitlements, "connectors_enabled");
  };

  switch (body.action) {
    case "list":
      return json({ integrations: await listIntegrations(db, workspaceId) });

    case "connect_hospedin": {
      await requireConnectable();
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) throw new RuntimeError("invalid_request", "Informe o e-mail e a senha do usuário do Hospedin.");

      const client = new HospedinClient({ email, password }, { baseUrl: optionalEnv("HOSPEDIN_BASE_URL") });
      const { claims } = await client.login(true);
      const informed = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
      const accountId = informed ?? accountFromClaims(claims);
      if (!accountId) {
        throw new RuntimeError("unprocessable", "Login feito, mas não foi possível descobrir a conta. Informe o identificador da conta do Hospedin.", { needs: "account_id" });
      }
      let accountName: string | null = null;
      let placeTypes;
      try {
        accountName = (await client.myAccount(accountId).catch(() => ({ name: null }))).name;
        placeTypes = await client.placeTypes(accountId);
      } catch (err) {
        if (err instanceof RuntimeError && err.code === "not_found") {
          throw new RuntimeError("unprocessable", "Conta não encontrada no Hospedin. Confira o identificador da conta.", { needs: "account_id" });
        }
        throw err;
      }
      if (!placeTypes.length) throw new RuntimeError("unprocessable", "Nenhuma categoria de quarto ativa encontrada nesta conta do Hospedin.");

      // Unidade do preço pela amostra de 30 dias da primeira categoria.
      const start = new Date();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const sample = await client.rates(accountId, placeTypes[0].id, iso(start), iso(new Date(start.getTime() + 30 * 86_400_000))).catch(() => []);
      const priceUnit = detectPriceUnit(sample.map((r) => Number(r.rate_price)));
      const categories = placeTypes.map((p) => ({ id: p.id, title: p.title, occupants: p.occupants ?? null }));

      await upsertConnector(db, workspaceId, "hospedin", {
        config: { account_id: accountId, account_name: accountName, price_unit: priceUnit, categories, currency: "BRL" },
        secret_ciphertext: await encryptSecret(JSON.stringify({ email, password }), env("CALLIA_ENCRYPTION_KEY")),
        status: "connected",
        summary: `${accountName ?? accountId} · ${categories.length} categoria(s)`,
        last_checked_at: new Date().toISOString(),
        last_error: null,
      });
      await log("hospedin.connected", { account_id: accountId, categories: categories.length, price_unit: priceUnit, user: email });
      // Conexão vale mesmo se o teste falhar; o painel mostra o aviso e o botão Testar.
      let test = null;
      let testError: string | null = null;
      try {
        test = await runTest(db, workspaceId, "hospedin", body);
      } catch (err) {
        testError = err instanceof Error ? err.message : String(err);
      }
      const integration = (await listIntegrations(db, workspaceId)).find((i) => i.kind === "hospedin");
      return json({ integration, test, test_error: testError });
    }

    case "test": {
      await requireConnectable();
      const kind = String(body.kind ?? "");
      return json({ test: await runTest(db, workspaceId, kind, body) });
    }

    case "set_price_unit": {
      const unit = body.unit === "cents" ? "cents" : body.unit === "reais" ? "reais" : null;
      if (!unit) throw new RuntimeError("invalid_request", "unit deve ser reais ou cents.");
      const connectors = await loadConnectors(db, workspaceId);
      const row = connectors.get("hospedin");
      if (!row) throw new RuntimeError("unprocessable", "Conecte o Hospedin primeiro.");
      await db.from("workspace_connectors").update({ config: { ...row.config, price_unit: unit } }).eq("workspace_id", workspaceId).eq("kind", "hospedin");
      await log("hospedin.price_unit", { unit });
      return json({ integration: (await listIntegrations(db, workspaceId)).find((i) => i.kind === "hospedin") });
    }

    case "sync_catalog": {
      await requireConnectable();
      const connectors = await loadConnectors(db, workspaceId);
      const row = connectors.get("hospedin");
      if (!row?.secret_ciphertext) throw new RuntimeError("unprocessable", "Conecte o Hospedin primeiro.");
      const client = await hospedinClientFor(row.secret_ciphertext);
      const placeTypes = await client.placeTypes(String(row.config.account_id));
      const { data: products } = await db.from("products").select("id, name").eq("workspace_id", workspaceId);
      const byName = new Map((products ?? []).map((p: { id: string; name: string }) => [p.name.trim().toLowerCase(), p.id]));
      let created = 0;
      let updated = 0;
      for (const p of placeTypes) {
        const description = [p.occupants ? `Até ${p.occupants} pessoa(s).` : null, p.note?.trim() || null].filter(Boolean).join(" ") || null;
        const existing = byName.get(p.title.trim().toLowerCase());
        if (existing) {
          await db.from("products").update({ description }).eq("id", existing);
          updated++;
        } else {
          await db.from("products").insert({ workspace_id: workspaceId, name: p.title, description, currency: "BRL" });
          created++;
        }
      }
      await log("hospedin.catalog_synced", { created, updated });
      return json({ created, updated });
    }

    case "save_booking_link": {
      await requireConnectable();
      const url = assertPublicHttpUrl(body.booking_link, "booking_link");
      await upsertConnector(db, workspaceId, "booking_link", {
        config: { url },
        status: "connected",
        summary: new URL(url).hostname,
        last_checked_at: new Date().toISOString(),
        last_error: null,
      });
      await log("booking_link.saved", { url });
      return json({ integration: (await listIntegrations(db, workspaceId)).find((i) => i.kind === "booking_link") });
    }

    case "disconnect": {
      const kind = String(body.kind ?? "");
      if (!(KINDS as readonly string[]).includes(kind)) {
        throw new RuntimeError("invalid_request", kind === "whatsapp" ? "Para o WhatsApp, use Desconectar no cartão do WhatsApp." : "Integração desconhecida.");
      }
      // Remover a linha apaga também as credenciais cifradas.
      await db.from("workspace_connectors").delete().eq("workspace_id", workspaceId).eq("kind", kind);
      await log(`${kind}.disconnected`);
      return json({ ok: true });
    }

    default:
      throw new RuntimeError("invalid_request", "Ação desconhecida.");
  }
}));
