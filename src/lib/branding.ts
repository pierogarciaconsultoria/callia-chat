// Converte #rrggbb em "r g b" para as variáveis CSS consumidas pelo Tailwind (rgb(var(--brand) / alpha)).
export function hexToRgbTriplet(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// Texto branco ou quase preto conforme a luminância da cor de fundo.
export function readableForeground(hex: string | null | undefined): string {
  const t = hexToRgbTriplet(hex);
  if (!t) return "255 255 255";
  const [r, g, b] = t.split(" ").map((v) => Number(v) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? "15 23 42" : "255 255 255";
}

export const DEFAULT_PRIMARY = "#186e71";
export const DEFAULT_SECONDARY = "#f59e0b";

export function applyBranding(primary?: string | null, secondary?: string | null) {
  const root = document.documentElement;
  root.style.setProperty("--brand", hexToRgbTriplet(primary) ?? hexToRgbTriplet(DEFAULT_PRIMARY)!);
  root.style.setProperty("--brand-fg", readableForeground(primary ?? DEFAULT_PRIMARY));
  root.style.setProperty("--brand-accent", hexToRgbTriplet(secondary) ?? hexToRgbTriplet(DEFAULT_SECONDARY)!);
}

/**
 * Páginas públicas (landing, login, cadastro, termos) ficam sempre na marca Callia: estas variáveis, aplicadas no
 * elemento raiz da página, sobrepõem a identidade do cliente que applyBranding grava em :root quando há sessão.
 */
export const CALLIA_BRAND_STYLE = {
  "--brand": hexToRgbTriplet(DEFAULT_PRIMARY)!,
  "--brand-fg": readableForeground(DEFAULT_PRIMARY),
  "--brand-accent": hexToRgbTriplet(DEFAULT_SECONDARY)!,
} as Record<string, string>;
