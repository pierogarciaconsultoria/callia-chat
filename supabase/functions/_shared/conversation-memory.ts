// Memória da conversa para a IA: janela de mensagens recentes + resumo do que ficou para trás, e o contexto do que a
// equipe humana fez na conversa. Partes puras (testáveis) separadas da chamada à IA.
import type { AiProvider } from "./ai.ts";
import type { HistoryItem } from "./agent-core.ts";

/** Mensagens recentes que a IA vê na íntegra. */
export const MEMORY_WINDOW = 40;
/** Acima disto de mensagens não resumidas, as mais antigas (além da janela) viram resumo. */
export const MEMORY_TRIGGER = 50;
/** Teto do que se carrega por vez; o que passar disso (resumo falhando repetidamente) fica de fora e é logado. */
export const MEMORY_LOAD_LIMIT = 60;

export interface MemoryMessage {
  seq: number;
  direction: "inbound" | "outbound";
  sender: "customer" | "bot" | "agent" | "system";
  type: string;
  content: string | null;
  created_at: string;
  agent_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Divide o que foi carregado (cronológico) entre o que vira resumo e a janela que a IA lê na íntegra. */
export function planMemory<T>(chronological: T[], window = MEMORY_WINDOW, trigger = MEMORY_TRIGGER): { toSummarize: T[]; window: T[] } {
  if (chronological.length <= trigger) return { toSummarize: [], window: chronological };
  return { toSummarize: chronological.slice(0, chronological.length - window), window: chronological.slice(-window) };
}

/** Rótulo de quem escreveu, para o histórico e o resumo. */
export function speakerLabel(m: Pick<MemoryMessage, "sender" | "metadata">, agentName: string | null | undefined): string {
  if (m.sender === "customer") return "Cliente";
  if (m.sender === "bot") return "Assistente";
  if (m.sender === "system") return "Sistema";
  if (agentName) return `${agentName}, da equipe`;
  return m.metadata?.from_device === true ? "Equipe (pelo celular)" : "Equipe";
}

function stamp(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

/** Prompt do resumo: o que a IA precisa para continuar sem reler tudo. */
export function summaryMessages(previous: string | null, items: Array<MemoryMessage & { text: string | null; agentName?: string | null }>, timeZone: string) {
  const transcript = items
    .map((m) => `[${stamp(m.created_at, timeZone)}] ${speakerLabel(m, m.agentName)}: ${(m.text ?? "").trim() || `[${m.type}]`}`)
    .join("\n");
  const system = [
    "Você resume conversas de atendimento pelo WhatsApp para a própria atendente virtual continuar o atendimento depois.",
    "Escreva em português do Brasil, em até 12 linhas curtas com hífen. Sem saudações nem comentários.",
    "Preserve: datas de estadia, número de pessoas e idades, valores e condições de pagamento citados, o que a EQUIPE humana combinou ou prometeu (marque como combinado pela equipe), pedidos ainda sem resposta, e preferências do cliente.",
    "Se houver resumo anterior, incorpore-o: o resultado substitui o anterior e cobre tudo até o fim das mensagens.",
  ].join(" ");
  const user = `${previous ? `Resumo anterior:\n${previous}\n\n` : ""}Mensagens a incorporar:\n${transcript}`;
  return [{ role: "system" as const, content: system }, { role: "user" as const, content: user }];
}

export async function summarizeHistory(
  ai: AiProvider,
  args: { previous: string | null; items: Array<MemoryMessage & { text: string | null; agentName?: string | null }>; timeZone: string; model?: string | null },
): Promise<string> {
  const result = await ai.chat({ messages: summaryMessages(args.previous, args.items, args.timeZone), model: args.model ?? undefined, temperature: 0.2, maxTokens: 600, timeoutMs: 20_000 });
  const text = (result.content ?? "").trim();
  if (!text) throw new Error("resumo vazio");
  return text.slice(0, 4000);
}

/**
 * O que a equipe fez nesta conversa, para a IA não falar por cima: última mensagem humana e, se a conversa voltou
 * ao bot depois disso por inatividade, o aviso. Null quando a equipe não participou da janela.
 */
export function teamContext(window: Array<MemoryMessage & { text?: string | null; agentName?: string | null }>, timeZone: string): string | null {
  let lastAgentIdx = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].sender === "agent") {
      lastAgentIdx = i;
      break;
    }
  }
  if (lastAgentIdx < 0) return null;
  const last = window[lastAgentIdx];
  const who = speakerLabel(last, last.agentName);
  const said = (last.text ?? last.content ?? "").trim();
  const lines = [`- A equipe participou desta conversa. Última mensagem humana (${who}, ${stamp(last.created_at, timeZone)}): "${said.slice(0, 300) || `[${last.type}]`}".`];
  const returned = window.slice(lastAgentIdx + 1).find((m) => m.sender === "system" && m.metadata?.event === "auto_return");
  if (returned) {
    const idle = typeof returned.metadata?.idle_minutes === "number" ? ` após ${returned.metadata.idle_minutes} min sem mensagens` : "";
    lines.push(`- Depois disso a conversa voltou para você automaticamente${idle}. O que a equipe combinou continua valendo; se o cliente retomar esse assunto, transfira para a equipe.`);
  }
  return lines.join("\n");
}

/** Item do histórico da IA a partir da mensagem carregada (mensagens de sistema ficam de fora do que a IA lê). */
export function toHistoryItem(m: MemoryMessage, text: string | null, agentName: string | null | undefined): HistoryItem {
  return { direction: m.direction, sender: m.sender, type: m.type, content: text, created_at: m.created_at, agentName: m.sender === "agent" ? (agentName ?? null) : null };
}
