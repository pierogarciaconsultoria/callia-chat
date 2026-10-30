// Landing comercial (/): o que o Callia faz, como funciona, planos e chamada para o teste grátis.
// Planos e configurações vêm de public_site_info (sem login). Nada aqui inventa números ou depoimentos.
// Cor de destaque (âmbar, --brand-accent) só no que deve puxar o olho: chamada principal, plano recomendado e marcações.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, Bot, CalendarCheck, Check, ChevronDown, Clock, Images, KeyRound, MessageCircle, Mic, ReceiptText, ShieldCheck, Sparkles, Users, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatPlanPrice, planHighlights, SITE_FALLBACK, useSiteInfo, type SiteInfo } from "@/lib/site";
import { SEGMENT_LIST } from "@/lib/segments";
import { cn } from "@/lib/cn";
import { CALLIA_BRAND_STYLE } from "@/lib/branding";
import { Reveal } from "@/components/landing/Reveal";
import { ChatDemo } from "@/components/landing/ChatDemo";
import { CalliaLogo } from "@/components/Logo";

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

const BEFORE = [
  "Cliente escreve às 23h e só recebe resposta no dia seguinte, quando já fechou com outro.",
  "Cada atendente informa um valor; o cliente recebe dois preços diferentes.",
  "Fotos, link de reserva e políticas espalhados em conversas antigas e grupos.",
  "Comprovante de PIX chega e ninguém vê; a confirmação atrasa.",
];
const AFTER = [
  "Resposta em segundos, a qualquer hora, com o tom da sua empresa.",
  "Um preço só, da tabela oficial; disponibilidade direto do sistema de reservas.",
  "Fotos e link preenchido na hora em que o cliente pede.",
  "Comprovante guardado, marcado na inbox e passado para alguém conferir.",
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: "Preciso trocar de número ou de chip?", a: "Não. Você conecta o número atual lendo um QR code, como no WhatsApp Web. As conversas continuam no seu celular e também aparecem no Callia." },
  { q: "O agente pode inventar preço ou dizer que tem vaga?", a: "Não. Os valores vêm da tabela de preços cadastrada e a disponibilidade do sistema de reservas. Sem essa informação, ele diz que vai confirmar com a equipe e transfere." },
  { q: "E quando o cliente quer falar com uma pessoa?", a: "Basta pedir: o agente transfere na hora. Você também define palavras-chave e situações (reclamação, pagamento) que sempre vão para a equipe." },
  { q: "Quanto tempo leva para começar?", a: "Em torno de 15 minutos: a IA monta o agente a partir do seu site, você revisa, testa no simulador e conecta o WhatsApp." },
  { q: "Preciso de cartão de crédito para testar?", a: "Não. O período de teste é liberado no cadastro, com limites reduzidos. Para continuar, você escolhe um plano." },
  { q: "Meus dados e as conversas ficam seguros?", a: "Cada empresa tem um espaço isolado. Arquivos recebidos ficam em área privada, acessível só pela sua equipe. Nada é compartilhado entre clientes." },
];

function Section({ id, eyebrow, title, text, children, className, center }: { id: string; eyebrow?: string; title: ReactNode; text?: string; children: ReactNode; className?: string; center?: boolean }) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24", className)}>
      <div className="mx-auto max-w-6xl">
        <Reveal className={cn("max-w-2xl", center && "mx-auto text-center")}>
          {eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-brand">{eyebrow}</p>}
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
          {text && <p className="mt-3 text-base text-slate-600 dark:text-slate-400 sm:text-lg">{text}</p>}
        </Reveal>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** Palavra marcada com o traço âmbar por baixo. */
function Mark({ children }: { children: ReactNode }) {
  // Fundo em gradiente (e não um elemento posicionado) para a marcação acompanhar a quebra de linha do texto.
  return <span className="bg-[linear-gradient(transparent_62%,rgb(var(--brand-accent)/0.55)_62%)] px-0.5">{children}</span>;
}

const CTA_PRIMARY = "bg-brand-accent text-slate-900 shadow-md shadow-brand-accent/30 hover:-translate-y-0.5 hover:brightness-105 hover:shadow-lg";

function Cta({ site, className, size = "md", variant = "primary" }: { site: SiteInfo; className?: string; size?: "md" | "lg"; variant?: "primary" | "brand" }) {
  const base = cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200",
    size === "lg" ? "h-12 px-7 text-base" : "h-10 px-4 text-sm",
    variant === "primary" ? CTA_PRIMARY : "bg-brand text-brand-fg shadow-sm hover:opacity-90",
    className,
  );
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

function PlanCard({ plan, site, featured, index }: { plan: SiteInfo["plans"][number]; site: SiteInfo; featured: boolean; index: number }) {
  const isTrial = plan.code === "trial";
  const contactOnly = !isTrial && plan.price_cents === null;
  return (
    <Reveal delay={index * 90} className="h-full">
      <div className={cn(
        "relative flex h-full flex-col rounded-2xl border bg-white p-6 transition-transform duration-300 hover:-translate-y-1 dark:bg-slate-900",
        featured ? "border-brand-accent shadow-xl shadow-brand-accent/20 ring-2 ring-brand-accent lg:-mt-3 lg:mb-3" : "border-slate-200 shadow-sm hover:shadow-md dark:border-slate-800",
      )}>
        {featured && <span className="absolute -top-3 left-6 rounded-full bg-brand-accent px-3 py-1 text-xs font-bold text-slate-900 shadow">Comece por aqui</span>}
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {plan.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{plan.description}</p>}
        <p className="mt-4 text-3xl font-bold tracking-tight">{isTrial ? `${site.trial_days} dias grátis` : formatPlanPrice(plan)}</p>
        <ul className="mt-5 space-y-2.5 text-sm">
          {planHighlights(plan).map((h) => (
            <li key={h} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> {h}</li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          {/* Plano sob consulta (sem preço): contato, não cadastro. */}
          <Cta site={contactOnly ? { ...site, self_service: false } : site} className="w-full" variant={featured ? "primary" : "brand"} />
        </div>
      </div>
    </Reveal>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const siteQuery = useSiteInfo();
  const site = siteQuery.data ?? SITE_FALLBACK;
  const plans = site.plans;

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100" style={CALLIA_BRAND_STYLE} data-testid="landing-root">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center" aria-label={site.platform_name}>
            <CalliaLogo className="h-9" alt={site.platform_name} />
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-slate-600 md:flex dark:text-slate-400" aria-label="Seções">
            {NAV.map((n) => <a key={n.href} href={n.href} className="transition-colors hover:text-brand">{n.label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <Link to="/dashboard" className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all", CTA_PRIMARY)}>
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
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-20 pt-14 sm:px-6 sm:pt-24">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute inset-0 bg-gradient-to-b from-brand/10 via-transparent to-transparent" />
            <div className="landing-float absolute -left-24 top-10 h-80 w-80 rounded-full bg-brand/25 blur-3xl" />
            <div className="landing-float-slow absolute right-0 top-40 h-96 w-96 rounded-full bg-brand-accent/25 blur-3xl" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(100,116,139,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(100,116,139,0.08)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Reveal>
                <p className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-white/70 px-3 py-1 text-xs font-semibold text-brand backdrop-blur dark:bg-slate-900/60">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Atendimento no WhatsApp com IA
                </p>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl">
                  Responda cada cliente <Mark>em segundos</Mark>, 24 horas por dia, sem perder o controle.
                </h1>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 max-w-xl text-lg text-slate-600 dark:text-slate-400 sm:text-xl">
                  O {site.platform_name} coloca um agente de IA no WhatsApp da sua empresa. Ele conhece seus preços, políticas e fotos, responde na hora e passa para a sua equipe quando precisa.
                </p>
              </Reveal>
              <Reveal delay={240}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Cta site={site} size="lg" />
                  <a href="#como-funciona" className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white/70 px-7 text-base font-medium backdrop-blur transition-colors hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900/60">
                    Ver como funciona <ChevronDown className="h-4 w-4" aria-hidden />
                  </a>
                </div>
                <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> {site.trial_days} dias grátis</li>
                  <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Sem cartão de crédito</li>
                  <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-600" aria-hidden /> Seu número, seus dados</li>
                </ul>
              </Reveal>
              <Reveal delay={320}>
                <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-slate-200 pt-6 dark:border-slate-800">
                  {[
                    ["Segundos", "para responder, de dia ou de madrugada"],
                    ["24 h", "sete dias por semana, sem fila"],
                    ["Zero", "preços ou vagas inventados"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">{k}</dt>
                      <dd className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>
            <Reveal delay={200}>
              <ChatDemo />
            </Reveal>
          </div>
        </section>

        {/* Antes / depois */}
        <Section id="antes-depois" eyebrow="O que muda" title={<>O WhatsApp da empresa <Mark>sem fila</Mark> e sem chute.</>} text="A maior parte das vendas perdidas no WhatsApp some em dois lugares: na demora e na informação errada." center>
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-900/40">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Hoje, sem o Callia</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                  {BEFORE.map((t) => <li key={t} className="flex gap-2.5"><X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden /> {t}</li>)}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="relative h-full overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 to-brand-accent/10 p-6">
                <p className="text-sm font-semibold uppercase tracking-wide text-brand">Com o Callia</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
                  {AFTER.map((t) => <li key={t} className="flex gap-2.5"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-accent"><Check className="h-3 w-3 text-slate-900" aria-hidden /></span> {t}</li>)}
                </ul>
              </div>
            </Reveal>
          </div>
        </Section>

        <Section id="beneficios" eyebrow="Por que o Callia" title="Um atendente que nunca dorme e nunca chuta." text="Feito para negócios que vendem pelo WhatsApp e não podem errar valor, prazo ou disponibilidade." className="bg-slate-50 dark:bg-slate-900/40">
          <div className="grid gap-6 md:grid-cols-3">
            {BENEFITS.map((b, i) => (
              <Reveal key={b.title} delay={i * 100} className="h-full">
                <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-brand-fg"><b.icon className="h-5 w-5" aria-hidden /></span>
                  <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{b.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section id="como-funciona" eyebrow="Como funciona" title={<>Do cadastro ao primeiro atendimento em cerca de <Mark>15 minutos</Mark>.</>} text="Uma jornada guiada dentro do painel mostra o próximo passo até o agente estar no ar.">
          <ol className="relative grid gap-6 md:grid-cols-3">
            <div className="pointer-events-none absolute left-[16%] right-[16%] top-10 hidden h-px bg-gradient-to-r from-brand/0 via-brand/50 to-brand/0 md:block" aria-hidden />
            {STEPS.map((s, i) => (
              <Reveal key={s.title} as="li" delay={i * 120} className="relative rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full bg-brand text-base font-bold text-brand-fg ring-4 ring-white dark:ring-slate-900">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{s.text}</p>
                <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-brand-accent/15 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"><Clock className="h-3.5 w-3.5" aria-hidden /> cerca de {s.minutes} min</p>
              </Reveal>
            ))}
          </ol>
        </Section>

        <Section id="recursos" eyebrow="Recursos" title="Tudo o que o atendimento precisa, no mesmo lugar." className="bg-slate-50 dark:bg-slate-900/40">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 80} className="h-full">
                <div className="group h-full rounded-2xl border border-slate-200 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand transition-colors group-hover:bg-brand-accent group-hover:text-slate-900"><f.icon className="h-5 w-5" aria-hidden /></span>
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section id="segmentos" eyebrow="Segmentos" title="Boas práticas e regras do seu setor já incluídas." text="Ao escolher o segmento, o agente recebe o tom, os cuidados e as exigências legais da área. Você ajusta o que quiser.">
          <ul className="flex flex-wrap gap-2.5">
            {SEGMENT_LIST.map((s, i) => (
              <Reveal key={s.id} as="li" delay={i * 40} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium transition-colors hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900">
                {s.label}
              </Reveal>
            ))}
          </ul>
        </Section>

        <Section id="planos" eyebrow="Planos" title="Comece grátis e cresça quando fizer sentido." text="Os limites valem por empresa. Mensagens automáticas são as enviadas pelo agente e pela API; as da equipe não contam." className="bg-slate-50 dark:bg-slate-900/40" center>
          {plans.length ? (
            <div className={cn("grid gap-6 md:grid-cols-2", plans.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
              {plans.map((p, i) => <PlanCard key={p.code} plan={p} site={site} featured={p.code === "trial"} index={i} />)}
            </div>
          ) : (
            <p className="text-center text-sm text-slate-500">{siteQuery.isLoading ? "Carregando planos…" : "Fale com a gente para conhecer os planos."}</p>
          )}
        </Section>

        <Section id="perguntas" eyebrow="Perguntas frequentes" title="O que mais perguntam antes de começar.">
          <div className="grid gap-3 md:grid-cols-2">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={(i % 2) * 80}>
                <details className="group rounded-xl border border-slate-200 bg-white p-4 transition-colors open:border-brand/40 dark:border-slate-800 dark:bg-slate-900">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </Section>

        <section className="px-4 pb-24 sm:px-6">
          <Reveal>
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-teal-900 px-6 py-14 text-center text-brand-fg sm:px-12">
              <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-accent/30 blur-3xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
              <Bot className="mx-auto h-10 w-10" aria-hidden />
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Seu WhatsApp atendendo hoje mesmo.</h2>
              <p className="mx-auto mt-3 max-w-xl text-base opacity-90 sm:text-lg">{site.trial_days} dias para testar com clientes reais. Se não fizer sentido, é só não continuar.</p>
              <div className="mt-8 flex justify-center">
                <Cta site={site} size="lg" />
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalliaLogo className="h-7" alt={site.platform_name} />
            <p>© {new Date().getFullYear()} {site.platform_name}. Atendimento no WhatsApp com IA e equipe humana.</p>
          </div>
          <nav className="flex flex-wrap gap-4" aria-label="Links">
            <Link to="/entrar" className="hover:underline">Entrar</Link>
            {site.self_service && <Link to="/cadastro" className="hover:underline">Criar conta</Link>}
            <Link to="/acompanhamento" className="hover:underline">Novidades</Link>
            <Link to="/termos" className="hover:underline">Termos de Uso</Link>
            <Link to="/privacidade" className="hover:underline">Privacidade</Link>
            {site.support_email && <a href={`mailto:${site.support_email}`} className="hover:underline">{site.support_email}</a>}
          </nav>
        </div>
        <p className="mx-auto mt-4 max-w-6xl text-xs text-slate-400 dark:text-slate-500">
          TrIAd Solution · CNPJ 49.732.652/0001-00 · <a href="mailto:contato@triadsolution.com.br" className="hover:underline">contato@triadsolution.com.br</a>
        </p>
      </footer>

      {/* Celular: chamada fixa no rodapé (só quando há cadastro aberto e ninguém logado). */}
      {site.self_service && !user && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 p-3 backdrop-blur sm:hidden dark:border-slate-800 dark:bg-slate-950/90" data-testid="sticky-cta">
          <Cta site={site} className="w-full" />
        </div>
      )}
    </div>
  );
}
