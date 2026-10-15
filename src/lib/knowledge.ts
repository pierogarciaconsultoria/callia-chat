export type FaqRecord = {
  id: string;
  workspace_id: string;
  question: string;
  answer: string;
  is_active: boolean;
};

export type ProductRecord = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  link: string | null;
  image_url: string | null;
  is_active: boolean;
};

export type KnowledgeSourceType = "text" | "file" | "url" | "faq" | "product";
export type KnowledgeIndexStatus = "pending" | "indexing" | "indexed" | "error";

export type KnowledgeSourceRecord = {
  id: string;
  workspace_id: string;
  title: string;
  type: KnowledgeSourceType;
  content: string;
  file_path: string | null;
  source_url: string | null;
  category: string | null;
  record_id: string | null;
  is_active: boolean;
  index_status: KnowledgeIndexStatus;
  index_error: string | null;
  indexed_at: string | null;
  chunk_count: number;
};

export type KnowledgeSearchHit = {
  title: string;
  content: string;
  category: string | null;
  score: number;
};

export const UPLOADABLE_EXTENSIONS = [".txt", ".md", ".csv", ".pdf", ".docx"];

const statusLabels: Record<KnowledgeIndexStatus, string> = {
  pending: "Pendente",
  indexing: "Indexando",
  indexed: "Indexado",
  error: "Erro",
};

const statusTones: Record<KnowledgeIndexStatus, string> = {
  pending: "border-amber-300 bg-amber-100 text-amber-800",
  indexing: "border-blue-200 bg-blue-50 text-blue-800",
  indexed: "border-emerald-300 bg-emerald-100 text-emerald-800",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function getStatusLabel(status: KnowledgeIndexStatus) {
  return statusLabels[status] ?? status;
}

export function getStatusBadgeTone(status: KnowledgeIndexStatus) {
  return statusTones[status] ?? statusTones.pending;
}

export function getStatusLabelForSource(source: KnowledgeSourceRecord) {
  if (source.index_status === "error") {
    return `Erro ao indexar: ${source.index_error || "motivo nao informado"}`;
  }
  if (source.index_status === "indexed") {
    return `${source.chunk_count} ${source.chunk_count === 1 ? "trecho indexado" : "trechos indexados"}`;
  }
  return getStatusLabel(source.index_status);
}

// Segment-neutral prompts: the field stays free text, the examples only show
// that anything the company answers to its customers belongs here.
export const CATEGORY_EXAMPLES = [
  "politicas de cancelamento",
  "horarios e atendimento",
  "precos e formas de pagamento",
  "servicos oferecidos",
];
