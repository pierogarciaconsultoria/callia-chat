import {
  Building2,
  Gauge,
  Layers,
  SlidersHorizontal,
  UserCog,
  Bot,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

// Um item por pergunta: ver (Painel), atender (Inbox), configurar a IA (Agente de IA: comportamento, conhecimento,
// aprendizados, simulador), ligar sistemas (Integrações: WhatsApp, reservas, chaves de API, webhooks), gente (Equipe:
// membros, setores, distribuição, respostas rápidas), auditar (Logs) e conta (Configurações: empresa, plano, marca).
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, adminOnly: false },
  { to: "/inbox", label: "Inbox", icon: MessagesSquare, adminOnly: false },
  { to: "/agent", label: "Agente de IA", icon: Bot, adminOnly: true },
  { to: "/integrations", label: "Integrações", icon: Plug, adminOnly: true },
  { to: "/team", label: "Equipe", icon: Users, adminOnly: false },
  { to: "/logs", label: "Logs", icon: ScrollText, adminOnly: true },
  { to: "/settings", label: "Configurações", icon: Settings, adminOnly: true },
];

// Console central da plataforma (só administradores da plataforma).
export const PLATFORM_NAV_ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/admin", label: "Visão geral", icon: Gauge, end: true },
  { to: "/admin/tenants", label: "Clientes", icon: Building2 },
  { to: "/admin/plans", label: "Planos", icon: Layers },
  { to: "/admin/users", label: "Usuários", icon: UserCog },
  { to: "/admin/audit", label: "Auditoria", icon: ScrollText },
  { to: "/admin/settings", label: "Plataforma", icon: SlidersHorizontal },
];
