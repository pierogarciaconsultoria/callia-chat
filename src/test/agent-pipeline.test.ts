import { describe, expect, it, vi } from "vitest";
import type { AiProvider, ChatResult } from "../../supabase/functions/_shared/ai.ts";
import type { AgentConfig, KnowledgeHit } from "../../supabase/functions/_shared/agent-core.ts";
import { claimsAvailability, mentionsGuests, mentionsStayDates, type PipelineDeps, type PipelineInput, promisesAction, promisesPhotos, runAgentPipeline, stripAvailabilityClaims, stripPhotoPromise } from "../../supabase/functions/_shared/agent-pipeline.ts";
import { callExternalAgent, ExternalAgentError, resolveExternalSecret } from "../../supabase/functions/_shared/external-agent.ts";

const config: AgentConfig = {
  workspace_id: "ws-1",
  enabled: true,
  agent_name: "Lia",
  persona_prompt: "Você é a Lia, da Pousada Alfa.",
  guardrails: null,
  language: "pt-BR",
  ai_model: null,
  temperature: 0.4,
  website_url: "https://pousada.example",
  voice_enabled: false,
  voice_id: null,
  timezone: "America/Sao_Paulo",
  business_hours: {},
  out_of_hours_message: null,
  handoff_keywords: ["atendente", "falar com humano"],
  handoff_message: "Vou chamar alguém da equipe.",
  payment_links: [],
  reply_debounce_ms: 0,
  external_agent_enabled: false,
  external_agent_url: null,
  external_agent_secret_ref: null,
  external_agent_timeout_ms: 25000,
};

const faqHit: KnowledgeHit = {
  chunk_id: "c1",
  source_id: "s1",
  source_title: "Qual o horário do café?",
  source_kind: "faq",
  content: "Pergunta: Qual o horário do café?\nResposta: Servimos café das 7h às 10h.",
  score: 0.03,
  keyword_rank: 0.2,
  similarity: null,
};

function input(text: string): PipelineInput {
  return {
    workspaceId: "ws-1",
    businessName: "Pousada Alfa",
    conversation: { id: "conv-1", contact_name: "Ana", contact_phone: "5548999990000" },
    trigger: { id: "msg-1", type: "text", text, media_url: null, created_at: "2026-10-25T15:00:00Z" },
    pendingText: text,
    history: [{ direction: "inbound", sender: "customer", type: "text", content: text, created_at: "2026-10-25T15:00:00Z" }],
    products: [],
  };
}

function fakeAi(responses: Array<Partial<ChatResult> | Error>): AiProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    embeddingsEnabled: false,
    chat: vi.fn(async (args) => {
      calls.push(args);
      const next = responses.shift();
      if (!next) throw new Error("sem resposta programada");
      if (next instanceof Error) throw next;
      return { content: null, toolCalls: [], usage: { total_tokens: 10 }, model: "fake", ...next };
    }),
    transcribe: vi.fn(),
    describeImage: vi.fn(),
    embed: vi.fn(),
    speech: vi.fn(),
  } as unknown as AiProvider & { calls: unknown[] };
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    config,
    ai: null,
    now: () => new Date("2026-10-25T15:00:00Z"),
    correlationId: "corr-1",
    searchKnowledge: async () => [],
    ...overrides,
  };
}

describe("pipeline do agente", () => {
  it("faz handoff por palavra-chave sem acento/caixa, antes de qualquer IA", async () => {
    const ai = fakeAi([]);
    const out = await runAgentPipeline(input("Quero falar com HUMANO, por favor"), deps({ ai }));
    expect(out).toMatchObject({ action: "handoff", handoffReason: "keyword:falar com humano", reply: "Vou chamar alguém da equipe." });
    expect(ai.chat).not.toHaveBeenCalled();
  });

  it("não confunde palavra-chave com parte de outra palavra", async () => {
    const out = await runAgentPipeline(input("Os atendentes são ótimos"), deps({ searchKnowledge: async () => [faqHit] }));
    expect(out).toMatchObject({ action: "reply", engine: "fallback", handoffReason: null });
  });

  it("acrescenta a mensagem de fora do horário no handoff", async () => {
    const cfg = { ...config, business_hours: { sun: [["09:00", "12:00"]] as Array<[string, string]> }, out_of_hours_message: "Voltamos domingo às 9h." };
    // 2026-10-25 15:00Z = domingo 12:00 em São Paulo → fora da faixa 09–12.
    const out = await runAgentPipeline(input("atendente"), deps({ config: cfg }));
    expect(out.reply).toBe("Vou chamar alguém da equipe.\n\nVoltamos domingo às 9h.");
  });

  it("sem provedor de IA responde com a FAQ encontrada", async () => {
    const out = await runAgentPipeline(input("que horas é o café?"), deps({ searchKnowledge: async () => [faqHit] }));
    expect(out).toMatchObject({ action: "reply", engine: "fallback", reply: "Servimos café das 7h às 10h." });
  });

  it("sem provedor de IA e sem resposta, transfere para humano", async () => {
    const out = await runAgentPipeline(input("vocês aceitam pet?"), deps());
    expect(out).toMatchObject({ action: "handoff", engine: "fallback", handoffReason: "no_answer", reply: "Vou chamar alguém da equipe." });
  });

  it("IA interna recebe persona, regras e conhecimento no prompt de sistema", async () => {
    const ai = fakeAi([{ content: "**Olá!** Servimos café das 7h às 10h." }]);
    const out = await runAgentPipeline(input("que horas é o café?"), deps({ ai, searchKnowledge: async () => [faqHit] }));
    expect(out).toMatchObject({ action: "reply", engine: "internal", reply: "*Olá!* Servimos café das 7h às 10h." });
    const sent = (ai.calls[0] as { messages: Array<{ role: string; content: string }> }).messages;
    expect(sent[0].role).toBe("system");
    expect(sent[0].content).toContain("Você é a Lia, da Pousada Alfa.");
    expect(sent[0].content).toContain("Nunca invente preços");
    expect(sent[0].content).toContain("Servimos café das 7h às 10h.");
    expect(sent.at(-1)).toEqual({ role: "user", content: "que horas é o café?" });
  });

  it("IA pode transferir via ferramenta", async () => {
    const ai = fakeAi([{ toolCalls: [{ id: "t1", type: "function", function: { name: "transferir_para_atendente", arguments: '{"motivo":"reclamação"}' } }] }]);
    const out = await runAgentPipeline(input("meu quarto estava sujo"), deps({ ai }));
    expect(out).toMatchObject({ action: "handoff", engine: "internal", handoffReason: "tool:reclamação" });
  });

  it("IA consulta disponibilidade e usa o resultado na resposta", async () => {
    const checkAvailability = vi.fn(async () => ({
      checkin: "10/12/2026", checkout: "12/12/2026", nights: 2, adults: 2, children: 0, currency: "BRL", sold_out: false,
      rooms: [{ name: "Suíte Mar", rate: "Café incluso", total_price: 900, price_per_night: 450, available_units: 2 }],
      booking_link: "https://reservas.example",
    }));
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"10/12/2026","checkout":"12/12/2026","adultos":2,"idades_criancas":[6]}' } }] },
      { content: "Temos a Suíte Mar por R$ 900 (2 noites)." },
    ]);
    const out = await runAgentPipeline(input("tem quarto de 10 a 12/12?"), deps({ ai, checkAvailability }));
    expect(checkAvailability).toHaveBeenCalledWith({ checkin: "10/12/2026", checkout: "12/12/2026", adults: 2, childrenAges: [6] });
    expect(out.reply).toBe("Temos a Suíte Mar por R$ 900 (2 noites).");
    expect(out.toolCalls[0].name).toBe("consultar_disponibilidade");
    const second = (ai.calls[1] as { messages: Array<{ role: string; content: string }> }).messages;
    expect(second.at(-1)?.role).toBe("tool");
    expect(second.at(-1)?.content).toContain("Suíte Mar");
    // Ferramenta só é oferecida quando o conector está ativo.
    const tools = (ai.calls[0] as { tools: Array<{ function: { name: string } }> }).tools.map((t) => t.function.name);
    expect(tools).toContain("consultar_disponibilidade");
  });

  it("motor de reservas fora do ar: a IA recebe o link de reserva para enviar ao hóspede", async () => {
    const checkAvailability = vi.fn(async () => {
      throw Object.assign(new Error("Motor de reservas indisponível."), { details: { booking_link: "https://hbook.example/Booking?x=1" } });
    });
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"10/12/2026","checkout":"12/12/2026"}' } }] },
      { content: "Não consegui ver os preços agora, mas você pode consultar aqui: https://hbook.example/Booking?x=1" },
    ]);
    const out = await runAgentPipeline(input("tem quarto de 10 a 12/12?"), deps({ ai, checkAvailability }));
    expect(out.toolCalls[0].result).toMatchObject({ erro: "Motor de reservas indisponível.", link_reserva: "https://hbook.example/Booking?x=1", instrucao: expect.stringMatching(/tabela de preços/) });
    const system = (ai.calls[0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(system).toContain("Sempre envie o link de reserva do resultado");
  });

  it("IA envia fotos do álbum certo, com limite por pedido", async () => {
    const pick = vi.fn(async (_album: string, n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.example/fam-${i}.jpg`, caption: null, mimetype: "image/jpeg" })));
    const photos = { albums: [{ name: "Apto Casal", count: 3 }, { name: "Apto Família", count: 8 }], pick };
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"apartamento família","quantidade":9}' } }] },
      { content: "Claro! Seguem fotos do Apto Família 👇" },
    ]);
    const out = await runAgentPipeline(input("pode mandar fotos do apto para 4 pessoas?"), deps({ ai, photos }));
    expect(pick).toHaveBeenCalledWith("Apto Família", 5);
    expect(out.media).toHaveLength(5);
    expect(out.media[0]).toMatchObject({ type: "image", url: "https://cdn.example/fam-0.jpg", mimetype: "image/jpeg" });
    expect(out.reply).toBe("Claro! Seguem fotos do Apto Família 👇");
    const system = (ai.calls[0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(system).toContain("- Apto Família (8 fotos)");
    expect(system).toContain("nunca diga que não pode enviar fotos");
    expect(system).toContain('Nunca diga "vou enviar" sem chamar a ferramenta');
  });

  it("não envia o mesmo álbum duas vezes na mesma resposta", async () => {
    const pick = vi.fn(async (_a: string, n: number) => Array.from({ length: n }, (_, i) => ({ url: `u${i}`, caption: null, mimetype: "image/jpeg" })));
    const ai = fakeAi([
      { toolCalls: [
        { id: "t1", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"Estrutura"}' } },
        { id: "t2", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"estrutura"}' } },
      ] },
      { content: "Seguem as fotos 👇" },
    ]);
    const out = await runAgentPipeline(input("fotos da churrasqueira e da estrutura"), deps({ ai, photos: { albums: [{ name: "Estrutura", count: 11 }], pick } }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(out.media).toHaveLength(4);
    expect(out.toolCalls[1].result).toMatchObject({ erro: expect.stringMatching(/já foram enviadas/) });
  });

  it("trava: IA promete fotos sem chamar a ferramenta → Callia força o envio e mantém o texto", async () => {
    const pick = vi.fn(async (_a: string, n: number) => Array.from({ length: n }, (_, i) => ({ url: `u${i}`, caption: null, mimetype: "image/jpeg" })));
    const promise = "Para 4 adultos temos os apartamentos para família. Vou enviar as fotos. Seguem as fotos 👇";
    const ai = fakeAi([
      { content: promise },
      { toolCalls: [{ id: "t1", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"Apartamento 205 e 206"}' } }] },
    ]);
    const out = await runAgentPipeline(input("somos 4 adultos, manda fotos"), deps({ ai, photos: { albums: [{ name: "Apartamento 205 e 206", count: 5 }], pick } }));
    expect(out.media).toHaveLength(4);
    expect(out.reply).toBe(promise);
    expect((ai.calls[1] as { toolChoice?: unknown }).toolChoice).toEqual({ type: "function", function: { name: "enviar_fotos" } });
  });

  it("trava: texto cita duas opções → envia as duas sem nova chamada à IA", async () => {
    const pick = vi.fn(async (a: string, n: number) => Array.from({ length: n }, (_, i) => ({ url: `${a}-${i}`, caption: null, mimetype: "image/jpeg" })));
    const text = "Temos *Apartamentos 205 e 206* e o *Condomínio Verdes Mares*. Seguem as fotos das duas opções 👇";
    const ai = fakeAi([{ content: text }]);
    const albums = [{ name: "Apartamento 205 e 206 - Até 4 pessoas", count: 5 }, { name: "Condomínio Verdes Mares - 7 Pessoas", count: 9 }];
    const out = await runAgentPipeline(input("4 adultos, manda fotos"), deps({ ai, photos: { albums, pick } }));
    expect(ai.calls).toHaveLength(1);
    expect(pick.mock.calls.map((c) => c[0])).toEqual(["Apartamento 205 e 206 - Até 4 pessoas", "Condomínio Verdes Mares - 7 Pessoas"]);
    expect(out.media).toHaveLength(8);
    expect(out.reply).toBe(text);
  });

  it("trava: se ainda assim não houver foto, a promessa sai do texto", async () => {
    const ai = fakeAi([{ content: "Temos o Apto 205. Seguem as fotos 👇" }, { content: "Desculpe." }]);
    const out = await runAgentPipeline(input("manda fotos"), deps({ ai, photos: { albums: [{ name: "Apto 205", count: 1 }], pick: async () => [] } }));
    expect(out.media).toHaveLength(0);
    expect(out.reply).toBe("Temos o Apto 205.");
  });

  it("detecta promessas de foto em várias redações", () => {
    expect(promisesPhotos("Seguem as fotos 👇")).toBe(true);
    expect(promisesPhotos("Vou te mandar umas fotos do apartamento")).toBe(true);
    expect(promisesPhotos("Aqui estão algumas fotos")).toBe(true);
    expect(promisesPhotos("O apartamento tem varanda.")).toBe(false);
    expect(stripPhotoPromise("Temos duas opções.\nVou enviar as fotos agora. Quer reservar?")).toBe("Temos duas opções. Quer reservar?");
  });

  it("álbum inexistente devolve a lista para a IA escolher", async () => {
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "enviar_fotos", arguments: '{"album":"piscina"}' } }] },
      { content: "Não temos piscina, mas posso mostrar o Apto Casal." },
    ]);
    const out = await runAgentPipeline(input("fotos da piscina?"), deps({ ai, photos: { albums: [{ name: "Apto Casal", count: 2 }], pick: async () => [] } }));
    expect(out.media).toHaveLength(0);
    expect(out.toolCalls[0].result).toEqual({ erro: "álbum não encontrado", albuns_disponiveis: ["Apto Casal"] });
  });

  it("sem fotos no workspace a ferramenta não é oferecida", async () => {
    const ai = fakeAi([{ content: "ok" }]);
    await runAgentPipeline(input("oi"), deps({ ai }));
    const tools = (ai.calls[0] as { tools: Array<{ function: { name: string } }> }).tools.map((t) => t.function.name);
    expect(tools).not.toContain("enviar_fotos");
  });

  it("fontes fixas (tabela de preços) entram sempre no prompt, sem depender da busca", async () => {
    const ai = fakeAi([{ content: "ok" }]);
    const pinnedKnowledge = [{ title: "Tabela de preços 2026/2027", content: "Kitnet - 2 pessoas: 320,00 | 420,00" }];
    await runAgentPipeline(input("quanto fica a kitnet?"), deps({ ai, pinnedKnowledge, searchKnowledge: async () => [] }));
    const system = (ai.calls[0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(system).toContain("# Informações oficiais fixas");
    expect(system).toContain("Kitnet - 2 pessoas: 320,00");
  });

  it("com tabela de preços: falha do motor já traz os valores calculados e calcular_valor é oferecida", async () => {
    const quote = vi.fn(() => ({ opcoes: [{ acomodacao: "Apartamentos 205 e 206", total: 5000, total_formatado: "R$ 5.000,00" }] }));
    const checkAvailability = vi.fn(async () => {
      throw Object.assign(new Error("Motor de reservas indisponível."), { details: { booking_link: "https://hbook.example/x" } });
    });
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"27/12/2026","checkout":"01/01/2027","adultos":4}' } }] },
      { content: "Pela tabela: R$ 5.000,00." },
    ]);
    const out = await runAgentPipeline(input("réveillon para 4"), deps({ ai, checkAvailability, priceTable: { quote } }));
    expect(quote).toHaveBeenCalledWith({ checkin: "27/12/2026", checkout: "01/01/2027", adults: 4, childrenAges: [], unit: null });
    expect(out.toolCalls[0].result).toMatchObject({ valores_tabela: { opcoes: [expect.objectContaining({ total: 5000 })] }, link_reserva: "https://hbook.example/x" });
    const first = ai.calls[0] as { tools: Array<{ function: { name: string } }>; messages: Array<{ content: string }> };
    expect(first.tools.map((t) => t.function.name)).toContain("calcular_valor");
    expect(first.messages[0].content).toContain("Nunca refaça a conta");
    expect(first.messages[0].content).toContain("Valor da tabela NÃO confirma disponibilidade");
  });

  it("trava: 'vou consultar, um momento' sem ferramenta → Callia obriga a consultar antes de responder", async () => {
    const quote = vi.fn(() => ({ opcoes: [{ acomodacao: "Apartamentos 205 e 206", total: 8500, total_formatado: "R$ 8.500,00" }] }));
    const ai = fakeAi([
      { content: "Vou consultar a disponibilidade e os preços para você. Um momento, por favor." },
      { toolCalls: [{ id: "t1", type: "function", function: { name: "calcular_valor", arguments: '{"checkin":"10/01/2027","checkout":"20/01/2027","adultos":2,"idades_criancas":[13,7]}' } }] },
      { content: "Para vocês, o Apartamento 205 e 206 fica R$ 8.500,00 (valor da tabela)." },
    ]);
    const out = await runAgentPipeline(input("casal + crianças de 13 e 7, 10 a 20/01/2027"), deps({ ai, priceTable: { quote } }));
    expect((ai.calls[1] as { toolChoice?: unknown }).toolChoice).toBe("required");
    expect(quote).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe("Para vocês, o Apartamento 205 e 206 fica R$ 8.500,00 (valor da tabela).");
  });

  it("trava: com datas e número de pessoas, a 1ª resposta sai obrigatoriamente da ferramenta", async () => {
    const quote = vi.fn(() => ({ noites: 5, estadia_minima: 5, atende_estadia_minima: true, opcoes: [{ acomodacao: "Apartamentos 205 e 206", total: 5000, total_formatado: "R$ 5.000,00" }] }));
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "calcular_valor", arguments: '{"checkin":"27/12/2026","checkout":"01/01/2027","adultos":4}' } }] },
      { content: "O Apartamento 205 fica R$ 5.000,00 para as 5 diárias." },
    ]);
    const out = await runAgentPipeline(input("Quero o 205 de 27/12/2026 a 01/01/2027, somos 4"), deps({ ai, priceTable: { quote } }));
    expect((ai.calls[0] as { toolChoice?: unknown }).toolChoice).toEqual({ type: "function", function: { name: "calcular_valor" } });
    expect((ai.calls[1] as { toolChoice?: unknown }).toolChoice).toBeUndefined();
    expect(quote).toHaveBeenCalledTimes(1);
    expect(out.reply).toBe("O Apartamento 205 fica R$ 5.000,00 para as 5 diárias.");
  });

  it("sem o número de pessoas, não força a ferramenta (a IA pergunta antes de cotar)", async () => {
    const ai = fakeAi([{ content: "Quantas pessoas vão se hospedar?" }]);
    await runAgentPipeline(input("Tem vaga de 27/12 a 01/01?"), deps({ ai, priceTable: { quote: vi.fn(() => ({})) } }));
    expect((ai.calls[0] as { toolChoice?: unknown }).toolChoice).toBeUndefined();
  });

  it("detecta afirmação de vaga (frases reais da MarIA) sem confundir com negação", () => {
    expect(claimsAvailability("Para o Réveillon, de 27/12/2026 a 01/01/2027, o apartamento 205 está disponível para 4 pessoas.")).toBe(true);
    expect(claimsAvailability("Para o Réveillon, temos o apartamento 205 disponível, com o seguinte valor:")).toBe(true);
    expect(claimsAvailability("A disponibilidade para o apartamento 205 está confirmada.")).toBe(true);
    expect(claimsAvailability("A disponibilidade não foi confirmada, mas o valor é R$ 5.000,00.")).toBe(false);
    expect(claimsAvailability("No cartão, a disponibilidade aparece na hora.")).toBe(false);
    expect(stripAvailabilityClaims("O 205 está disponível para 4 pessoas. O total é *R$ 5.000,00*.\n- PIX: 48 90000 0000")).toBe("O total é *R$ 5.000,00*.\n- PIX: 48 90000 0000");
  });

  it("trava: sem confirmação do sistema, pede reescrita; se insistir, remove a frase e acrescenta o aviso do PIX", async () => {
    const quote = vi.fn(() => ({ opcoes: [{ acomodacao: "Apartamentos 205 e 206", total: 5000, total_formatado: "R$ 5.000,00" }] }));
    const claim = "Temos o apartamento 205 disponível! Total *R$ 5.000,00*.\n- PIX (telefone): 48 90000 0000";
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "calcular_valor", arguments: '{"checkin":"27/12/2026","checkout":"01/01/2027","adultos":4}' } }] },
      { content: claim },
      { content: claim },
    ]);
    const paymentInfo = { legal_name: "Pousada Exemplo Ltda", cnpj: null, bank_name: null, bank_code: null, agency: null, account: null, account_type: null, payee_name: null, pix_key_type: "telefone", pix_key: "48 90000 0000", deposit_percent: 50, payment_instructions: null };
    const out = await runAgentPipeline(input("205 de 27/12/2026 a 01/01/2027, somos 4"), deps({ ai, priceTable: { quote }, paymentInfo }));
    expect((ai.calls[2] as { messages: Array<{ content: string }> }).messages.at(-1)?.content).toContain("NÃO foi confirmada");
    expect(out.reply).toBe("Total *R$ 5.000,00*.\n- PIX (telefone): 48 90000 0000\n\nAntes de pagar por PIX, aguarde nossa equipe confirmar a vaga para essas datas.");
  });

  it("trava: PIX com pré-reserva sempre traz o endereço da pré-reserva", async () => {
    const ai = fakeAi([{ content: "Cartão: pelo link de reserva. PIX: faça a pré-reserva pelo mesmo link acima e a equipe confirma a vaga." }]);
    const paymentInfo = { legal_name: null, cnpj: null, bank_name: null, bank_code: null, agency: null, account: null, account_type: null, payee_name: null, pix_key_type: null, pix_key: null, deposit_percent: 50, payment_instructions: null, pre_reservation_url: "https://pms.hospedin.com/pre-reserva/exemplo" };
    const out = await runAgentPipeline(input("como pago?"), deps({ ai, paymentInfo }));
    expect(out.reply).toBe("Cartão: pelo link de reserva. PIX: faça a pré-reserva pelo link de pré-reserva abaixo e a equipe confirma a vaga.\n\nPré-reserva para pagamento por PIX: https://pms.hospedin.com/pre-reserva/exemplo");
  });

  it("com tabela: consulta o Hospedin só nas categorias vinculadas e devolve o preço da tabela", async () => {
    const quote = vi.fn(() => ({ noites: 5, opcoes: [{ acomodacao: "Apartamentos 205 e 206", total: 5000, pms_category_ids: [275] }, { acomodacao: "Kitnet", total: 2750, pms_category_ids: [276] }] }));
    const checkAvailability = vi.fn(async () => ({ checkin: "", checkout: "", nights: 5, adults: 4, children: 0, children_ages: [], currency: "BRL", sold_out: false, booking_link: null,
      rooms: [{ name: "Casal + 2", category_id: 275, rate: null, total_price: 3000, price_per_night: 600, available_units: 1 }] }));
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"27/12/2026","checkout":"01/01/2027","adultos":4}' } }] },
      { content: "Temos o 205 disponível: R$ 5.000,00." },
    ]);
    const out = await runAgentPipeline(input("205 de 27/12/2026 a 01/01/2027, somos 4"), deps({ ai, priceTable: { quote }, checkAvailability } as never));
    expect(checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: [275, 276] }));
    const result = out.toolCalls[0].result as { opcoes: Array<Record<string, unknown>>; sem_vaga: string[]; disponibilidade_confirmada: boolean };
    expect(result.disponibilidade_confirmada).toBe(true);
    expect(result.opcoes).toEqual([{ acomodacao: "Apartamentos 205 e 206", total: 5000, unidades_disponiveis: 1 }]);
    expect(result.sem_vaga).toEqual(["Kitnet"]);
    expect(out.reply).toBe("Temos o 205 disponível: R$ 5.000,00.");
  });

  it("período fechado na tabela: nem consulta o Hospedin", async () => {
    const quote = vi.fn(() => ({ fechado: true, periodos_fechados: "Inverno: 21/06/2027 a 22/09/2027", opcoes: [] }));
    const checkAvailability = vi.fn();
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"10/07/2027","checkout":"15/07/2027","adultos":2}' } }] },
      { content: "O hotel estará fechado nessas datas." },
    ]);
    await runAgentPipeline(input("10/07/2027 a 15/07/2027, um casal"), deps({ ai, priceTable: { quote }, checkAvailability } as never));
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it("abaixo da estadia mínima: consulta a vaga em volta e marca a janela entre reservas", async () => {
    const quote = vi.fn(() => ({ checkin: "10/01/2027", checkout: "13/01/2027", noites: 3, estadia_minima: 5, atende_estadia_minima: false, hospedes: 2, opcoes: [{ acomodacao: "Kitnet", lugares: 2, pms_category_ids: [276] }] }));
    const checkAvailability = vi.fn(async () => ({ checkin: "10/01/2027", checkout: "13/01/2027", nights: 3, adults: 2, children: 0, children_ages: [], currency: "BRL", sold_out: false, booking_link: null,
      rooms: [{ name: "Kit", category_id: 276, rate: null, total_price: 990, price_per_night: 330, available_units: 1, nightly: { "2027-01-09": 0, "2027-01-10": 1, "2027-01-11": 1, "2027-01-12": 1, "2027-01-13": 0 } }] }));
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"10/01/2027","checkout":"13/01/2027","adultos":2}' } }] },
      { content: "A Kitnet tem essa janela de 3 diárias." },
    ]);
    const out = await runAgentPipeline(input("de 10/01/2027 a 13/01/2027, um casal"), deps({ ai, priceTable: { quote, isOpen: () => true }, checkAvailability } as never));
    expect(checkAvailability).toHaveBeenCalledWith(expect.objectContaining({ categoryIds: [276], aroundNights: 2 }));
    const result = out.toolCalls.find((t: { name: string }) => t.name === "consultar_disponibilidade")?.result as { opcoes: Array<{ estadia_curta?: string }> };
    expect(result.opcoes[0].estadia_curta).toBe("permitida");
  });

  it("orçamento do tamanho do grupo; acomodação pedida aparece mesmo se maior", async () => {
    const quote = vi.fn(() => ({ hospedes: 2, opcoes: [{ acomodacao: "Kitnet", lugares: 2 }, { acomodacao: "Verdes Mares", lugares: 7 }] }));
    const call = (args: string) => ({ toolCalls: [{ id: "t1", type: "function", function: { name: "calcular_valor", arguments: args } }] });
    const run = async (args: string) => {
      const ai = fakeAi([call(args), { content: "Valores enviados." }]);
      const out = await runAgentPipeline(input("valores para o casal de 01/12/2026 a 06/12/2026"), deps({ ai, priceTable: { quote } } as never));
      return out.toolCalls.find((t: { name: string }) => t.name === "calcular_valor")?.result as { opcoes: Array<{ acomodacao: string }>; maiores_que_o_grupo?: string[] };
    };
    const casal = await run('{"checkin":"01/12/2026","checkout":"06/12/2026","adultos":2}');
    expect(casal.opcoes.map((o) => o.acomodacao)).toEqual(["Kitnet"]);
    expect(casal.maiores_que_o_grupo).toEqual(["Verdes Mares"]);
    const pedido = await run('{"checkin":"01/12/2026","checkout":"06/12/2026","adultos":2,"acomodacao":"Verdes Mares"}');
    expect(pedido.opcoes).toHaveLength(2);
  });

  it("fora da temporada cadastrada: nem consulta o Hospedin e não afirma vaga", async () => {
    const quote = vi.fn(() => ({ sem_tarifa: true, temporada_cadastrada: "30/11/2026 a 28/03/2027", opcoes: [] }));
    const checkAvailability = vi.fn();
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"10/11/2026","checkout":"15/11/2026","adultos":2}' } }] },
      { content: "Ainda não temos valores para essas datas; a temporada vai de 30/11/2026 a 28/03/2027." },
    ]);
    await runAgentPipeline(input("Do dia 10/11/26 ao dia 15/11/26, 2 adultos"), deps({ ai, priceTable: { quote }, checkAvailability } as never));
    expect(checkAvailability).not.toHaveBeenCalled();
  });

  it("com vaga confirmada pelo sistema de reservas, a resposta não é alterada", async () => {
    const reply = "O apartamento 205 está disponível: R$ 5.000,00.";
    const ai = fakeAi([
      { toolCalls: [{ id: "t1", type: "function", function: { name: "consultar_disponibilidade", arguments: '{"checkin":"27/12/2026","checkout":"01/01/2027","adultos":4}' } }] },
      { content: reply },
    ]);
    const checkAvailability = vi.fn(async () => ({ checkin: "27/12/2026", checkout: "01/01/2027", nights: 5, adults: 4, children: 0, children_ages: [], currency: "BRL", sold_out: false, rooms: [{ name: "205" }], booking_link: null }));
    const out = await runAgentPipeline(input("205 de 27/12/2026 a 01/01/2027, somos 4"), deps({ ai, checkAvailability } as never));
    expect(out.reply).toBe(reply);
  });

  it("reconhece datas de estadia e número de hóspedes", () => {
    expect(mentionsStayDates("de 27/12/2026 a 01/01/2027")).toBe(true);
    expect(mentionsStayDates("de 27 a 31 de dezembro")).toBe(true);
    expect(mentionsStayDates("check-in dia 20/01")).toBe(false);
    expect(mentionsGuests("somos 4")).toBe(true);
    expect(mentionsGuests("2 adultos e uma criança")).toBe(true);
    expect(mentionsGuests("um casal")).toBe(true);
    expect(mentionsGuests("tem vaga?")).toBe(false);
  });

  it("detecta promessas de ação sem confundir com respostas normais", () => {
    expect(promisesAction("Vou consultar a disponibilidade. Um momento, por favor.")).toBe(true);
    expect(promisesAction("Deixe-me verificar os valores")).toBe(true);
    expect(promisesAction("O check-in é a partir das 14h.")).toBe(false);
  });

  it("falha da IA cai no fallback determinístico — cliente nunca fica sem resposta", async () => {
    const ai = fakeAi([new Error("503")]);
    const out = await runAgentPipeline(input("que horas é o café?"), deps({ ai, searchKnowledge: async () => [faqHit] }));
    expect(out).toMatchObject({ engine: "fallback", reply: "Servimos café das 7h às 10h.", aiError: "503" });
  });

  describe("agente externo", () => {
    const externalCfg = { ...config, external_agent_enabled: true, external_agent_url: "https://n8n.example/webhook/x" };

    it("usa a resposta do agente externo com mídia", async () => {
      const callExternal = vi.fn(async () => ({ reply: "Olá do n8n", handoff: false, media: [{ type: "image" as const, url: "https://cdn.example/a.jpg" }] }));
      const out = await runAgentPipeline(input("oi"), deps({ config: externalCfg, callExternal }));
      expect(out).toMatchObject({ action: "reply", engine: "external", reply: "Olá do n8n" });
      expect(out.media).toHaveLength(1);
      const payload = callExternal.mock.calls[0][0];
      expect(payload).toMatchObject({ workspace_id: "ws-1", conversation_id: "conv-1", message_id: "msg-1", contact: { name: "Ana", phone: "5548999990000" } });
      expect(payload.history).toHaveLength(1);
    });

    it("handoff pedido pelo agente externo", async () => {
      const out = await runAgentPipeline(input("oi"), deps({ config: externalCfg, callExternal: async () => ({ reply: null, handoff: true, media: [] }) }));
      expect(out).toMatchObject({ action: "handoff", engine: "external", reply: "Vou chamar alguém da equipe." });
    });

    it("timeout do agente externo cai no agente interno", async () => {
      const ai = fakeAi([{ content: "Resposta interna" }]);
      const callExternal = async () => {
        throw new ExternalAgentError("timeout", "Agente externo não respondeu em 25000 ms.");
      };
      const out = await runAgentPipeline(input("oi"), deps({ config: externalCfg, ai, callExternal }));
      expect(out).toMatchObject({ engine: "internal", reply: "Resposta interna" });
      expect(out.externalError).toMatch(/^timeout/);
    });
  });
});

describe("chamada HTTP ao agente externo", () => {
  const payload = {
    workspace_id: "ws-1", conversation_id: "c", message_id: "m", contact: { name: null, phone: "1" },
    message: { type: "text", text: "oi", media_url: null }, history: [], timestamp: "2026-10-25T00:00:00Z",
  };

  it("envia x-callia-secret e aceita o formato de array do n8n", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ reply: "ok" }]), { status: 200 }));
    const out = await callExternalAgent({ url: "https://n8n.example/w", secret: "s3cr3t", payload, timeoutMs: 1000, correlationId: "corr", fetchImpl });
    expect(out).toEqual({ reply: "ok", handoff: false, media: [] });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-callia-secret"]).toBe("s3cr3t");
  });

  it("rejeita HTTP de erro, JSON inválido e resposta vazia", async () => {
    const run = (res: Response) =>
      callExternalAgent({ url: "https://n8n.example/w", secret: null, payload, timeoutMs: 1000, correlationId: "c", fetchImpl: async () => res })
        .catch((e: ExternalAgentError) => e.reason);
    expect(await run(new Response("x", { status: 500 }))).toBe("http_error");
    expect(await run(new Response("<html>", { status: 200 }))).toBe("invalid_response");
    expect(await run(new Response("{}", { status: 200 }))).toBe("invalid_response");
  });

  it("converte timeout em erro tipado", async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const reason = await callExternalAgent({ url: "https://n8n.example/w", secret: null, payload, timeoutMs: 30, correlationId: "c", fetchImpl: fetchImpl as typeof fetch })
      .catch((e: ExternalAgentError) => e.reason);
    expect(reason).toBe("timeout");
  });

  it("só resolve segredos com prefixo EXTERNAL_AGENT_", () => {
    const env = (n: string) => ({ EXTERNAL_AGENT_LOJA: "abc", SUPABASE_SERVICE_ROLE_KEY: "nao" } as Record<string, string>)[n];
    expect(resolveExternalSecret("EXTERNAL_AGENT_LOJA", env)).toBe("abc");
    expect(() => resolveExternalSecret("SUPABASE_SERVICE_ROLE_KEY", env)).toThrow(/EXTERNAL_AGENT_/);
    expect(() => resolveExternalSecret("EXTERNAL_AGENT_FALTA", env)).toThrow(/não está definido/);
  });
});
