// Chamadas ao console central (function platform-admin). Contrato em docs/EDGE_CONTRACTS.md.
import { invokeFunction } from "./functions";
import type {
  BillingAdmin,
  Entitlements,
  Plan,
  PlatformAuditEntry,
  PlatformOverview,
  PlatformSettings,
  PlatformTenant,
  PlatformTenantDetail,
  PlatformUser,
  PlanLimits,
  TenantStatus,
} from "./database.types";

const call = <T>(action: string, body: Record<string, unknown> = {}) => invokeFunction<T>("platform-admin", { action, ...body });

export type PlanInput = Partial<Omit<Plan, "created_at" | "updated_at">> & { code: string; name: string };

export const platformAdmin = {
  overview: () => call<PlatformOverview>("overview"),
  listTenants: () => call<{ tenants: PlatformTenant[] }>("list_tenants"),
  getTenant: (workspaceId: string) => call<PlatformTenantDetail & { entitlements: Entitlements }>("get_tenant", { workspace_id: workspaceId }),
  createTenant: (input: { name: string; owner_email: string; plan_id: string | null; status: "trial" | "active"; trial_days?: number }) =>
    call<{ workspace_id: string; owner_invited: boolean }>("create_tenant", input),
  updateTenant: (input: {
    workspace_id: string;
    name?: string;
    plan_id?: string | null;
    limit_overrides?: Partial<PlanLimits>;
    notes?: string | null;
    trial_ends_at?: string | null;
  }) => call<{ tenant: PlatformTenant }>("update_tenant", input),
  setStatus: (workspaceId: string, status: TenantStatus, reason?: string) =>
    call<{ tenant: PlatformTenant }>("set_status", { workspace_id: workspaceId, status, reason }),
  supportAccess: (workspaceId: string, enable: boolean) => call<{ ok: true }>("support_access", { workspace_id: workspaceId, enable }),
  listPlans: () => call<{ plans: Plan[] }>("list_plans"),
  upsertPlan: (plan: PlanInput) => call<{ plan: Plan }>("upsert_plan", { plan }),
  listUsers: (search?: string) => call<{ users: PlatformUser[] }>("list_users", search ? { search } : {}),
  inviteUser: (email: string) => call<{ user_id: string }>("invite_user", { email }),
  setPlatformAdmin: (userId: string, enabled: boolean) => call<{ ok: true }>("set_platform_admin", { user_id: userId, enabled }),
  setUserBlocked: (userId: string, blocked: boolean) => call<{ ok: true }>("set_user_blocked", { user_id: userId, blocked }),
  audit: (filters: { workspace_id?: string; action_prefix?: string; limit?: number }) => call<{ entries: PlatformAuditEntry[] }>("audit", filters),
  getSettings: () => call<{ settings: PlatformSettings }>("get_settings"),
  updateSettings: (settings: Partial<PlatformSettings>) => call<{ settings: PlatformSettings }>("update_settings", { settings }),
  getBilling: () => call<BillingAdmin>("get_billing"),
  setBillingSecrets: (secrets: Partial<Record<keyof BillingAdmin["secrets"], string>>) => call<{ secrets: BillingAdmin["secrets"] }>("set_billing_secrets", { secrets }),
  testBilling: () => call<{ ok: boolean; account: { id: number | null; nickname: string | null; email: string | null; site_id: string | null } }>("test_billing"),
  syncMpPlans: () => call<{ created: { code: string; mp_preapproval_plan_id: string }[]; plans: { code: string; mp_preapproval_plan_id: string | null }[] }>("sync_mp_plans"),
};
