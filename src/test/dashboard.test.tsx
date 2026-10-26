import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { bucketLabel, bucketTitle, compact, delta, duration, labeledCounts, niceTicks, percent, rangeFor, TOOL_LABELS, trimFuture } from "@/lib/dashboard";
import { BarList, DataTable, StackedBar } from "@/components/charts";

const today = new Date(2026, 9, 26, 15, 0);

describe("painel: períodos", () => {
  it("presets viram intervalos inclusivos na data local", () => {
    expect(rangeFor("today", today)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(rangeFor("7d", today)).toEqual({ from: "2026-10-20", to: "2026-10-26" });
    expect(rangeFor("30d", today)).toEqual({ from: "2026-09-27", to: "2026-10-26" });
    expect(rangeFor("month", today)).toEqual({ from: "2026-10-01", to: "2026-10-26" });
  });
  it("personalizado aceita datas invertidas e vazias", () => {
    expect(rangeFor("custom", today, { from: "2026-10-20", to: "2026-10-10" })).toEqual({ from: "2026-10-10", to: "2026-10-20" });
    expect(rangeFor("custom", today, { from: "", to: "" })).toEqual({ from: "2026-10-26", to: "2026-10-26" });
  });
});

describe("painel: indicadores", () => {
  it("percentual, variação e formatação", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
    expect(delta(12, 8)).toEqual({ diff: 4, pct: 50 });
    expect(delta(3, 0)).toEqual({ diff: 3, pct: null });
    expect(delta(null, 4)).toBeNull();
    expect(compact(1284)).toBe("1.284");
    expect(compact(12900)).toBe("12,9 mil");
  });
  it("durações legíveis", () => {
    expect(duration(8)).toBe("8 s");
    expect(duration(130)).toBe("2 min");
    expect(duration(3900)).toBe("1 h 5 min");
    expect(duration(null)).toBe("—");
  });
  it("eixo com passos inteiros", () => {
    expect(niceTicks(10)).toEqual([0, 5, 10]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("rótulos do eixo X e do tooltip", () => {
    expect(bucketLabel("2026-10-26", "day")).toBe("26/10");
    expect(bucketLabel("2026-10-26T14:00", "hour")).toBe("14h");
    expect(bucketTitle("2026-10-26T14:00", "hour")).toBe("26/10, 14h–15h");
  });
  it("hoje por hora: corta as horas que ainda não chegaram", () => {
    const pts = ["13", "14", "15", "16"].map((h) => ({ t: `2026-10-26T${h}:00`, received: 1, bot: 1, agent: 0 }));
    // 18h UTC = 15h em São Paulo
    const now = new Date("2026-10-26T18:30:00Z");
    expect(trimFuture(pts, "hour", "America/Sao_Paulo", now).map((p) => p.t.slice(11, 13))).toEqual(["13", "14", "15"]);
    expect(trimFuture(pts, "day", "America/Sao_Paulo", now)).toHaveLength(4);
  });
  it("ferramentas rotuladas e ordenadas, sem zeros", () => {
    expect(labeledCounts({ calcular_valor: 2, consultar_disponibilidade: 3, enviar_fotos: 0 }, TOOL_LABELS).map((i) => i.label))
      .toEqual(["Consultas de disponibilidade", "Cotações pela tabela de preços"]);
  });
});

describe("painel: componentes", () => {
  it("barra empilhada mostra valor e percentual de cada parte na legenda", () => {
    render(<StackedBar total={4} parts={[
      { key: "ai", label: "Resolvidas pela MarIA", value: 3, color: "red" },
      { key: "team", label: "Assumidas pela equipe", value: 1, color: "blue" },
    ]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Resolvidas pela MarIA: 3; Assumidas pela equipe: 1");
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });
  it("lista de barras com valor na ponta e estado vazio", () => {
    const { rerender } = render(<BarList color="red" empty="nada" items={[{ key: "a", label: "Cotações", value: 7 }]} />);
    expect(screen.getByText("Cotações")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    rerender(<BarList color="red" empty="nada no período" items={[]} />);
    expect(screen.getByText("nada no período")).toBeTruthy();
  });
  it("tabela equivalente ao gráfico", () => {
    render(<DataTable head={["Dia", "Recebidas"]} rows={[["seg. 26/10", 10]]} />);
    expect(screen.getByRole("table").textContent).toContain("seg. 26/10");
  });
});
