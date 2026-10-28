// Assuntos sugeridos para as políticas da empresa (o campo aceita qualquer assunto curto em minúsculas).
export const POLICY_TOPICS: Array<{ id: string; label: string }> = [
  { id: "checkin", label: "Check-in" },
  { id: "checkout", label: "Check-out" },
  { id: "estadia_minima", label: "Estadia mínima" },
  { id: "cancelamento", label: "Cancelamento e reembolso" },
  { id: "pagamento", label: "Pagamento" },
  { id: "criancas", label: "Crianças" },
  { id: "pets", label: "Animais" },
  { id: "fumo", label: "Fumo" },
  { id: "silencio", label: "Silêncio" },
  { id: "danos", label: "Danos e cobranças" },
  { id: "comodidades", label: "Comodidades e serviços" },
  { id: "acessibilidade", label: "Acessibilidade" },
  { id: "horarios", label: "Horários de funcionamento" },
  { id: "outro", label: "Outro" },
];

export function policyTopicLabel(topic: string): string {
  return POLICY_TOPICS.find((t) => t.id === topic)?.label ?? topic;
}

/** Normaliza o assunto digitado: minúsculas, sem acento, só letras, números e "_". */
export function normalizeTopic(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}
