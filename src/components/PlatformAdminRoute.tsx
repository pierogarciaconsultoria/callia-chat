import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { PageLoader } from "@/components/ui";

// Console central: exige sessão e papel platform_admin; não exige workspace selecionado.
export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { isPlatformAdmin, platformAdminLoading } = useWorkspace();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (platformAdminLoading) return <PageLoader label="Verificando permissões…" />;
  if (!isPlatformAdmin) return <Navigate to="/inbox" replace />;
  return <>{children}</>;
}
