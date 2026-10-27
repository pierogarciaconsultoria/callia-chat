// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isStaleBuildError, reloadForNewVersion } from "@/lib/stale-build";

describe("versão nova do painel (chunk antigo sumiu)", () => {
  beforeEach(() => sessionStorage.clear());

  it("reconhece o erro de chunk em Chrome, Safari e Firefox", () => {
    expect(isStaleBuildError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/agent-editors-BzQcpd9U.js"))).toBe(true);
    expect(isStaleBuildError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleBuildError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isStaleBuildError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("recarrega uma vez; se o erro voltar logo em seguida, deixa o erro aparecer", () => {
    const reload = vi.fn();
    expect(reloadForNewVersion(1_000_000, reload)).toBe(true);
    expect(reloadForNewVersion(1_010_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForNewVersion(1_050_000, reload)).toBe(true); // depois de 30 s pode tentar de novo
  });
});
