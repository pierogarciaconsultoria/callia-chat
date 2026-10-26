import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, LogOut, Menu, MessageCircle, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { PageLoader } from "@/components/ui";
import { NAV_ITEMS, PLATFORM_NAV_ITEMS } from "./nav";
import { PlanBanner } from "./PlanBanner";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-brand/10 text-brand dark:bg-brand/20"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
  );

const ROLE_LABEL = { owner: "Proprietário", admin: "Administrador", agent: "Atendente" } as const;

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { workspaces, workspace, selectWorkspace, isAdmin, isPlatformAdmin, branding, role } = useWorkspace();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isInbox = location.pathname.startsWith("/inbox");
  const inConsole = location.pathname.startsWith("/admin");
  const items = workspace ? NAV_ITEMS.filter((i) => isAdmin || !i.adminOnly) : [];
  const title = inConsole ? "Console da plataforma" : branding?.display_name || workspace?.name || "Callia Chat";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        {branding?.logo_url ? (
          <img src={branding.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg">
            <MessageCircle className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">Callia Chat</p>
        </div>
      </div>

      {workspaces.length > 1 && !inConsole && (
        <div className="px-3 pb-2">
          <label className="sr-only" htmlFor="ws-switcher">
            Workspace
          </label>
          <select
            id="ws-switcher"
            value={workspace?.id ?? ""}
            onChange={(e) => {
              selectWorkspace(e.target.value);
              setOpen(false);
            }}
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {inConsole && workspace && (
          <NavLink to="/dashboard" onClick={() => setOpen(false)} className={linkClass({ isActive: false })}>
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Voltar ao workspace
          </NavLink>
        )}
        {!inConsole &&
          items.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} className={linkClass}>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        {isPlatformAdmin && (
          <div className={cn(!inConsole && "mt-4 border-t border-slate-200 pt-3 dark:border-slate-800")}>
            <p className="flex items-center gap-1.5 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Plataforma
            </p>
            {(inConsole ? PLATFORM_NAV_ITEMS : PLATFORM_NAV_ITEMS.slice(0, 1)).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className={linkClass}>
                <item.icon className="h-4 w-4 shrink-0" />
                {inConsole ? item.label : "Console da plataforma"}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-800">
        <p className="truncate px-1 text-xs text-slate-500 dark:text-slate-400" title={user?.email ?? ""}>
          {user?.email}
        </p>
        {role && !inConsole && <p className="px-1 text-xs text-slate-400">{ROLE_LABEL[role]}</p>}
        {inConsole && <p className="px-1 text-xs text-slate-400">Administrador da plataforma</p>}
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 max-w-[85vw] bg-white shadow-xl dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-3 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-semibold">{title}</span>
        </header>
        {workspace && !inConsole && <PlanBanner />}
        <main className={cn("min-w-0 flex-1", isInbox ? "" : "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6")}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
