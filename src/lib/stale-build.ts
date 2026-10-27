// Depois de um deploy, uma aba aberta com a versão anterior pede arquivos (chunks) que mudaram de nome.
// Nesse caso recarregamos a página uma vez para pegar a versão nova, em vez de mostrar erro.

const KEY = "callia.stale-build-reload";
const WINDOW_MS = 30_000;

const STALE_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return STALE_RE.test(message);
}

/** Recarrega uma vez; se já recarregou há pouco (o erro persiste), devolve false para mostrar o erro. */
export function reloadForNewVersion(now = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (last && now - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // Sem sessionStorage (janela privada bloqueada): recarrega mesmo assim; no pior caso aparece o erro depois.
  }
  reload();
  return true;
}
