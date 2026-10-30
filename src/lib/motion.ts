/** true quando o sistema pede menos movimento (ou quando não dá para saber, como em testes): a página mostra tudo parado. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
