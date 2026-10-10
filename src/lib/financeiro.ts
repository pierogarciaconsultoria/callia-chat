import type { Tables } from '@/integrations/supabase/types';

export type Lancamento = Tables<'financial_entries'>;

/** Valor de Select para "nenhum" (o Radix Select não aceita string vazia). */
export const NENHUM = '__nenhum__';
export const doBanco = (v: string | null) => v ?? NENHUM;
export const paraBanco = (v: string) => (v === NENHUM ? null : v);

export const TODOS = 'all';

export const STATUS_LANCAMENTO: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pendente: { label: 'Pendente', variant: 'outline' },
  vencido: { label: 'Vencido', variant: 'destructive' },
  pago: { label: 'Pago', variant: 'default' },
  cancelado: { label: 'Cancelado', variant: 'secondary' },
};

export const PAGO_POR = [
  { value: 'empresa', label: 'Empresa' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'terceiro', label: 'Terceiro' },
] as const;

export type PagoPor = (typeof PAGO_POR)[number]['value'];

export function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "vencido" é derivado: pendente com vencimento anterior a hoje. */
export function statusExibido(status: string, dueDate: string | null, hoje = hojeISO()): string {
  if (status === 'pendente' && dueDate && dueDate < hoje) return 'vencido';
  return status;
}

export function formatarData(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatarCompetencia(iso: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 10).split('-');
  return `${m}/${y}`;
}

export const formatarMoeda = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
