import {
  Building2,
  Gauge,
  GraduationCap,
  Layers,
  SlidersHorizontal,
  UserCog,
  Bot,
  BookOpen,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  ScrollText,
  Settings,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard, adminOnly: false },
  { to: "/inbox", label: "Inbox", icon: MessagesSquare, adminOnly: false },
  { to: "/agent", label: "Atendimento", icon: Bot, adminOnly: true },
  { to: "/knowledge-base", label: "Informações da empresa", icon: BookOpen, adminOnly: true },
  { to: "/learnings", label: "Aprendizados", icon: GraduationCap, adminOnly: true },
  // WhatsApp e sistema de reservas ficam em Integrações; /whatsapp segue acessível pelo cartão do WhatsApp.
  { to: "/integrations", label: "Integrações", icon: Plug, adminOnly: true },
  { to: "/api-keys", label: "Chaves de API", icon: KeyRound, adminOnly: true },
  { to: "/webhooks", label: "Webhooks", icon: Webhook, adminOnly: true },
  { to: "/logs", label: "Logs", icon: ScrollText, adminOnly: true },
  { to: "/team", label: "Equipe", icon: Users, adminOnly: false },
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
