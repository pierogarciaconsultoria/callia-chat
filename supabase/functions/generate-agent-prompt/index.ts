// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, jsonResponse, requireAdminContext } from "../_shared/auth.ts";
import { generateAiReply } from "../_shared/agent.ts";

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const { workspaceId, supabase, body } = await requireAdminContext(request);
    const segment = text(body.segment, 160);
    const companyContext = text(body.companyContext, 5000);
    const language = text(body.language, 40) || "pt-BR";
    const websiteUrl = text(body.websiteUrl, 500);
    const currentPrompt = text(body.currentPrompt, 5000);
    const requestedModel = text(body.model, 160);

    if (!segment || !companyContext) {
      return jsonResponse({ error: "segment_and_context_required" }, { status: 400 });
    }

    const { data: agentConfig } = await supabase
      .from("agent_configs")
      .select("ai_model")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const model = requestedModel || agentConfig?.ai_model || "gpt-4o-mini";
    const result = await generateAiReply({
      model,
      systemPrompt: [
        "Você é especialista em design de prompts para agentes de atendimento e vendas no WhatsApp.",
        "Crie somente o prompt de sistema final, em português do Brasil, sem introdução, comentários ou blocos markdown.",
        "O prompt deve ser prático, específico para a empresa e organizado em seções curtas.",
        "Inclua: identidade e papel, objetivos, tom de voz, fluxo de atendimento, qualificação, uso de contexto, limites, segurança, handoff humano e regras para não inventar informações.",
        "Não inclua dados que não tenham sido fornecidos. Quando faltar informação, instrua o agente a perguntar ao cliente ou encaminhar para atendimento humano.",
      ].join("\n"),
      userPrompt: [
        `Segmento: ${segment}`,
        `Contexto da empresa: ${companyContext}`,
        `Idioma do atendimento: ${language}`,
        websiteUrl ? `Website informado: ${websiteUrl}` : null,
        currentPrompt ? `Prompt atual para aproveitar apenas o que fizer sentido:\n${currentPrompt}` : null,
        "Gere um prompt completo, claro e diretamente utilizável como system prompt.",
      ].filter(Boolean).join("\n\n"),
    });

    if (!result?.text) {
      return jsonResponse(
        { error: "ai_provider_unavailable" },
        { status: 503 },
      );
    }

    return jsonResponse({
      ok: true,
      prompt: result.text.trim(),
      model: result.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status =
      message === "unauthorized" ? 401 :
      message === "forbidden" ? 403 :
      message === "workspace_required" ? 400 :
      500;

    return jsonResponse({ error: message }, { status });
  }
});
