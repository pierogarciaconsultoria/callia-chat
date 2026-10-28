import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { EmptyState, ErrorState, PageLoader } from "@/components/ui";

// Exige sessão e workspace selecionado; adminOnly bloqueia o papel "agent".
// Sem sessão vai para o login; com sessão e sem workspace, para o onboarding (/bem-vindo).
export function ProtectedRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const ws = useWorkspace();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (ws.loading) return <PageLoader label="Carregando workspace…" />;
  if (ws.error) return <div className="p-6"><ErrorState error={ws.error} onRetry={() => void ws.refresh()} /></div>;
  if (!ws.workspaceId) return <Navigate to="/bem-vindo" replace />;
  if (adminOnly && !ws.isAdmin) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Acesso restrito"
        description="Esta área é exclusiva para administradores do workspace."
      />
    );
  }
  return <>{children}</>;
}
