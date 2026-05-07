type FaqLike = {
  question: string;
  answer: string;
  is_active?: boolean;
};

type ProductLike = {
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  link?: string | null;
  is_active?: boolean;
};

type PaymentLinkLike = {
  label: string;
  url: string;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function shouldTriggerHandoff(input: {
  messageText: string;
  handoffKeywords: string[];
}) {
  const text = normalize(input.messageText);
  return input.handoffKeywords.some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return normalizedKeyword.length > 0 && text.includes(normalizedKeyword);
  });
}

export function matchFaq(messageText: string, faqs: FaqLike[]) {
  const text = normalize(messageText);
  return (
    faqs.find((faq) => {
      if (faq.is_active === false) return false;
      const question = normalize(faq.question);
      return question.length > 0 && (text.includes(question) || question.includes(text));
    }) ?? null
  );
}

export function matchProduct(messageText: string, products: ProductLike[]) {
  const text = normalize(messageText);
  return (
    products.find((product) => {
      if (product.is_active === false) return false;
      const name = normalize(product.name);
      return name.length > 0 && text.includes(name);
    }) ?? null
  );
}

export function buildProductReply(product: ProductLike) {
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

export function buildFaqReply(faq: FaqLike, paymentLinks: PaymentLinkLike[]) {
  const parts = [faq.answer];

  if (paymentLinks.length > 0) {
    const firstLink = paymentLinks[0];
    parts.push(`Se quiser avançar, você também pode usar ${firstLink.label}: ${firstLink.url}`);
  }

  parts.push("Se precisar, eu também posso te encaminhar para um atendente.");
  return parts.join(" ");
}

export function buildFallbackReply(input: {
  messageText: string;
  messageType: "text" | "audio" | "image" | "video" | "document" | "system";
  faqs: FaqLike[];
  products: ProductLike[];
  paymentLinks: PaymentLinkLike[];
  mediaSummary?: string | null;
}) {
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
