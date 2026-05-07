import { describe, expect, it } from "vitest";
import {
  buildProviderSecretRef,
  parseProviderSecretRef,
} from "@/lib/runtime/contracts";
import {
  createInstanceSecretRef,
  getDefaultInstance,
  resolveWorkspaceInstance,
  type WorkspaceWhatsAppInstance,
} from "@/lib/runtime/whatsapp";

const baseInstances: WorkspaceWhatsAppInstance[] = [
  {
    id: "inst-1",
    workspaceId: "ws-1",
    instanceName: "principal",
    providerType: "evolution",
    providerSecretRef: "evolution:ws-1:instance:inst-1",
    isDefault: true,
    status: "connected",
  },
  {
    id: "inst-2",
    workspaceId: "ws-1",
    instanceName: "backup",
    providerType: "evolution",
    providerSecretRef: "evolution:ws-1:instance:inst-2",
    isDefault: false,
    status: "connected",
  },
];

describe("runtime foundation contracts", () => {
  it("builds and parses provider secret refs", () => {
    const ref = buildProviderSecretRef({
      provider: "evolution",
      workspaceId: "ws-1",
      scope: "instance",
      targetId: "inst-1",
    });

    expect(ref).toBe("evolution:ws-1:instance:inst-1");
    expect(parseProviderSecretRef(ref)).toEqual({
      provider: "evolution",
      workspaceId: "ws-1",
      scope: "instance",
      targetId: "inst-1",
    });
  });

  it("creates instance secret refs using the project convention", () => {
    expect(createInstanceSecretRef("ws-1", "inst-9")).toBe(
      "evolution:ws-1:instance:inst-9",
    );
  });

  it("returns the default instance when no explicit instance is requested", () => {
    const resolved = resolveWorkspaceInstance(baseInstances);

    expect(resolved.strategy).toBe("default");
    expect(resolved.instance.id).toBe("inst-1");
  });

  it("returns the explicit instance when it is requested", () => {
    const resolved = resolveWorkspaceInstance(baseInstances, "inst-2");

    expect(resolved.strategy).toBe("explicit");
    expect(resolved.instance.id).toBe("inst-2");
  });

  it("throws when multiple defaults exist", () => {
    expect(() =>
      getDefaultInstance([
        ...baseInstances,
        { ...baseInstances[1], id: "inst-3", isDefault: true },
      ]),
    ).toThrow("Only one WhatsApp instance can be default per workspace.");
  });

  it("throws when no default exists and no explicit instance is provided", () => {
    expect(() =>
      resolveWorkspaceInstance(
        baseInstances.map((instance) => ({ ...instance, isDefault: false })),
      ),
    ).toThrow("No default WhatsApp instance configured for this workspace.");
  });
});
