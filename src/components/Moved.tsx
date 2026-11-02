// Redireciona um endereço antigo para o novo mantendo a query (?tab=…) e a âncora (#…).
import { Navigate, useLocation } from "react-router-dom";

export function Moved({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}
