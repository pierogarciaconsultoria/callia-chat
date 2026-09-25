import { ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceBranding } from "@/hooks/use-workspace-branding";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Inbox,
  Bot,
  MessageSquare,
  KeyRound,
  Webhook,
  Users,
  ScrollText,
  Settings,
  LogOut,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type NavEntry = { to: string; label: string; icon: any };

const mainNav: NavEntry[] = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
];

const settingsNav: NavEntry[] = [
  { to: "/settings", label: "Workspace", icon: Settings },
  { to: "/agent", label: "Agente IA", icon: Bot },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { to: "/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/team", label: "Time", icon: Users },
  { to: "/logs", label: "Logs", icon: ScrollText },
];

function NavItem({ to, label, icon: Icon }: NavEntry) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
          isActive
            ? "bg-secondary text-secondary-foreground font-medium"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

function NavTree({ label, icon: Icon, items }: { label: string; icon: any; items: NavEntry[] }) {
  const location = useLocation();
  const isChildActive = items.some((item) => location.pathname.startsWith(item.to));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
          isChildActive
            ? "text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
        <ChevronRight
          className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-5 space-y-1 border-l pl-2">
          {items.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function AppLayout({ children }: { children?: ReactNode }) {
  const { user, signOut } = useAuth();
  const { workspaces, currentWorkspace, setCurrentWorkspaceId } = useWorkspace();
  const { branding, displayName } = useWorkspaceBranding();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Avatar
              className="h-9 w-9 rounded-md"
              style={{ backgroundColor: branding?.primary_color ?? undefined }}
            >
              {branding?.logo_url ? (
                <AvatarImage src={branding.logo_url} alt={displayName} />
              ) : null}
              <AvatarFallback className="rounded-md text-white">
                <Sparkles className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-semibold">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {branding?.custom_domain || currentWorkspace?.slug || "Workspace"}
              </div>
            </div>
          </div>
          {workspaces.length > 0 && (
            <Select
              value={currentWorkspace?.id}
              onValueChange={(v) => setCurrentWorkspaceId(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {mainNav.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          <NavTree label="Configurações" icon={Settings} items={settingsNav} />
        </nav>
        <div className="p-3 border-t">
          <div className="text-xs text-muted-foreground truncate mb-2">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children ?? <Outlet />}</main>
    </div>
  );
}
