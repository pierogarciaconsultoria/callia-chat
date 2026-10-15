// @ts-nocheck
function getEnv(name: string) {
  return (globalThis as { Deno?: { env?: { get: (key: string) => string | undefined } } }).Deno?.env?.get(name);
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function shouldTriggerHandoff(messageText, handoffKeywords) {
  const text = normalize(messageText);
  return (handoffKeywords ?? []).some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return normalizedKeyword.length > 0 && text.includes(normalizedKeyword);
  });
}

export function matchFaq(messageText, faqs) {
  const text = normalize(messageText);
  return (
    (faqs ?? []).find((faq) => {
      if (faq.is_active === false) return false;
      const question = normalize(faq.question);
      return question.length > 0 && (text.includes(question) || question.includes(text));
    }) ?? null
  );
}

export function matchProduct(messageText, products) {
  const text = normalize(messageText);
  return (
    (products ?? []).find((product) => {
      if (product.is_active === false) return false;
      const name = normalize(product.name);
      return name.length > 0 && text.includes(name);
    }) ?? null
  );
}

export function buildFaqReply(faq, paymentLinks) {
  const parts = [faq.answer];
  if ((paymentLinks ?? []).length > 0) {
    const firstLink = paymentLinks[0];
    parts.push(`Se quiser avançar, você também pode usar ${firstLink.label}: ${firstLink.url}`);
  }
  parts.push("Se precisar, eu também posso te encaminhar para um atendente.");
  return parts.join(" ");
}

export function buildProductReply(product) {
  const parts = [`Encontrei uma opção que combina com o que você pediu: ${product.name}.`];
  if (product.description) parts.push(product.description);
  if (typeof product.price === "number") {
    parts.push(`Preço: ${product.currency ?? "BRL"} ${product.price.toFixed(2)}.`);
  }
  if (product.link) {
    parts.push(`Link: ${product.link}`);
  }
  parts.push("Se quiser, eu posso continuar com os detalhes ou te encaminhar para um atendente.");
  return parts.join(" ");
}

export function buildFallbackReply(input) {
  const faq = matchFaq(input.messageText, input.faqs);
  if (faq) return buildFaqReply(faq, input.paymentLinks);

  const product = matchProduct(input.messageText, input.products);
  if (product) return buildProductReply(product);

  if (input.messageType === "audio") {
    return input.mediaSummary
      ? `Recebi seu áudio. Entendi o seguinte: ${input.mediaSummary} Posso seguir com as informações por aqui ou te encaminhar para um atendente.`
      : "Recebi seu áudio, mas ainda não consegui extrair todos os detalhes automaticamente. Se puder, envie em texto ou peça um atendente.";
  }

  if (input.messageType === "image") {
    return input.mediaSummary
      ? `Recebi sua imagem. Identifiquei este contexto: ${input.mediaSummary} Se quiser, eu posso continuar com as opções disponíveis ou te encaminhar para um atendente.`
      : "Recebi sua imagem. Se puder, me diga em texto o que você quer identificar ou comprar para eu te ajudar melhor.";
  }

  return "Posso te ajudar com dúvidas sobre produtos, serviços, preços, links de pagamento e informações da empresa. Me diga o que você precisa ou peça um atendente.";
}

function getAiEndpoint() {
  return getEnv("AI_COMPAT_BASE_URL") ?? "https://api.openai.com/v1";
}

function getAiKey() {
  return getEnv("AI_COMPAT_API_KEY") ?? getEnv("OPENAI_API_KEY") ?? null;
}

export function getEmbeddingModel() {
  return getEnv("EMBEDDING_MODEL") ?? "text-embedding-3-small";
}

// Fail-soft like every other provider call: a missing key or a rejected batch
// leaves the chunk without a vector, and retrieval falls back to tsvector.
export async function embedTexts(texts: string[]) {
  const apiKey = getAiKey();
  if (!apiKey || texts.length === 0) return new Array(texts.length).fill(null);

  try {
    const response = await fetch(`${getAiEndpoint().replace(/\/+$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getEmbeddingModel(),
        input: texts,
      }),
    });

    if (!response.ok) return new Array(texts.length).fill(null);

    const data = await response.json();
    const ordered = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
    return ordered.map((item) => item.embedding ?? null);
  } catch {
    return new Array(texts.length).fill(null);
  }
}

async function fetchMediaAsFile(mediaUrl, fallbackName) {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`media_fetch_failed:${response.status}`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || "application/octet-stream";
  const extension = mimeType.split("/")[1] || "bin";
  const file = new File([blob], `${fallbackName}.${extension}`, { type: mimeType });
  return file;
}

export async function transcribeAudio(mediaUrl) {
  const apiKey = getAiKey();
  if (!apiKey) return null;

  try {
    const file = await fetchMediaAsFile(mediaUrl, "audio");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", getEnv("STT_MODEL") ?? "gpt-4o-mini-transcribe");

    const response = await fetch(`${getAiEndpoint().replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      text: typeof data.text === "string" ? data.text : null,
      model: data.model ?? getEnv("STT_MODEL") ?? "gpt-4o-mini-transcribe",
    };
  } catch {
    return null;
  }
}

export async function analyzeImage(mediaUrl, prompt) {
  const apiKey = getAiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${getAiEndpoint().replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getEnv("VISION_MODEL") ?? getEnv("AI_DEFAULT_MODEL") ?? "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "Descreva de forma objetiva a imagem recebida para um agente de atendimento comercial em portugues do Brasil.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  prompt ??
                  "Descreva a imagem, possíveis produtos, texto visível e qualquer contexto útil para atendimento comercial.",
              },
              {
                type: "image_url",
                image_url: { url: mediaUrl },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content ?? null,
      model: data.model ?? getEnv("VISION_MODEL") ?? "gpt-4o-mini",
      tokensUsed: data.usage?.total_tokens ?? null,
    };
  } catch {
    return null;
  }
}

export async function generateAiReply(input) {
  const apiKey = getAiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${getAiEndpoint().replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: input.systemPrompt,
          },
          {
            role: "user",
            content: input.userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    return {
      text: content,
      model: data.model ?? input.model,
      tokensUsed: data.usage?.total_tokens ?? null,
      raw: data,
    };
  } catch {
    return null;
  }
}

export function buildSystemPrompt(input) {
  const faqSnippet = (input.faqs ?? [])
    .filter((faq) => faq.is_active !== false)
    .slice(0, 15)
    .map((faq) => `- ${faq.question}: ${faq.answer}`)
    .join("\n");

  const productSnippet = (input.products ?? [])
    .filter((product) => product.is_active !== false)
    .slice(0, 15)
    .map((product) => {
      const price = typeof product.price === "number" ? ` | Preço: ${product.currency ?? "BRL"} ${product.price.toFixed(2)}` : "";
      const link = product.link ? ` | Link: ${product.link}` : "";
      return `- ${product.name}: ${product.description ?? "Sem descrição"}${price}${link}`;
    })
    .join("\n");

  const paymentSnippet = (input.paymentLinks ?? [])
    .map((link) => `- ${link.label}: ${link.url}`)
    .join("\n");

  return [
    input.personaPrompt,
    "",
    "Regras obrigatórias:",
    "- Responda em português do Brasil.",
    "- Fique apenas no escopo comercial e de atendimento da empresa.",
    "- Se o cliente pedir humano, atendente, reclamação ou urgência, não invente: acione handoff.",
    "- Se faltar contexto, peça esclarecimento curto.",
    input.websiteUrl ? `- Site institucional informado: ${input.websiteUrl}` : null,
    input.businessHours?.enabled
      ? `- Horário comercial configurado: ${input.businessHours?.notes ?? "usar timezone " + (input.businessHours?.timezone ?? "America/Sao_Paulo")}`
      : null,
    faqSnippet ? `FAQ:\n${faqSnippet}` : null,
    productSnippet ? `Produtos:\n${productSnippet}` : null,
    paymentSnippet ? `Links de pagamento:\n${paymentSnippet}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildUserPrompt(input) {
  return [
    input.historySnippet ? `Histórico recente:\n${input.historySnippet}` : null,
    `Mensagem atual do cliente:\n${input.messageText}`,
    input.mediaSummary ? `Contexto extra da mídia:\n${input.mediaSummary}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
