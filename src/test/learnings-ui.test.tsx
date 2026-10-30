import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LearningRun, LearningSuggestion } from "@/lib/database.types";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(async (_v: { id: string; payload?: Record<string, unknown> }) => ({ status: "applied" as const, kind: "faq" })),
  dismiss: vi.fn(async (_id: string) => ({ status: "dismissed" as const })),
  run: vi.fn(async () => ({ run_id: "r2", conversations_analyzed: 5, suggestions_created: 2 })),
  toast: { success: vi.fn(), error: vi.fn() },
}));
const state = vi.hoisted(() => ({ status: "pending" as string, suggestions: [] as LearningSuggestion[], runs: [] as LearningRun[] }));

vi.mock("@/lib/workspace", () => ({ useRequiredWorkspace: () => ({ workspaceId: "ws", isAdmin: true }) }));
vi.mock("@/hooks/use-learnings", () => ({
  useLearningSuggestions: (_ws: string, status: string) => { state.status = status; return { data: state.suggestions.filter((s) => s.status === status), isLoading: false, error: null, refetch: vi.fn() }; },
  useLearningRuns: () => ({ data: state.runs }),
  useLearningActions: () => ({
    run: { mutateAsync: mocks.run, isPending: false },
    apply: { mutateAsync: mocks.apply, isPending: false },
    dismiss: { mutateAsync: mocks.dismiss, isPending: false },
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));

import Learnings from "@/pages/Learnings";

const base = { workspace_id: "ws", run_id: "r1", fingerprint: "x", occurrences: 1, status: "pending" as const, decided_by: null, decided_at: null, applied_payload: null, created_at: "2026-10-30T07:00:00Z", updated_at: "2026-10-30T07:00:00Z" };
const faqNoAnswer: LearningSuggestion = { ...base, id: "s1", kind: "faq", title: "Estacionamento", rationale: "Dois clientes perguntaram e a IA transferiu.", occurrences: 2,
  payload: { question: "Tem estacionamento?", answer: null }, evidence: [{ conversation_id: "c1", contact: "Ana", excerpts: [{ who: "cliente", text: "tem estacionamento?" }, { who: "ia", text: "Vou chamar a equipe." }] }] };
const policy: LearningSuggestion = { ...base, id: "s2", kind: "policy", title: "Pets", rationale: "A equipe informou a regra.",
  payload: { topic: "pets", title: "Animais", content: "Aceitamos até 10 kg, taxa de R$ 50.", id: "p1" }, evidence: [{ conversation_id: "c2", contact: "Bia", excerpts: [{ who: "equipe", text: "Aceitamos até 10 kg, taxa de R$ 50." }] }] };
const applied: LearningSuggestion = { ...base, id: "s3", kind: "guardrail", title: "Não prometer upgrade", rationale: "x", status: "applied", decided_at: "2026-10-29T10:00:00Z",
  payload: { text: "Não prometa upgrade." }, applied_payload: { text: "Nunca prometa upgrade de acomodação." }, evidence: [] };
const run: LearningRun = { id: "r1", workspace_id: "ws", trigger: "schedule", period_start: "2026-10-29T07:00:00Z", period_end: "2026-10-30T07:00:00Z", status: "done", conversations_analyzed: 12, suggestions_created: 2, error: null, created_at: "2026-10-30T07:00:00Z", finished_at: "2026-10-30T07:01:00Z" };

const show = () => render(<MemoryRouter><Learnings /></MemoryRouter>);

afterEach(() => { cleanup(); mocks.apply.mockClear(); mocks.dismiss.mockClear(); mocks.run.mockClear(); mocks.toast.success.mockClear(); mocks.toast.error.mockClear(); state.suggestions = []; state.runs = []; });

describe("aprendizados (tela)", () => {
  it("sem análise ainda: aviso e lista vazia; 'Analisar agora' chama a function e resume o resultado", async () => {
    show();
    expect(screen.getByText(/Nenhuma análise ainda/)).toBeTruthy();
    expect(screen.getByText("Nenhuma sugestão aguardando")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Analisar agora/ }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalled());
    expect(mocks.toast.success).toHaveBeenCalledWith("5 conversa(s) analisada(s): 2 sugestão(ões) nova(s).");
  });

  it("pergunta sem resposta: aprovar fica bloqueado até escrever; evidência abre com link para a conversa", async () => {
    state.suggestions = [faqNoAnswer];
    state.runs = [run];
    show();
    expect(screen.getByText(/Última análise:/).textContent).toMatch(/12 conversa\(s\) · 2 sugestão/);
    expect(screen.getByText("Pergunta e resposta")).toBeTruthy();
    expect(screen.getByText(/em 2 conversas/)).toBeTruthy();
    const approve = screen.getByRole("button", { name: /Aprovar/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByText(/Ver trechos das conversas/));
    expect(screen.getByText("tem estacionamento?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir conversa" }).getAttribute("href")).toBe("/inbox/c1");
    fireEvent.change(screen.getByLabelText("Resposta"), { target: { value: "Sim, gratuito e coberto." } });
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ id: "s1", payload: { question: "Tem estacionamento?", answer: "Sim, gratuito e coberto." } }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Pergunta adicionada à base.");
  });

  it("política existente: campos editáveis, selo 'altera política existente', descartar chama a function", async () => {
    state.suggestions = [policy];
    show();
    expect(screen.getByText("altera política existente")).toBeTruthy();
    expect((screen.getByLabelText("Assunto") as HTMLSelectElement).value).toBe("pets");
    fireEvent.change(screen.getByLabelText("Texto da política"), { target: { value: "Aceitamos animais de até 10 kg mediante taxa de R$ 50." } });
    fireEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith({ id: "s2", payload: { topic: "pets", title: "Animais", content: "Aceitamos animais de até 10 kg mediante taxa de R$ 50." } }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Política atualizada.");
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith("s2"));
  });

  it("aba Aplicadas mostra o que foi gravado (já com a edição do admin)", () => {
    state.suggestions = [applied];
    show();
    fireEvent.click(screen.getByRole("tab", { name: "Aplicadas" }));
    expect(screen.getByText("Não prometer upgrade")).toBeTruthy();
    expect(screen.getByText("Nunca prometa upgrade de acomodação.")).toBeTruthy();
    expect(screen.getByText(/aplicada em/)).toBeTruthy();
  });
});
