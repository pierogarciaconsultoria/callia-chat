import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { workspaces, loading: wsLoading, currentWorkspace } = useWorkspace();
  const location = useLocation();

  if (loading || (user && wsLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (workspaces.length > 0 && !currentWorkspace) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando workspace...
      </div>
    );
  }
  return <>{children}</>;
}
