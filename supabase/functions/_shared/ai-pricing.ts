// Custo estimado de IA por execução, a partir dos tokens gravados em agent_runs.usage.
// Tabela de referência (US$ por 1 milhão de tokens: entrada, saída) dos modelos de chat usados; só o chat é contado
// (transcrição de áudio, visão e embeddings ficam de fora). Modelo desconhecido usa o preço do modelo padrão.
export const MODEL_PRICES_USD_PER_M: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.60],
  "gpt-4o": [2.50, 10.00],
  "gpt-4.1-nano": [0.10, 0.40],
  "gpt-4.1-mini": [0.40, 1.60],
  "gpt-4.1": [2.00, 8.00],
  "gpt-5-nano": [0.05, 0.40],
  "gpt-5-mini": [0.25, 2.00],
  "gpt-5": [1.25, 10.00],
};

export interface RunUsage {
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface AiCost {
  /** Total estimado em dólares (4 casas). */
  usd: number;
  by_model: Record<string, { runs: number; prompt_tokens: number; completion_tokens: number; usd: number }>;
  /** Execuções cujo modelo não está na tabela de preços (custeadas pelo modelo padrão). */
  unknown_models: string[];
}

function priceFor(model: string, defaultModel: string): [number, number] | null {
  const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, ""); // "gpt-4.1-mini-2025-04-14" → "gpt-4.1-mini"
  return MODEL_PRICES_USD_PER_M[base] ?? MODEL_PRICES_USD_PER_M[defaultModel] ?? null;
}

export function estimateAiCost(runs: Array<{ usage: RunUsage | null }>, defaultModel = "gpt-4o-mini"): AiCost {
  const by_model: AiCost["by_model"] = {};
  const unknown = new Set<string>();
  let usd = 0;
  for (const r of runs) {
    const u = r.usage ?? {};
    const model = (u.model ?? defaultModel).trim() || defaultModel;
    const prompt = Number(u.prompt_tokens ?? 0) || 0;
    const completion = Number(u.completion_tokens ?? 0) || 0;
    if (!prompt && !completion) continue;
    const price = priceFor(model, defaultModel);
    if (!MODEL_PRICES_USD_PER_M[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")]) unknown.add(model);
    const cost = price ? (prompt * price[0] + completion * price[1]) / 1_000_000 : 0;
    const row = by_model[model] ?? (by_model[model] = { runs: 0, prompt_tokens: 0, completion_tokens: 0, usd: 0 });
    row.runs++;
    row.prompt_tokens += prompt;
    row.completion_tokens += completion;
    row.usd = round4(row.usd + cost);
    usd += cost;
  }
  return { usd: round4(usd), by_model, unknown_models: [...unknown] };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
