// Landing comercial (/): o que o Callia faz, como funciona, planos e chamada para o teste grátis.
// Planos e configurações vêm de public_site_info (sem login). Nada aqui inventa números ou depoimentos.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, Bot, CalendarCheck, Check, Clock, Images, KeyRound, MessageCircle, Mic, ReceiptText, ShieldCheck, Sparkles, Users, Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatPlanPrice, planHighlights, SITE_FALLBACK, useSiteInfo, type SiteInfo } from "@/lib/site";
import { SEGMENT_LIST } from "@/lib/segments";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "#recursos", label: "Recursos" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#segmentos", label: "Segmentos" },
  { href: "#planos", label: "Planos" },
  { href: "#perguntas", label: "Perguntas" },
];

const BENEFITS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Zap, title: "Resposta na hora, dia e noite", text: "O agente responde em segundos, inclusive de madrugada e no fim de semana. Entende texto, áudio, foto e PDF." },
  { icon: ShieldCheck, title: "Vende sem inventar", text: "Valores saem da sua tabela oficial, disponibilidade do seu sistema. O que não está na base, ele não responde: passa para a equipe." },
  { icon: Users, title: "Sua equipe no controle", text: "Tudo cai numa inbox compartilhada. Qualquer pessoa assume a conversa com um clique, e o agente volta quando você quiser." },
];

const STEPS = [
  { title: "Conte sobre o negócio", text: "Crie a conta, informe o site e o Instagram. Leva 2 minutos.", minutes: 2 },
  { title: "A IA monta o agente", text: "Persona, regras e perguntas frequentes nascem do seu conteúdo. Você revisa e testa no simulador antes de ligar.", minutes: 10 },
  { title: "Conecte o WhatsApp", text: "Leia um QR code com o celular da empresa. Seu número continua o mesmo. Pronto: ele já atende.", minutes: 2 },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: MessageCircle, title: "Inbox compartilhada", text: "Conversas do WhatsApp em um só lugar, com histórico, quem respondeu e o motivo de cada transferência." },
  { icon: BookOpen, title: "Base de conhecimento", text: "Tabela de preços, políticas, PDFs e páginas do site. O agente responde só com o que está lá." },
  { icon: Images, title: "Fotos sob demanda", text: "Álbuns por acomodação, produto ou serviço. O cliente pede fotos e recebe na hora." },
  { icon: Mic, title: "Áudios transcritos", text: "Mensagens de voz viram texto para o agente e para a equipe. Sem fala clara, ele pede para repetir." },
  { icon: ReceiptText, title: "Comprovantes para a equipe", text: "Comprovante de PIX ou depósito é guardado, marcado na inbox e passado para alguém conferir. O agente nunca confirma pagamento." },
  { icon: CalendarCheck, title: "Reservas e orçamentos", text: "Integração com Hospedin e hbook, cálculo pela tabela oficial e link de reserva preenchido quando o cliente quer fechar." },
  { icon: Clock, title: "Horário e transferência", text: "Horário de atendimento, mensagem fora do expediente e palavras-chave que chamam uma pessoa." },
  { icon: KeyRound, title: "API e webhooks", text: "Envie mensagens e receba eventos no seu sistema. Chaves por workspace, com limites por plano." },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: "Preciso trocar de número ou de chip?", a: "Não. Você conecta o número atual lendo um QR code, como no WhatsApp Web. As conversas continuam no seu celular e também aparecem no Callia." },
  { q: "O agente pode inventar preço ou dizer que tem vaga?", a: "Não. Os valores vêm da tabela de preços cadastrada e a disponibilidade do sistema de reservas. Sem essa informação, ele diz que vai confirmar com a equipe e transfere." },
  { q: "E quando o cliente quer falar com uma pessoa?", a: "Basta pedir: o agente transfere na hora. Você também define palavras-chave e situações (reclamação, pagamento) que sempre vão para a equipe." },
  { q: "Quanto tempo leva para começar?", a: "Em torno de 15 minutos: a IA monta o agente a partir do seu site, você revisa, testa no simulador e conecta o WhatsApp." },
  { q: "Preciso de cartão de crédito para testar?", a: "Não. O período de teste é liberado no cadastro, com limites reduzidos. Para continuar, você escolhe um plano." },
  { q: "Meus dados e as conversas ficam seguros?", a: "Cada empresa tem um espaço isolado. Arquivos recebidos ficam em área privada, acessível só pela sua equipe. Nada é compartilhado entre clientes." },
];

function Section({ id, eyebrow, title, text, children, className }: { id: string; eyebrow?: string; title: string; text?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20", className)}>
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-brand">{eyebrow}</p>}
          <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {text && <p className="mt-3 text-base text-slate-600 dark:text-slate-400">{text}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** Chamada principal: cadastro quando o autoatendimento está ligado; senão, contato ou login. */
function Cta({ site, className, size = "md" }: { site: SiteInfo; className?: string; size?: "md" | "lg" }) {
  const base = cn("inline-flex items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-brand-fg shadow-sm hover:opacity-90", size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm", className);
  if (site.self_service) {
    return (
      <Link to="/cadastro" className={base}>
        Começar teste grátis <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    );
  }
  if (site.support_email) {
    return (
      <a href={`mailto:${site.support_email}?subject=Quero conhecer o ${site.platform_name}`} className={base}>
        Falar com a gente <ArrowRight className="h-4 w-4" aria-hidden />
      </a>
    );
  }
  return (
    <Link to="/entrar" className={base}>
      Entrar <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** Conversa de exemplo (ilustrativa) mostrando o que o agente faz. */
function ChatDemo() {
  const bubble = (side: "in" | "out", text: ReactNode, who?: string) => (
    <div className={cn("flex", side === "out" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm", side === "out" ? "rounded-br-sm bg-brand/10 text-slate-800 dark:text-slate-100" : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100")}>
        {who && <p className="mb-0.5 text-[11px] font-semibold text-brand">{who}</p>}
        {text}
      </div>
    </div>
  );
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4 shadow-lg dark:border-slate-800 dark:bg-slate-900" aria-label="Exemplo de conversa com o agente">
      <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">Exemplo de conversa</p>
      <div className="space-y-2.5">
        {bubble("in", "Oi! Tem vaga para 2 adultos e uma criança de 4 anos, de 10 a 15 de janeiro?")}
        {bubble("out", <>Olá! Tem sim 😊 Para vocês três, de 10 a 15/01, a opção é o <strong>Apartamento Família</strong>: 5 diárias, total <strong>R$ 3.000,00</strong>. Quer ver as fotos ou tem alguma dúvida?</>, "Agente")}
        {bubble("in", <span className="flex items-center gap-2"><Mic className="h-4 w-4 text-slate-500" aria-hidden /> Áudio 0:06 · <em className="text-slate-500">"manda as fotos e o link"</em></span>)}
        {bubble("out", <>Seguem 4 fotos do Apartamento Família 👇 E aqui está o link para reservar com as suas datas já preenchidas.</>, "Agente")}
        {bubble("in", <span className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-emerald-600" aria-hidden /> comprovante_pix.pdf</span>)}
        {bubble("out", <>Recebi o seu comprovante, obrigado! Já passei para a equipe conferir, e eles confirmam com você por aqui.</>, "Agente")}
        <p className="pt-1 text-center text-[11px] text-slate-500"><Users className="mr-1 inline h-3 w-3" aria-hidden /> Conversa transferida para a equipe · aparece na inbox com o comprovante</p>
      </div>
    </div>
  );
}

function PlanCard({ plan, site, featured }: { plan: SiteInfo["plans"][number]; site: SiteInfo; featured: boolean }) {
  const isTrial = plan.code === "trial";
  return (
    <div className={cn("flex flex-col rounded-2xl border p-6", featured ? "border-brand bg-white shadow-lg ring-1 ring-brand dark:bg-slate-900" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900")}>
      {featured && <span className="mb-3 inline-flex w-fit rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">Comece por aqui</span>}
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      {plan.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{plan.description}</p>}
      <p className="mt-4 text-2xl font-bold">{isTrial ? `${site.trial_days} dias grátis` : formatPlanPrice(plan)}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {planHighlights(plan).map((h) => (
          <li key={h} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> {h}</li>
        ))}
      </ul>
      <div className="mt-6">
        {/* Plano sob consulta (sem preço): contato, não cadastro. */}
        <Cta site={!isTrial && plan.price_cents === null ? { ...site, self_service: false } : site} className="w-full" />
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const siteQuery = useSiteInfo();
  const site = siteQuery.data ?? SITE_FALLBACK;
  const plans = site.plans;

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-fg"><MessageCircle className="h-4 w-4" aria-hidden /></span>
            {site.platform_name}
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-slate-600 md:flex dark:text-slate-400" aria-label="Seções">
            {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-slate-900 dark:hover:text-white">{n.label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Link to="/dashboard" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-fg hover:opacity-90">
                Ir para o painel <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link to="/entrar" className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Entrar</Link>
                <Cta site={site} className="hidden sm:inline-flex" />
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-xs font-semibold text-brand">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Atendimento no WhatsApp com IA
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Responda cada cliente em segundos, 24 horas por dia, sem perder o controle.
              </h1>
              <p className="mt-5 text-lg text-slate-600 dark:text-slate-400">
                O {site.platform_name} coloca um agente de IA no WhatsApp da sua empresa. Ele conhece seus preços, políticas e fotos, responde na hora e passa para a sua equipe quando precisa.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Cta site={site} size="lg" />
                <a href="#como-funciona" className="inline-flex h-12 items-center gap-2 rounded-lg border border-slate-300 px-6 text-base font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900">
                  Ver como funciona
                </a>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
                <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> {site.trial_days} dias grátis</li>
                <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Sem cartão de crédito</li>
                <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Seu número, seus dados</li>
              </ul>
            </div>
            <ChatDemo />
          </div>
        </section>

        <Section id="beneficios" eyebrow="Por que o Callia" title="Um atendente que nunca dorme e nunca chuta." text="Feito para negócios que vendem pelo WhatsApp e não podem errar valor, prazo ou disponibilidade." className="bg-slate-50 dark:bg-slate-900/40">
          <div className="grid gap-6 md:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand"><b.icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{b.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="como-funciona" eyebrow="Como funciona" title="Do cadastro ao primeiro atendimento em cerca de 15 minutos." text="Uma jornada guiada dentro do painel mostra o próximo passo até o agente estar no ar.">
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-fg">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s.text}</p>
                <p className="mt-3 flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3.5 w-3.5" aria-hidden /> cerca de {s.minutes} min</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="recursos" eyebrow="Recursos" title="Tudo o que o atendimento precisa, no mesmo lugar." className="bg-slate-50 dark:bg-slate-900/40">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <f.icon className="h-5 w-5 text-brand" aria-hidden />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="segmentos" eyebrow="Segmentos" title="Boas práticas e regras do seu setor já incluídas." text="Ao escolher o segmento, o agente recebe o tom, os cuidados e as exigências legais da área. Você ajusta o que quiser.">
          <ul className="flex flex-wrap gap-2.5">
            {SEGMENT_LIST.map((s) => (
              <li key={s.id} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium dark:border-slate-700 dark:bg-slate-900">
                {s.label}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="planos" eyebrow="Planos" title="Comece grátis e cresça quando fizer sentido." text="Os limites valem por empresa. Mensagens automáticas são as enviadas pelo agente e pela API; as da equipe não contam." className="bg-slate-50 dark:bg-slate-900/40">
          {plans.length ? (
            <div className={cn("grid gap-6 md:grid-cols-2", plans.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
              {plans.map((p) => <PlanCard key={p.code} plan={p} site={site} featured={p.code === "trial"} />)}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{siteQuery.isLoading ? "Carregando planos…" : "Fale com a gente para conhecer os planos."}</p>
          )}
        </Section>

        <Section id="perguntas" eyebrow="Perguntas frequentes" title="O que mais perguntam antes de começar.">
          <div className="grid gap-3 md:grid-cols-2">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}</summary>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-brand px-6 py-12 text-center text-brand-fg sm:px-12">
            <Bot className="mx-auto h-10 w-10" aria-hidden />
            <h2 className="mt-4 text-2xl font-bold sm:text-3xl">Seu WhatsApp atendendo hoje mesmo.</h2>
            <p className="mx-auto mt-3 max-w-xl text-base opacity-90">{site.trial_days} dias para testar com clientes reais. Se não fizer sentido, é só não continuar.</p>
            <div className="mt-6 flex justify-center">
              <Cta site={site} size="lg" className="bg-white text-brand hover:bg-slate-100 hover:opacity-100" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} {site.platform_name}. Atendimento no WhatsApp com IA e equipe humana.</p>
          <nav className="flex flex-wrap gap-4" aria-label="Links">
            <Link to="/entrar" className="hover:underline">Entrar</Link>
            {site.self_service && <Link to="/cadastro" className="hover:underline">Criar conta</Link>}
            <Link to="/acompanhamento" className="hover:underline">Novidades</Link>
            {site.support_email && <a href={`mailto:${site.support_email}`} className="hover:underline">{site.support_email}</a>}
          </nav>
        </div>
      </footer>
    </div>
  );
}
