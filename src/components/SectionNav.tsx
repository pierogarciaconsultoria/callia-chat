// Navegação secundária de um módulo (Agente de IA, Integrações): seções como links, a atual destacada.
// Itens com "#" são âncoras na própria tela (ex.: simulador) e nunca ficam "ativos".
import { Link, NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";

export interface SectionItem { to: string; label: string; end?: boolean }

const base = "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors";
const idle = "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100";
const active = "bg-brand text-brand-fg";

export function SectionNav({ items, label }: { items: SectionItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 rounded-full border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {items.map((it) => (
          <li key={it.to}>
            {it.to.includes("#") ? (
              <Link to={it.to} className={cn(base, idle)}>{it.label}</Link>
            ) : (
              <NavLink to={it.to} end={it.end} className={({ isActive }) => cn(base, isActive ? active : idle)}>{it.label}</NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const AGENT_SECTIONS: SectionItem[] = [
  { to: "/agent", label: "Comportamento", end: true },
  { to: "/agent/conhecimento", label: "Conhecimento" },
  { to: "/agent/aprendizados", label: "Aprendizados" },
  { to: "/agent#simulador", label: "Simulador" },
];

export const INTEGRATION_SECTIONS: SectionItem[] = [
  { to: "/integrations", label: "Conexões", end: true },
  { to: "/integrations/api", label: "Chaves de API" },
  { to: "/integrations/webhooks", label: "Webhooks" },
];

export const SETTINGS_SECTIONS: SectionItem[] = [
  { to: "/settings", label: "Empresa", end: true },
  { to: "/settings/plano", label: "Plano e assinatura" },
  { to: "/settings/marca", label: "Identidade visual" },
];

export const TEAM_SECTIONS: SectionItem[] = [
  { to: "/team", label: "Membros", end: true },
  { to: "/team/distribuicao", label: "Distribuição" },
  { to: "/team/respostas", label: "Respostas rápidas" },
];

export function SettingsNav() {
  return <SectionNav items={SETTINGS_SECTIONS} label="Seções de configurações" />;
}

export function TeamNav() {
  return <SectionNav items={TEAM_SECTIONS} label="Seções da equipe" />;
}

export function AgentNav() {
  return <SectionNav items={AGENT_SECTIONS} label="Seções do agente" />;
}

export function IntegrationsNav() {
  return <SectionNav items={INTEGRATION_SECTIONS} label="Seções de integrações" />;
}
