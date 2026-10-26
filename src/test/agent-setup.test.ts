import { describe, expect, it, vi } from "vitest";
import { canonicalUrl, cleanPages, crawlSite, extractLinks, isPlaceholderLine, linkScore, parseRobots, robotsAllows, sameSite } from "../../supabase/functions/_shared/site-crawler.ts";
import { fetchInstagramProfile, parseInstagramHandle, parseInstagramMeta } from "../../supabase/functions/_shared/instagram.ts";
import { assembleMaterials, buildSetupMessages, normalizeDraft, sameQuestion } from "../../supabase/functions/_shared/agent-setup.ts";

describe("leitura do site", () => {
  it("normaliza URLs e reconhece o mesmo site com e sem www", () => {
    expect(canonicalUrl("/quartos/?utm=x#topo", "https://pousada.com.br/")).toBe("https://pousada.com.br/quartos");
    expect(canonicalUrl("mailto:a@b.com")).toBeNull();
    expect(sameSite(new URL("https://www.pousada.com.br"), new URL("https://pousada.com.br/x"))).toBe(true);
    expect(sameSite(new URL("https://pousada.com.br"), new URL("https://booking.com"))).toBe(false);
  });

  it("extrai links e prioriza páginas úteis ao atendimento", () => {
    const links = extractLinks(`<a href="/sobre">Quem somos</a><a href="tel:123">ligar</a><a href='/blog/tag/praia'>tag</a>`, "https://p.com/");
    expect(links.map((l) => l.url)).toEqual(["https://p.com/sobre", "https://p.com/blog/tag/praia"]);
    expect(linkScore("https://p.com/acomodacoes")).toBeGreaterThan(linkScore("https://p.com/blog/2024/05/post"));
    expect(linkScore("https://p.com/blog/tag/praia")).toBeLessThan(0);
  });

  it("respeita robots.txt (grupo *, Allow mais específico e fim de URL)", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nDisallow: /*.php$\nAllow: /admin/publico\nSitemap: https://p.com/sitemap.xml");
    expect(rules.sitemaps).toEqual(["https://p.com/sitemap.xml"]);
    expect(robotsAllows(rules, "/quartos")).toBe(true);
    expect(robotsAllows(rules, "/admin/config")).toBe(false);
    expect(robotsAllows(rules, "/admin/publico/x")).toBe(true);
    expect(robotsAllows(rules, "/index.php")).toBe(false);
    expect(robotsAllows(rules, "/index.php?x=1")).toBe(true);
  });

  it("percorre o site dentro do domínio, sem páginas bloqueadas, duplicadas ou externas", async () => {
    const pages: Record<string, string> = {
      "https://p.com/robots.txt": "User-agent: *\nDisallow: /privado",
      "https://p.com/": `<title>Pousada P</title><p>${"Bem-vindo à Pousada P, à beira-mar. ".repeat(5)}</p><a href="/quartos">Quartos</a><a href="/privado">x</a><a href="https://outro.com/">fora</a><a href="/copia">cópia</a>`,
      "https://p.com/quartos": `<title>Quartos</title><p>${"Suíte Mar com varanda e café da manhã incluso. ".repeat(4)}</p>`,
      "https://p.com/privado": "<p>segredo segredo segredo segredo segredo segredo segredo segredo segredo segredo</p>",
    };
    pages["https://p.com/copia"] = pages["https://p.com/"];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = pages[url];
      return body === undefined
        ? new Response("not found", { status: 404 })
        : new Response(body, { status: 200, headers: { "content-type": url.endsWith(".txt") ? "text/plain" : "text/html" } });
    });
    const out = await crawlSite("https://p.com", { maxPages: 10, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.pages.map((p) => p.url).sort()).toEqual(["https://p.com/", "https://p.com/quartos"]);
    expect(out.pages.find((p) => p.url.endsWith("/quartos"))?.title).toBe("Quartos");
    expect(out.skipped.robots).toBe(1);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).startsWith("https://outro.com"))).toBe(false);
    const ua = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(ua["User-Agent"]).toMatch(/^CalliaChat-SiteReader/);
  });

  it("tira menu/rodapé repetidos das páginas e descarta contatos de modelo", () => {
    const header = "Home\nAcomodações\nContato\n555-555-5555\nmeuemail@email.com.br\nRua Nereu Ramos, 341 – Centro, Garopaba";
    const pages = [
      { url: "https://h.com/", title: "Início", text: `${header}\nApartamentos completos no centro de Garopaba, a 300 m da praia.` },
      { url: "https://h.com/quartos", title: "Quartos", text: `${header}\nApartamentos 101 a 204 para até 3 pessoas, com cozinha completa.` },
      { url: "https://h.com/contato", title: "Contato", text: `${header}\nFicou com alguma dúvida? Fale conosco pelo WhatsApp (48) 3333-4444.` },
    ];
    const out = cleanPages(pages);
    const all = out.map((p) => p.text).join("\n");
    expect(all).not.toMatch(/555-555-5555|meuemail@email/);
    expect(out.find((p) => p.url.endsWith("/quartos"))?.text).toBe("Apartamentos 101 a 204 para até 3 pessoas, com cozinha completa.");
    const shared = out.find((p) => p.title === "Informações comuns do site");
    expect(shared?.text).toContain("Rua Nereu Ramos, 341");
    expect(all.match(/Rua Nereu Ramos/g)).toHaveLength(1);
    expect(isPlaceholderLine("(48) 3333-4444")).toBe(false);
    expect(isPlaceholderLine("Telefone: 555-555-5555")).toBe(true);
  });

  it("recusa sites na rede interna", async () => {
    await expect(crawlSite("http://192.168.0.10/")).rejects.toThrow(/interno/);
  });
});

describe("Instagram", () => {
  it("aceita @perfil, perfil e links", () => {
    expect(parseInstagramHandle("@Pousada.Mar")).toBe("pousada.mar");
    expect(parseInstagramHandle("https://www.instagram.com/pousadamar/?igsh=abc")).toBe("pousadamar");
    expect(parseInstagramHandle("https://instagram.com/p/XYZ")).toBeNull();
    expect(parseInstagramHandle("não é perfil")).toBeNull();
  });

  it("lê nome e bio das metatags públicas", () => {
    const html = `<meta property="og:title" content="Pousada Mar (@pousadamar) &#x2022; Instagram" />
      <meta property="og:description" content="1.234 seguidores, 10 seguindo, 99 posts - Pousada Mar no Instagram: &quot;Pé na areia em Garopaba 🌊 Reservas pelo link&quot;" />`;
    expect(parseInstagramMeta(html)).toMatchObject({ title: "Pousada Mar (@pousadamar) • Instagram", bio: "Pé na areia em Garopaba 🌊 Reservas pelo link" });
  });

  it("bloqueio ou tela de login vira aviso, sem tentar contornar", async () => {
    const blocked = await fetchInstagramProfile("pousadamar", { fetchImpl: (async () => new Response("", { status: 429 })) as unknown as typeof fetch });
    expect(blocked).toMatchObject({ fetched: false, text: null });
    expect(blocked.note).toMatch(/Cole a bio/);
  });
});

describe("rascunho de configuração", () => {
  const raw = {
    business: { name: "Pousada Mar", summary: "Pousada pé na areia", segment: "hospedagem", city: "Garopaba", address: null, phone: null, whatsapp: null, email: null, website_url: "https://pousadamar.com.br", instagram: "@pousadamar", tone_observed: "acolhedor" },
    agent: { agent_name: " Lia ", language: "pt-BR", persona_prompt: "Você é a Lia, recepcionista virtual da Pousada Mar.", guardrails: "- Envie o link de reserva." },
    business_hours: { timezone: "America/Sao_Paulo", weekly: { mon: [{ start: "8:00", end: "18h" }], tue: [{ start: "xx", end: "18:00" }], wed: [], thu: [], fri: [], sat: [], sun: [] } },
    handoff: { keywords: ["Atendente", "atendente", "falar com alguém", "x"], message: "Já chamo a equipe!", out_of_hours_message: "" },
    payment_links: [{ label: "Reservas", url: "https://reservas.example/p", description: null }, { label: "Pix", url: "chave-pix", description: null }],
    faqs: [
      { question: "Tem café da manhã?", answer: "Sim, das 8h às 10h.", source: "Site" },
      { question: "Tem cafe da manha", answer: "duplicada", source: "Instagram" },
    ],
    products: [{ name: "Suíte Mar", description: "Vista para o mar", price: 450.555, currency: "brl", url: "https://pousadamar.com.br/suite" }],
    missing_information: [{ topic: "Cancelamento", question: "Qual a política de cancelamento?" }],
    sources_used: [{ title: "pousadamar.com.br", kind: "site" }],
  };

  it("normaliza horário, palavras-chave, links, perguntas duplicadas e preços", () => {
    const d = normalizeDraft(raw);
    expect(d.agent.agent_name).toBe("Lia");
    expect(d.business_hours?.weekly.mon).toEqual([["08:00", "18:00"]]);
    expect(d.business_hours?.weekly.tue).toEqual([]);
    expect(d.handoff.keywords).toEqual(["atendente", "falar com alguém"]);
    expect(d.handoff.out_of_hours_message).toBeNull();
    expect(d.payment_links).toEqual([{ label: "Reservas", url: "https://reservas.example/p", description: null }]);
    expect(d.faqs).toHaveLength(1);
    expect(d.products[0]).toMatchObject({ price: 450.56, currency: "BRL" });
  });

  it("sem horário nas fontes, business_hours fica nulo", () => {
    const empty = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((k) => [k, []]));
    expect(normalizeDraft({ ...raw, business_hours: { timezone: "America/Sao_Paulo", weekly: empty } }).business_hours).toBeNull();
  });

  it("divide o orçamento entre as fontes e avisa quais foram cortadas", () => {
    const { text, truncated } = assembleMaterials([
      { title: "Site", kind: "site", url: "https://p.com", content: "a".repeat(5000) },
      { title: "Instagram", kind: "social", url: null, content: "b".repeat(100) },
    ], 1000);
    expect(truncated).toEqual(["Site"]);
    expect(text).toContain("FONTE 2: Instagram (Instagram)");
    expect(text.length).toBeLessThan(1300);
  });

  it("prompt exige fidelidade às fontes e evita repetir o que já existe", () => {
    const { messages } = buildSetupMessages(
      [{ title: "Site", kind: "site", url: "https://p.com", content: "Café das 8h às 10h." }],
      { agent_name: "Assistente", persona_prompt: "padrão", guardrails: null, faqs: [{ question: "Aceita pet?" }], products: [] },
      "Somos pet friendly.",
    );
    expect(messages[0].content).toContain("Nunca invente preços");
    expect(messages[1].content).toContain("- Aceita pet?");
    expect(messages[1].content).toContain("Informações adicionais do dono");
    expect(sameQuestion("Aceita PET?", "aceita pet")).toBe(true);
  });
});
