import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let cnae: string | null = "5510802";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cnae_code: cnae }, error: null }) }) }) }),
  },
}));

import { SegmentFields } from "@/components/SegmentFields";

function renderFields(segmentId: string | null, onChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SegmentFields workspaceId="w1" segmentId={segmentId} emojiPolicy={null} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

afterEach(() => {
  cleanup();
  cnae = "5510802";
});

describe("segmento na página do agente", () => {
  it("sugere o segmento pelo CNAE e aplica com um clique", async () => {
    const onChange = renderFields(null);
    expect(await screen.findByText(/o segmento sugerido é/)).toBeTruthy();
    expect(screen.getByText("5510-8/02", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    expect(onChange).toHaveBeenCalledWith({ segment_id: "hotelaria" });
  });

  it("com segmento escolhido: mostra o que ele acrescenta e o padrão de emoji", () => {
    renderFields("saude");
    expect(screen.getByText("O que o segmento acrescenta ao agente")).toBeTruthy();
    expect(screen.getByText(/192 \(SAMU\)/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Padrão do segmento (sem emojis)" })).toBeTruthy();
    expect(screen.queryByText(/o segmento sugerido é/)).toBeNull();
  });

  it("trocar para Nenhum limpa o segmento", () => {
    const onChange = renderFields("varejo");
    fireEvent.change(screen.getByLabelText("Segmento do negócio"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ segment_id: null });
  });
});
