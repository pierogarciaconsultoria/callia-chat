import { describe, expect, it, vi } from "vitest";
import { encryptSecret, hmacSha256Hex } from "../../supabase/functions/_shared/crypto.ts";
import { deliverWebhook, retryDelaySeconds, signWebhook } from "../../supabase/functions/_shared/webhooks.ts";
import { looksAutomatedFromPhone } from "../../supabase/functions/_shared/evolution.ts";

const master = "k".repeat(40);

/** Fake mínimo do query builder do supabase-js para webhook_deliveries. */
function fakeDb(delivery: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    updates,
    from: () => {
      const builder: Record<string, unknown> = {};
      let pendingUpdate: Record<string, unknown> | null = null;
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        update: (patch: Record<string, unknown>) => { pendingUpdate = patch; updates.push(patch); return builder; },
        maybeSingle: async () => ({ data: pendingUpdate ? { ...delivery, ...pendingUpdate } : delivery }),
      });
      return builder;
    },
  };
  return db;
}

describe("assinatura de webhooks", () => {
  it("assina timestamp.corpo com HMAC-SHA256", async () => {
    const sig = await signWebhook("segredo", "1792900000", '{"a":1}');
    expect(sig).toBe(`sha256=${await hmacSha256Hex("segredo", '1792900000.{"a":1}')}`);
  });

  it("backoff cresce e satura em 2h", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelaySeconds)).toEqual([30, 120, 600, 1800, 3600, 7200, 7200]);
  });
});

describe("entrega de webhooks", () => {
  async function delivery(overrides: Record<string, unknown> = {}) {
    return {
      id: "d1", workspace_id: "ws", webhook_id: "w1", event: "message.received", payload: { id: "d1", data: { x: 1 } },
      attempts: 0, status: "pending", correlation_id: "corr",
      webhooks: { url: "https://cliente.example/hook", secret_ciphertext: await encryptSecret("whsec", master), max_attempts: 3, active: true },
      ...overrides,
    };
  }

  it("envia headers assinados e marca sucesso", async () => {
    const db = fakeDb(await delivery());
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await deliverWebhook(db, "d1", master, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h["x-callia-event"]).toBe("message.received");
    expect(h["x-callia-attempt"]).toBe("1");
    expect(h["x-callia-signature"]).toBe(await signWebhook("whsec", h["x-callia-timestamp"], String(init.body)));
    expect(db.updates[0]).toMatchObject({ status: "success", attempts: 1, last_status_code: 200 });
  });

  it("agenda retentativa em falha e desiste ao atingir o limite", async () => {
    const db = fakeDb(await delivery());
    await deliverWebhook(db, "d1", master, async () => new Response("erro", { status: 503 }));
    expect(db.updates[0]).toMatchObject({ status: "retrying", attempts: 1, last_error: "HTTP 503" });

    const last = fakeDb(await delivery({ attempts: 2 }));
    await deliverWebhook(last, "d1", master, async () => { throw new TypeError("connection refused"); });
    expect(last.updates[0]).toMatchObject({ status: "failed", attempts: 3 });
  });
});

describe("mensagem automática do WhatsApp Business enviada pelo celular", () => {
  it("saudação longa 4 s depois do cliente é automática (caso real da Morada)", () => {
    const greeting = "Olá.Esperamos encontrá-lo bem. 🙏Agradecemos o contato e caso desejas apenas realizar cotação e disponibilidade, em nosso site, link abaixo é possível realizar cotação on line e consultar disponibilidade.";
    expect(looksAutomatedFromPhone(greeting, "2026-10-26T20:46:53Z", "2026-10-26T20:46:49Z")).toBe(true);
  });

  it("resposta curta ou digitada com calma é da equipe", () => {
    expect(looksAutomatedFromPhone("Oi, já te respondo!", "2026-10-26T20:46:53Z", "2026-10-26T20:46:49Z")).toBe(false);
    expect(looksAutomatedFromPhone("Boa tarde! Temos vaga sim para essas datas, posso reservar para você?", "2026-10-26T20:47:40Z", "2026-10-26T20:46:49Z")).toBe(false);
    expect(looksAutomatedFromPhone("Texto longo qualquer enviado bem depois da mensagem do cliente, sem pressa nenhuma.", "2026-10-26T21:00:00Z", "2026-10-26T20:46:49Z")).toBe(false);
  });
});
