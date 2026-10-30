import { Link } from "react-router-dom";
import { CALLIA_BRAND_STYLE } from "@/lib/branding";
import { CheckCircle2, CircleDashed, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui";

interface Phase {
  n: number;
  title: string;
  status: "completed" | "in_progress";
  items: string[];
}

// Board público de acompanhamento das fases do MVP (PRD v1.0).
const PHASES: Phase[] = [
  { n: 0, title: "Fundação técnica", status: "completed", items: ["Schema multi-tenant com RLS", "Branding e white-label", "Ledger de idempotência e rastreio de envios"] },
  { n: 1, title: "Runtime e adapters", status: "completed", items: ["Erros padronizados e correlation_id", "Contratos validados", "Adapters de WhatsApp, IA, voz e visão"] },
  { n: 2, title: "Painel do agente e workspace", status: "completed", items: ["Persona, idioma, horário, handoff", "Links de pagamento e follow-up", "Branding refletido no painel"] },
  { n: 3, title: "Conexão WhatsApp", status: "completed", items: ["Instâncias na Evolution", "QR Code em tempo real", "Instância padrão e rotação de token"] },
  { n: 4, title: "Entrada de mensagens", status: "completed", items: ["Webhook com idempotência", "Dedupe por external_id", "Contadores de não lidas"] },
  { n: 5, title: "Pipeline de IA", status: "completed", items: ["Áudio (STT) e imagem (visão)", "Guardrails e handoff", "Agente externo com fallback"] },
  { n: 6, title: "Inbox humana", status: "completed", items: ["Tempo real", "Assumir e devolver ao bot", "Envio manual do atendente"] },
  { n: 7, title: "API pública e chaves", status: "completed", items: ["Chaves com hash", "Envio proativo e eventos", "Ingestão de conversas externas"] },
  { n: 8, title: "Webhooks, logs e auditoria", status: "completed", items: ["Assinatura HMAC", "Retentativas", "Tela de logs consolidada"] },
  { n: 9, title: "Acabamento e go-live", status: "completed", items: ["Code-splitting", "Error boundary", "Runbook e checklist de piloto"] },
  { n: 10, title: "Base de conhecimento e agentes externos", status: "in_progress", items: ["Busca híbrida (tsvector + embeddings)", "Documentos PDF/DOCX/URL", "Conector de reservas hbook"] },
];

export default function Roadmap() {
  const done = PHASES.filter((p) => p.status === "completed").length;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950" style={CALLIA_BRAND_STYLE}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-brand-fg">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Callia Chat · Acompanhamento</h1>
              <p className="text-sm text-slate-500">MVP piloto operacional — {done} de {PHASES.length} fases concluídas</p>
            </div>
          </div>
          <Link to="/entrar" className="text-sm font-medium text-brand">Entrar no painel →</Link>
        </div>
        <div className="mb-8 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="h-full rounded-full bg-brand" style={{ width: `${(done / PHASES.length) * 100}%` }} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHASES.map((p) => (
            <div key={p.n} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">
                  <span className="text-slate-400">Fase {p.n} · </span>
                  {p.title}
                </p>
                {p.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <CircleDashed className="h-5 w-5 shrink-0 text-amber-500" />
                )}
              </div>
              <Badge tone={p.status === "completed" ? "green" : "amber"}>{p.status === "completed" ? "Concluída" : "Em andamento"}</Badge>
              <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                {p.items.map((i) => <li key={i}>• {i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
