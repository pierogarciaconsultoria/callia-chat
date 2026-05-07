import { LoaderCircle } from "lucide-react";

export default function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex max-w-sm items-center gap-3 rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
        <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
        <span>Carregando modulo do painel...</span>
      </div>
    </div>
  );
}
