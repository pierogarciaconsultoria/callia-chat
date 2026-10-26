// Gateway (/rest/v1 → PostgREST, /functions/v1 → edge-runtime) + Evolution falsa + OpenAI falsa + receptor de webhooks.
// Uso: deno run -A scripts/e2e/mock.ts <bind-ip> <postgrest-url> <functions-url> <gotrue-url>
const [bind, postgrest, functions, gotrue, storage] = Deno.args;
type Call = { at: string; path: string; headers: Record<string, string>; body: unknown };
const calls: Record<string, Call[]> = { evolution: [], openai: [], hook: [] };
let evoSeq = 0;

const record = async (kind: string, req: Request, path: string) => {
  const text = await req.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* texto puro */ }
  calls[kind].push({ at: new Date().toISOString(), path, headers: Object.fromEntries(req.headers), body });
  return body as Record<string, unknown>;
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

async function proxy(req: Request, target: string): Promise<Response> {
  const url = new URL(req.url);
  const res = await fetch(target + url.search, { method: req.method, headers: req.headers, body: req.body, redirect: "manual" });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

// Gateway no estilo Kong
Deno.serve({ hostname: bind, port: 54320, onListen: () => {} }, (req) => {
  const { pathname } = new URL(req.url);
  if (pathname.startsWith("/rest/v1")) return proxy(req, postgrest + pathname.slice("/rest/v1".length));
  if (pathname.startsWith("/functions/v1")) return proxy(req, functions + pathname.slice("/functions/v1".length));
  if (pathname.startsWith("/auth/v1")) return proxy(req, gotrue + pathname.slice("/auth/v1".length));
  if (pathname.startsWith("/storage/v1")) return proxy(req, storage + pathname.slice("/storage/v1".length));
  return json({ error: "no route" }, 404);
});

// Serviços externos falsos
Deno.serve({ hostname: bind, port: 54321, onListen: () => console.log("mock ready") }, async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/__calls") return json(calls);
  if (pathname === "/__reset") { for (const k of Object.keys(calls)) calls[k] = []; return json({ ok: true }); }

  if (pathname.startsWith("/evo/")) {
    const path = pathname.slice(4);
    if (req.headers.get("apikey") !== "evo-test-key") return json({ message: "unauthorized" }, 401);
    const body = await record("evolution", req, path + new URL(req.url).search);
    if (path.startsWith("/message/send")) return json({ key: { id: `EVO-${++evoSeq}`, fromMe: true, remoteJid: `${body?.number}@s.whatsapp.net` }, status: "PENDING" });
    if (path.startsWith("/instance/connectionState")) return json({ instance: { state: "open" } });
    if (path.startsWith("/instance/connect/")) {
      const number = new URL(req.url).searchParams.get("number");
      return json(number ? { pairingCode: "WZYX1234", code: "2@abc" } : { base64: "iVBORw0KGgoAAAANSUhEUg==" });
    }
    if (path.startsWith("/instance/create")) return json({ instance: { instanceName: body?.instanceName }, qrcode: { base64: "iVBORw0KGgoAAAANSUhEUg==" } });
    return json({ ok: true });
  }

  if (pathname.startsWith("/openai/")) {
    const body = await record("openai", req, pathname.slice(7));
    // Assistente de configuração: resposta estruturada (json_schema).
    if ((body?.response_format as { type?: string })?.type === "json_schema") {
      const draft = {
        business: { name: "Pousada Mar", summary: "Pousada pé na areia em Garopaba.", segment: "hospedagem", city: "Garopaba", address: null, phone: null, whatsapp: null, email: null, website_url: "https://pousadamar.example", instagram: "@pousadamar", tone_observed: "acolhedor" },
        agent: { agent_name: "Lia", language: "pt-BR", persona_prompt: "Você é a Lia, recepcionista virtual da Pousada Mar, pé na areia em Garopaba. Seja acolhedora e objetiva.", guardrails: "- Envie o link de reserva quando o hóspede quiser reservar." },
        business_hours: { timezone: "America/Sao_Paulo", weekly: { mon: [{ start: "08:00", end: "20:00" }], tue: [{ start: "08:00", end: "20:00" }], wed: [], thu: [], fri: [], sat: [], sun: [] } },
        handoff: { keywords: ["atendente", "falar com alguém"], message: "Já chamo alguém da recepção!", out_of_hours_message: "A recepção volta às 8h." },
        payment_links: [],
        faqs: [
          { question: "Tem café da manhã?", answer: "Sim, incluso na diária, das 8h às 10h.", source: "Quartos" },
          { question: "Aceitam pets?", answer: "Sim, pets de pequeno porte.", source: "Instagram @pousadamar" },
        ],
        products: [{ name: "Suíte Mar", description: "Varanda com vista para o mar.", price: null, currency: "BRL", url: null }],
        missing_information: [{ topic: "Cancelamento", question: "Qual a política de cancelamento?" }],
        sources_used: [{ title: "Quartos", kind: "site" }],
      };
      return json({ choices: [{ message: { role: "assistant", content: JSON.stringify(draft) } }], usage: { prompt_tokens: 5000, completion_tokens: 800, total_tokens: 5800 } });
    }
    const messages = (body?.messages ?? []) as Array<{ role: string; content: string }>;
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const reply = (content: string | null, tool_calls?: unknown[]) =>
      json({ choices: [{ message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    const last = messages[messages.length - 1] as { role: string; content: string };
    if (last?.role === "tool") {
      try {
        const result = JSON.parse(last.content);
        if (result.enviadas) return reply(`Seguem ${result.enviadas} fotos do ${result.album} 👇`);
        const rooms = (result.rooms ?? []).map((r: { name: string; total_price: number }) => `${r.name} R$ ${r.total_price}`).join("; ");
        return reply(rooms ? `Temos: ${rooms}. Reserve em ${result.booking_link}` : `Sem vagas. ${result.link_reserva ?? ""}`);
      } catch { /* segue */ }
    }
    const tools = ((body?.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
    if (/foto/i.test(lastUser) && tools.includes("enviar_fotos")) {
      return reply(null, [{ id: "call_ph", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"apto familia","quantidade":5}' } }]);
    }
    if (/vaga/i.test(lastUser) && tools.includes("consultar_disponibilidade")) {
      return reply(null, [{ id: "call_av", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"20/12/2026","checkout":"22/12/2026","adultos":2,"idades_criancas":[6]}' } }]);
    }
    if (/reclama/i.test(lastUser)) {
      return reply(null, [{ id: "call_1", type: "function", function: { name: "transferir_para_atendente", arguments: '{"motivo":"reclamação"}' } }]);
    }
    if (/caf[eé]/i.test(lastUser) && system.includes("Servimos café das 7h às 10h")) return reply("**Bom dia!** O café é servido das 7h às 10h.");
    return reply("Posso ajudar com mais alguma coisa?");
  }

  if (pathname === "/hook") {
    await record("hook", req, pathname);
    return json({ received: true });
  }
  return json({ error: "no route" }, 404);
});

// Site e Instagram falsos (alcançados pelas functions como http://mock:54322).
const site: Record<string, [string, string]> = {
  "/robots.txt": ["text/plain", "User-agent: *\nDisallow: /privado"],
  "/": ["text/html", `<title>Pousada Mar</title><p>${"Pousada pé na areia em Garopaba, com vista para o mar. ".repeat(4)}</p><a href="/quartos">Quartos</a><a href="/privado">Área restrita</a><a href="https://externo.example/">Parceiro</a>`],
  "/quartos": ["text/html", `<title>Quartos</title><p>${"Suíte Mar com varanda; café da manhã incluso das 8h às 10h. ".repeat(4)}</p>`],
  "/privado": ["text/html", `<p>${"conteúdo que o robots.txt bloqueia. ".repeat(5)}</p>`],
  "/ig/pousadamar/": ["text/html", `<meta property="og:title" content="Pousada Mar (@pousadamar) &#x2022; Instagram"><meta property="og:description" content="1.200 seguidores - Pousada Mar no Instagram: &quot;Pé na areia 🌊 Aceitamos pets de pequeno porte&quot;">`],
};
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function hospedin(req: Request, path: string): Promise<Response> {
  if (path === "/api/v2/authentication/sessions") {
    const body = await req.json().catch(() => ({}));
    if (body.email !== "integracao@hotel.test" || body.password !== "senha-certa") return json({ errors: ["Invalid email"] }, 401);
    return json({ token: `${b64url({ alg: "HS256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600, account_slug: "morada-e2e" })}.sig`, user: { id: 7, email: body.email } });
  }
  if (!(req.headers.get("authorization") ?? "").startsWith("Bearer ")) return json({ errors: ["Unauthorized"] }, 401);
  if (!path.startsWith("/api/v2/morada-e2e/")) return json({ errors: ["Not found"] }, 404);
  const rest = path.slice("/api/v2/morada-e2e".length);
  if (rest === "/my_account") return json({ data: { name: "Morada E2E" } });
  if (rest === "/place_types") {
    const page = Number(new URL(req.url).searchParams.get("page") ?? 1);
    return json(page === 1
      ? { pagination: { page: 1, last: 2 }, data: [{ id: 11, title: "Apto Casal", occupants: 2, status: true, attachments: [{ id: 901, file: "http://mock:54322/img/casal-1.jpg" }, { id: 902, file: "http://mock:54322/img/casal-2.jpg" }] }] }
      : { pagination: { page: 2, last: 2 }, data: [{ id: 12, title: "Apto Família", occupants: 4, status: true, note: "Varanda" }] });
  }
  const m = /^\/place_types\/(\d+)\/rates_and_availabilities$/.exec(rest);
  if (m) {
    const u = new URL(req.url);
    const begin = new Date(u.searchParams.get("begin_date") + "T00:00:00Z").getTime();
    const end = new Date(u.searchParams.get("end_date") + "T00:00:00Z").getTime();
    const days = [];
    for (let t = begin; t <= end; t += 86_400_000) days.push({ date: new Date(t).toISOString().slice(0, 10), rate_price: m[1] === "11" ? 320 : 480, availability: 2 });
    return json(days);
  }
  return json({ errors: ["Not found"] }, 404);
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const driveEntry = (id: string, name: string, folder = false) =>
  `<div class="flip-entry" id="entry-${id}"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? `drive/folders/${id}` : `file/d/${id}/view`}"><div class="flip-entry-title">${name}</div></a></div></div>`;
const driveFolders: Record<string, string> = {
  ROOTFOLDER1234567890: driveEntry("FAMFOLDER", "01 - Apto Família", true) + driveEntry("CHUFOLDER", "Churrasqueira", true) + driveEntry("README", "leia-me.txt"),
  FAMFOLDER: driveEntry("FAM1", "sala.jpg") + driveEntry("FAM2", "quarto.HEIC"),
  CHUFOLDER: driveEntry("CHU1", "churrasqueira.png"),
};

Deno.serve({ hostname: bind, port: 54322, onListen: () => {} }, (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === "/gdrive/embeddedfolderview") {
    const html = driveFolders[new URL(req.url).searchParams.get("id") ?? ""];
    return html ? new Response(`<html><body>${html}</body></html>`, { headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 });
  }
  if (pathname === "/gdrive/thumbnail" || pathname.startsWith("/img/")) return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  if (pathname.startsWith("/hospedin/")) return hospedin(req, pathname.slice("/hospedin".length));
  const page = site[new URL(req.url).pathname];
  return page ? new Response(page[1], { headers: { "content-type": page[0] } }) : new Response("not found", { status: 404 });
});
