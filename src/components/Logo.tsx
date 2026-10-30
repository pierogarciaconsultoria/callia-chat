// Logotipo do Callia (arquivos em public/). Versão clara no tema claro e versão com traços claros no tema escuro.
import { cn } from "@/lib/cn";

export function CalliaLogo({ className, alt = "Callia Chat" }: { className?: string; alt?: string }) {
  return (
    <>
      <img src="/callia-logo.png" alt={alt} className={cn("w-auto dark:hidden", className)} draggable={false} />
      <img src="/callia-logo-dark.png" alt={alt} className={cn("hidden w-auto dark:block", className)} draggable={false} />
    </>
  );
}

/** Só o símbolo (balão), para espaços pequenos como a barra lateral recolhida. */
export function CalliaIcon({ className, alt = "Callia Chat" }: { className?: string; alt?: string }) {
  return <img src="/callia-icon.png" alt={alt} className={cn("aspect-square w-auto", className)} draggable={false} />;
}
