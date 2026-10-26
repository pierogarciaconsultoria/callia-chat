import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Bot, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useRequiredWorkspace } from "@/lib/workspace";
import { invokeFunction } from "@/lib/functions";
import type { AgentConfig, FollowUpRule, SimulateResult } from "@/lib/database.types";
import { BusinessHoursEditor, KeywordChips, PaymentLinksEditor } from "@/components/agent-editors";
import { useAgentConfig, useSaveAgentConfig, type AgentConfigPatch } from "@/hooks/use-agent-config";
import { useEntitlements } from "@/hooks/use-entitlements";
import { hasFeature } from "@/lib/entitlements";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Input,
  Notice,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  Textarea,
  useToast,
} from "@/components/ui";

const SECRET_REF_RE = /^EXTERNAL_AGENT_[A-Z0-9_]+$/;

type Form = AgentConfigPatch;

function toForm(c: AgentConfig): Form {
  const { workspace_id: _ws, updated_at: _u, ...rest } = c;
  return {
    ...rest,
    temperature: Number(rest.temperature),
    business_hours: rest.business_hours ?? {},
    payment_links: Array.isArray(rest.payment_links) ? rest.payment_links : [],
    follow_up_rules: Array.isArray(rest.follow_up_rules) ? rest.follow_up_rules : [],
    handoff_keywords: rest.handoff_keywords ?? [],
  };
}

export default function Agent() {
  const { workspaceId } = useRequiredWorkspace();
  const config = useAgentConfig(workspaceId);
  const save = useSaveAgentConfig(workspaceId);
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (config.data) setForm(toForm(config.data));
  }, [config.data]);

  if (config.isLoading) return <PageLoader />;
  if (config.error) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  if (!config.data || !form) return <ErrorState error="Configuração do agente não encontrada para este workspace." />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const urlError =
    form.external_agent_url && !/^https:\/\//.test(form.external_agent_url) ? "A URL precisa começar com https://" : undefined;
  const refError =
    form.external_agent_secret_ref && !SECRET_REF_RE.test(form.external_agent_secret_ref)
      ? "Use o formato EXTERNAL_AGENT_NOME (maiúsculas, números e _)"
      : undefined;
  const externalIncomplete = form.external_agent_enabled && (!form.external_agent_url || !form.external_agent_secret_ref);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || urlError || refError || externalIncomplete) return;
    try {
      await save.mutateAsync({
        ...form,
        ai_model: form.ai_model?.trim() || null,
        website_url: form.website_url?.trim() || null,
        voice_id: form.voice_id?.trim() || null,
        guardrails: form.guardrails?.trim() || null,
        out_of_hours_message: form.out_of_hours_message?.trim() || null,
        external_agent_url: form.external_agent_url?.trim() || null,
        external_agent_secret_ref: form.external_agent_secret_ref?.trim() || null,
        payment_links: form.payment_links.filter((p) => p.label.trim() && p.url.trim()),
        follow_up_rules: form.follow_up_rules.filter((r) => r.message.trim() && r.after_minutes > 0),
      });
      toast.success("Configuração do agente salva.");
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Agente de IA"
        description="Defina como o agente responde no WhatsApp, quando passa para a equipe humana e o que pode oferecer."
        actions={
          <Link
            to="/agent/setup"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <Sparkles className="h-4 w-4" /> Gerar a partir do site e Instagram
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={submit} className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Identidade e comportamento" />
            <CardBody className="space-y-4">
              <Switch
                checked={form.enabled}
                onChange={(v) => set("enabled", v)}
                label="Agente ativo"
                description="Desligado, as mensagens chegam na inbox e ninguém responde automaticamente."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Nome do agente" value={form.agent_name} onChange={(e) => set("agent_name", e.target.value)} required />
                <Select label="Idioma" value={form.language} onChange={(e) => set("language", e.target.value)}>
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="en-US">Inglês</option>
                  <option value="es-ES">Espanhol</option>
                </Select>
              </div>
              <Textarea
                label="Persona e instruções"
                rows={6}
                value={form.persona_prompt}
                onChange={(e) => set("persona_prompt", e.target.value)}
                hint="Como o agente se apresenta, o tom de voz e o que deve priorizar."
                required
              />
              <Textarea
                label="Limites (guardrails)"
                rows={3}
                value={form.guardrails ?? ""}
                onChange={(e) => set("guardrails", e.target.value)}
                hint="O que o agente nunca deve fazer. Ex.: não prometer descontos, não falar de concorrentes."
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Modelo de IA"
                  value={form.ai_model ?? ""}
                  onChange={(e) => set("ai_model", e.target.value)}
                  placeholder="Padrão do servidor"
                  hint="Vazio usa AI_DEFAULT_MODEL."
                />
                <Input
                  label="Temperatura"
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={form.temperature}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                />
                <Input
                  label="Espera antes de responder (ms)"
                  type="number"
                  min={0}
                  max={15000}
                  step={500}
                  value={form.reply_debounce_ms}
                  onChange={(e) => set("reply_debounce_ms", Number(e.target.value))}
                  hint="Junta mensagens enviadas em sequência."
                />
              </div>
              <Input
                label="Site da empresa"
                type="url"
                value={form.website_url ?? ""}
                onChange={(e) => set("website_url", e.target.value)}
                placeholder="https://"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Voz" description="Responder em áudio quando o cliente mandar áudio." />
            <CardBody className="space-y-4">
              <Switch checked={form.voice_enabled} onChange={(v) => set("voice_enabled", v)} label="Respostas em áudio" />
              {form.voice_enabled && (
                <Input label="Voz" value={form.voice_id ?? ""} onChange={(e) => set("voice_id", e.target.value)} placeholder="Ex.: alloy" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Horário de atendimento" description="Usado como contexto e para a mensagem fora do horário." />
            <CardBody className="space-y-4">
              <Select label="Fuso horário" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Rio_Branco", "America/Noronha", "UTC"].map(
                  (tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ),
                )}
              </Select>
              <BusinessHoursEditor value={form.business_hours} onChange={(v) => set("business_hours", v)} />
              <Textarea
                label="Mensagem fora do horário"
                rows={2}
                value={form.out_of_hours_message ?? ""}
                onChange={(e) => set("out_of_hours_message", e.target.value)}
                hint="Opcional. Vazio = o agente responde normalmente e informa o horário."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Transferência para humano" />
            <CardBody className="space-y-4">
              <KeywordChips value={form.handoff_keywords} onChange={(v) => set("handoff_keywords", v)} />
              <Textarea
                label="Mensagem ao transferir"
                rows={2}
                value={form.handoff_message}
                onChange={(e) => set("handoff_message", e.target.value)}
                required
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Links de pagamento" description="O agente só envia links cadastrados aqui." />
            <CardBody>
              <PaymentLinksEditor value={form.payment_links} onChange={(v) => set("payment_links", v)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Regras de follow-up" description="Mensagens de acompanhamento após um tempo sem resposta do cliente." />
            <CardBody>
              <FollowUpEditor value={form.follow_up_rules} onChange={(v) => set("follow_up_rules", v)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Agente externo"
              description="Delegue as respostas a um orquestrador seu (n8n, LangChain, Flowise). Se ele falhar, o agente interno responde."
            />
            <CardBody className="space-y-4">
              <PlanFeatureNotice feature="external_agent_enabled">
                O agente externo não faz parte do plano deste workspace. Mesmo ativado aqui, as mensagens são respondidas pelo agente interno.
              </PlanFeatureNotice>
              <Switch
                checked={form.external_agent_enabled}
                onChange={(v) => set("external_agent_enabled", v)}
                label="Usar agente externo"
              />
              <Input
                label="URL do webhook"
                type="url"
                value={form.external_agent_url ?? ""}
                onChange={(e) => set("external_agent_url", e.target.value)}
                placeholder="https://n8n.suaempresa.com/webhook/callia"
                error={urlError}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Referência do segredo"
                  value={form.external_agent_secret_ref ?? ""}
                  onChange={(e) => set("external_agent_secret_ref", e.target.value.toUpperCase())}
                  placeholder="EXTERNAL_AGENT_N8N"
                  error={refError}
                  hint="Nome do segredo de backend. O valor fica nos secrets das functions e vai no header x-callia-secret."
                />
                <Input
                  label="Timeout (ms)"
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={form.external_agent_timeout_ms}
                  onChange={(e) => set("external_agent_timeout_ms", Number(e.target.value))}
                />
              </div>
              {externalIncomplete && <Notice tone="warn">Para ativar, informe a URL e a referência do segredo.</Notice>}
              <details className="text-sm text-slate-600 dark:text-slate-400">
                <summary className="cursor-pointer font-medium">Formato do payload e da resposta</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`POST <URL>  (header x-callia-secret)
{ "workspace_id", "conversation_id", "message_id",
  "contact": { "name", "phone" },
  "message": { "type", "text", "media_url" },
  "history": [ ...últimas 20 ],
  "timestamp" }

Resposta esperada:
{ "reply": "texto", "handoff": false,
  "media": [{ "type": "image", "url": "https://...", "caption": "" }] }`}</pre>
              </details>
            </CardBody>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:mx-0 sm:rounded-lg sm:border">
            <Button variant="secondary" onClick={() => setForm(toForm(config.data!))} disabled={save.isPending}>
              Descartar
            </Button>
            <Button type="submit" loading={save.isPending} disabled={Boolean(urlError || refError || externalIncomplete)}>
              Salvar
            </Button>
          </div>
        </form>

        <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
          <Simulator workspaceId={workspaceId} />
        </div>
      </div>
    </>
  );
}

function FollowUpEditor({ value, onChange }: { value: FollowUpRule[]; onChange: (v: FollowUpRule[]) => void }) {
  const update = (i: number, patch: Partial<FollowUpRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {value.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[140px_1fr_auto]">
          <Input
            type="number"
            min={1}
            value={r.after_minutes}
            onChange={(e) => update(i, { after_minutes: Number(e.target.value) })}
            aria-label="Minutos"
            hint="minutos"
          />
          <Textarea rows={2} value={r.message} onChange={(e) => update(i, { message: e.target.value })} aria-label="Mensagem" />
          <Button variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remover regra">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...value, { after_minutes: 60, message: "" }])}>
        <Plus className="h-4 w-4" /> Adicionar regra
      </Button>
      <p className="text-xs text-slate-500">As regras ficam salvas para a automação de follow-up.</p>
    </div>
  );
}

interface SimTurn {
  role: "customer" | "bot";
  text: string;
  result?: SimulateResult;
}

function Simulator({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    const next: SimTurn[] = [...turns, { role: "customer", text: msg }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const res = await invokeFunction<SimulateResult>("process-message", {
        action: "simulate",
        workspace_id: workspaceId,
        messages: next.map(({ role, text: t }) => ({ role, text: t })),
      });
      setTurns([...next, { role: "bot", text: res.reply ?? (res.handoff ? "(transferido para humano)" : "(sem resposta)"), result: res }]);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-h-[80vh] flex-col">
      <div className="px-4 pt-3 sm:px-5 empty:hidden">
        <PlanFeatureNotice feature="ai_enabled">IA desativada no plano: o agente responde só com a FAQ e transfere o resto para a equipe.</PlanFeatureNotice>
      </div>
      <CardHeader
        title="Testar agente"
        description="Simula uma conversa com a configuração salva. Nada é enviado ao WhatsApp."
        actions={
          turns.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setTurns([])}>
              Limpar
            </Button>
          )
        }
      />
      <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center text-sm text-slate-500">
            <Bot className="mb-2 h-6 w-6" />
            Escreva como se fosse um cliente.
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "customer" ? "flex justify-end" : "flex flex-col items-start"}>
            <div
              className={
                t.role === "customer"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-brand-fg"
                  : "max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800"
              }
            >
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.result?.media && t.result.media.length > 0 && <SimMedia media={t.result.media} />}
            </div>
            {t.result && <SimDetails result={t.result} />}
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400">O agente está pensando…</p>}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem do cliente"
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit" loading={busy} disabled={!text.trim()} aria-label="Enviar">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}

/** O que a MarIA enviaria junto com a resposta (ex.: fotos do álbum). */
function SimMedia({ media }: { media: NonNullable<SimulateResult["media"]> }) {
  const images = media.filter((m) => m.type === "image");
  const others = media.filter((m) => m.type !== "image");
  return (
    <div className="mt-2 space-y-1">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {images.map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md bg-slate-200 dark:bg-slate-700" title={m.caption ?? undefined}>
              <img src={m.url} alt={m.caption ?? "Foto"} loading="lazy" className="aspect-square h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {others.map((m, i) => (
        <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block text-xs underline">
          {m.file_name ?? m.type}
        </a>
      ))}
      <p className="text-[11px] text-slate-500">{media.length} mídia(s) seriam enviadas no WhatsApp</p>
    </div>
  );
}

function SimDetails({ result }: { result: SimulateResult }) {
  return (
    <div className="mt-1 w-full max-w-[90%] space-y-1 text-xs text-slate-500">
      <div className="flex flex-wrap gap-1">
        <Badge>motor: {result.engine}</Badge>
        {result.handoff && <Badge tone="violet">transferido</Badge>}
        {result.knowledge?.length > 0 && <Badge tone="blue">{result.knowledge.length} trecho(s) da base</Badge>}
        {result.tool_calls?.length > 0 && <Badge tone="amber">{result.tool_calls.length} ferramenta(s)</Badge>}
      </div>
      {(result.knowledge?.length > 0 || result.tool_calls?.length > 0) && (
        <details>
          <summary className="cursor-pointer">Ver contexto usado</summary>
          <div className="mt-1 space-y-1">
            {result.knowledge?.map((k, i) => (
              <div key={i} className="rounded border border-slate-200 p-2 dark:border-slate-700">
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  {k.source_title} <span className="font-normal">· {Number(k.score).toFixed(3)}</span>
                </p>
                <p className="line-clamp-3 break-words">{k.content}</p>
              </div>
            ))}
            {result.tool_calls?.map((t, i) => (
              <pre key={i} className="overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                {t.name}({JSON.stringify(t.arguments)}){"\n"}→ {JSON.stringify(t.result, null, 1)?.slice(0, 600)}
              </pre>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PlanFeatureNotice({ feature, children }: { feature: "ai_enabled" | "external_agent_enabled"; children: ReactNode }) {
  const { data } = useEntitlements();
  if (hasFeature(data, feature)) return null;
  return <Notice tone="warn">{children}</Notice>;
}
