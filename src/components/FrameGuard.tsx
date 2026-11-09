// Só a página inicial pública pode ser exibida dentro de outro site (iframe: apresentações, suplementos do
// PowerPoint). O servidor já bloqueia as demais páginas com X-Frame-Options; esta guarda cobre a navegação interna
// do app feita a partir de uma página inicial embutida (clicar em "Entrar", por exemplo), para que login e painel
// nunca apareçam dentro de um quadro de terceiros.
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

export const EMBEDDABLE_PATHS = ["/"];

type FrameView = { readonly self: unknown; readonly top: unknown };

export function isFramed(win: FrameView = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

export function mustBreakOut(pathname: string, framed: boolean): boolean {
  return framed && !EMBEDDABLE_PATHS.includes(pathname);
}

export function FrameGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!mustBreakOut(location.pathname, isFramed())) return <>{children}</>;
  const href = `${location.pathname}${location.search}${location.hash}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-semibold text-neutral-900">
          Abra o Callia em uma nova aba
        </h1>
        <p className="text-sm text-neutral-600">
          Por segurança, o acesso e o painel não são exibidos dentro de outros
          sites ou aplicativos.
        </p>
        <a
          href={href}
          target="_top"
          rel="noreferrer"
          className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Abrir em nova aba
        </a>
      </div>
    </main>
  );
}
