import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui";

const mutateAsync = vi.fn(async (_body: Record<string, unknown>) => ({ source: {} }));
const source = (over: Record<string, unknown>) => ({
  id: "s1", workspace_id: "w1", kind: "text", title: "Tabela de preços", origin_id: null, url: null, storage_path: null, mime_type: null,
  status: "indexed", error: null, chunk_count: 4, embedded: true, indexed_at: "2026-10-26T15:36:00Z", created_at: "2026-10-26T15:36:00Z",
  updated_at: "2026-10-26T15:36:00Z", metadata: { pinned: true }, ...over,
});

vi.mock("@/lib/workspace", () => ({ useRequiredWorkspace: () => ({ workspaceId: "w1" }) }));
vi.mock("@/hooks/use-entitlements", () => ({ useEntitlements: () => ({ data: undefined }), invalidateEntitlements: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ createGate: () => ({ allowed: true, reason: null }) }));
vi.mock("@/hooks/use-media", () => ({ useMedia: () => ({ data: [] }) }));
vi.mock("@/components/PriceTableCard", () => ({ PriceTableCard: () => null }));
vi.mock("@/components/media/PhotosTab", () => ({ PhotosTab: () => null }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { content: "Baixa temporada: de 30/11/2026 a 20/12/2026." }, error: null }) }) }) }),
  },
}));
vi.mock("@/hooks/use-knowledge", () => ({
  sourcesKey: (ws: string) => ["knowledge_sources", ws],
  useKnowledgeSources: () => ({
    data: [source({}), source({ id: "s2", kind: "site", title: "www.exemplo.com.br", url: "https://www.exemplo.com.br/", metadata: {} })],
    isLoading: false,
    error: null,
  }),
  useKnowledgeActions: () => ({ mutateAsync, isPending: false }),
  useFaqs: () => ({ data: [] }),
  useProducts: () => ({ data: [] }),
  useSearchPreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTableCrud: () => ({ save: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() } }),
}));

import KnowledgeBase from "@/pages/KnowledgeBase";

function renderDocs() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/knowledge-base?tab=docs"]}>
          <KnowledgeBase />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("base de conhecimento: editar texto", () => {
  beforeEach(() => mutateAsync.mockClear());
  afterEach(cleanup);

  it("só textos têm o botão Editar", () => {
    renderDocs();
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(1);
  });

  it("abre com título e conteúdo atuais e salva com update_text", async () => {
    renderDocs();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const content = await screen.findByDisplayValue("Baixa temporada: de 30/11/2026 a 20/12/2026.");
    expect(screen.getByDisplayValue("Tabela de preços")).toBeTruthy();
    expect(screen.getByText(/Fixado no agente/)).toBeTruthy();
    fireEvent.change(content, { target: { value: "Baixa temporada: de 30/11/2026 a 20/12/2026 (noite de 20/12 é baixa)." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      action: "update_text",
      source_id: "s1",
      title: "Tabela de preços",
      content: "Baixa temporada: de 30/11/2026 a 20/12/2026 (noite de 20/12 é baixa).",
    }));
  });
});
