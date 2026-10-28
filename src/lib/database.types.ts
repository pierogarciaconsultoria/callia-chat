// Tipos de linha escritos à mão a partir de supabase/migrations/. Manter em sincronia.

export type WorkspaceRole = "owner" | "admin" | "agent";
export type ConversationMode = "bot" | "human" | "closed";
export type MessageDirection = "inbound" | "outbound";
export type MessageSender = "customer" | "bot" | "agent" | "system";
export type MessageType =
  | "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "reaction" | "unknown";

export type TenantStatus = "trial" | "active" | "suspended" | "canceled";
export type EffectiveTenantStatus = TenantStatus | "trial_expired";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  status: TenantStatus;
  plan_id: string | null;
  trial_ends_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  limit_overrides: Partial<PlanLimits>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Camada SaaS (migration 20261026120000_callia_platform_saas.sql)
// ---------------------------------------------------------------------------
export interface PlanLimits {
  max_instances: number | null;
  max_members: number | null;
  max_monthly_messages: number | null;
  max_knowledge_sources: number | null;
  ai_enabled: boolean;
  external_agent_enabled: boolean;
  connectors_enabled: boolean;
}

export type NumericLimitKey = "max_instances" | "max_members" | "max_monthly_messages" | "max_knowledge_sources";
export type FeatureKey = "ai_enabled" | "external_agent_enabled" | "connectors_enabled";

export interface Plan extends PlanLimits {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceUsage {
  period_start: string;
  monthly_messages: number;
  monthly_inbound: number;
  monthly_ai_runs: number;
  monthly_ai_tokens: number;
  instances: number;
  members: number;
  knowledge_sources: number;
}

export interface Entitlements {
  workspace_id: string;
  status: TenantStatus;
  effective_status: EffectiveTenantStatus;
  active: boolean;
  trial_ends_at: string | null;
  suspended_reason: string | null;
  plan: { id: string; code: string; name: string } | null;
  limits: PlanLimits;
  usage: WorkspaceUsage;
}

export interface PlatformSettings {
  allow_self_service_workspaces: boolean;
  self_service_plan_code: string | null;
  trial_days: number;
  platform_name: string;
  support_email: string | null;
}

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  effective_status: EffectiveTenantStatus;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  trial_ends_at: string | null;
  suspended_reason: string | null;
  limit_overrides: Partial<PlanLimits>;
  notes: string | null;
  created_at: string;
  owner_email: string | null;
  instances_open: number;
  last_message_at: string | null;
  usage: WorkspaceUsage;
}

export type AttentionKind =
  | "instance_down" | "quota_near" | "quota_exceeded" | "trial_ending" | "trial_expired" | "agent_failures" | "webhook_failures";

export interface PlatformOverview {
  totals: {
    tenants: number;
    active: number;
    trial: number;
    suspended: number;
    canceled: number;
    trial_expired: number;
    users: number;
    instances_open: number;
    monthly_messages: number;
    monthly_ai_runs: number;
    monthly_ai_tokens: number;
  };
  attention: { workspace_id: string; workspace_name: string; kind: AttentionKind; detail: string }[];
}

export interface PlatformTenantDetail {
  tenant: PlatformTenant;
  entitlements: Entitlements;
  members: MemberWithEmail[];
  instances: { id: string; name: string; status: InstanceStatus; phone_number: string | null; is_default: boolean }[];
  counts: { api_keys: number; webhooks: number; conversations: number };
  audit: AuditLog[];
}

export interface PlatformUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  invited_at: string | null;
  confirmed: boolean;
  blocked: boolean;
  platform_admin: boolean;
  workspaces: { id: string; name: string; role: WorkspaceRole; is_support: boolean }[];
}

export interface PlatformAuditEntry extends AuditLog {
  workspace_name: string | null;
  actor_email: string | null;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  is_support: boolean;
  created_at: string;
}

export interface MemberWithEmail {
  user_id: string;
  email: string;
  role: WorkspaceRole;
  is_support: boolean;
  created_at: string;
}

export interface WorkspaceBranding {
  workspace_id: string;
  display_name: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  custom_domain: string | null;
  support_email: string | null;
  updated_at: string;
}

export interface HbookConfig {
  base_url?: string;
  company_id?: string;
  booking_link?: string;
  currency?: string;
  default_adults?: number;
}

export interface WorkspaceConnector {
  id: string;
  workspace_id: string;
  kind: "hbook";
  enabled: boolean;
  config: HbookConfig;
  created_at: string;
  updated_at: string;
}

export type InstanceStatus = "created" | "connecting" | "qr" | "open" | "close" | "error";

export interface WhatsAppInstance {
  id: string;
  workspace_id: string;
  name: string;
  instance_name: string;
  provider: string;
  status: InstanceStatus;
  qr_code: string | null;
  qr_updated_at: string | null;
  phone_number: string | null;
  profile_name: string | null;
  is_default: boolean;
  last_connected_at: string | null;
  last_error: string | null;
  webhook_token_rotated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboundEvent {
  id: string;
  workspace_id: string;
  instance_id: string | null;
  provider: string;
  event_type: string;
  event_key: string;
  status: "received" | "processed" | "ignored" | "failed";
  error: string | null;
  payload: unknown;
  correlation_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  instance_id: string | null;
  channel: string;
  contact_phone: string;
  contact_name: string | null;
  conversation_key: string;
  mode: ConversationMode;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  assigned_user_id: string | null;
  handoff_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  seq: number;
  workspace_id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender: MessageSender;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime: string | null;
  external_id: string | null;
  status: "received" | "pending" | "sent" | "delivered" | "read" | "failed";
  agent_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OutboundMessage {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  message_id: string | null;
  instance_id: string | null;
  origin: "bot" | "agent" | "public_api" | "system";
  to_phone: string;
  type: string;
  payload: unknown;
  status: "queued" | "sent" | "failed";
  provider_message_id: string | null;
  idempotency_key: string | null;
  error: string | null;
  attempts: number;
  correlation_id: string | null;
  created_at: string;
  sent_at: string | null;
}

export type TimeRange = [string, string];
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type BusinessHours = Partial<Record<Weekday, TimeRange[]>>;

export interface PaymentLink {
  label: string;
  url: string;
  description?: string;
}

export interface FollowUpRule {
  after_minutes: number;
  message: string;
}

export interface AgentConfig {
  workspace_id: string;
  enabled: boolean;
  agent_name: string;
  persona_prompt: string;
  guardrails: string | null;
  language: string;
  ai_model: string | null;
  temperature: number;
  website_url: string | null;
  voice_enabled: boolean;
  voice_id: string | null;
  timezone: string;
  business_hours: BusinessHours;
  out_of_hours_message: string | null;
  handoff_keywords: string[];
  handoff_message: string;
  payment_links: PaymentLink[];
  follow_up_rules: FollowUpRule[];
  reply_debounce_ms: number;
  external_agent_enabled: boolean;
  external_agent_url: string | null;
  external_agent_secret_ref: string | null;
  external_agent_timeout_ms: number;
  segment_id: string | null;
  emoji_policy: "none" | "light" | "free" | null;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  workspace_id: string;
  conversation_id: string;
  trigger_message_id: string;
  status: "running" | "replied" | "handoff" | "skipped" | "superseded" | "failed";
  engine: "internal" | "external" | "fallback" | null;
  reason: string | null;
  error: string | null;
  latency_ms: number | null;
  usage: unknown;
  correlation_id: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Política ou informação oficial da empresa (workspace_policies): sempre no prompt do agente. */
export interface Policy {
  id: string;
  workspace_id: string;
  topic: string;
  title: string;
  content: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Faq {
  id: string;
  workspace_id: string;
  question: string;
  answer: string;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSource {
  id: string;
  workspace_id: string;
  kind: KnowledgeSourceKind;
  title: string;
  origin_id: string | null;
  content: string | null;
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  status: "pending" | "indexing" | "indexed" | "failed";
  error: string | null;
  chunk_count: number;
  embedded: boolean;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
  /** site: { max_pages, pages: [{ url, title }] } · social: { network, handle, fetched } */
  metadata?: KnowledgeSourceMetadata | null;
}

export type KnowledgeSourceKind = "faq" | "product" | "text" | "url" | "document" | "site" | "social";

export interface KnowledgeSourceMetadata {
  /** Fixa no agente: a IA lê sempre esta fonte. */
  pinned?: boolean;
  max_pages?: number;
  pages?: { url: string; title?: string | null }[];
  network?: string;
  handle?: string;
  fetched?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- Assistente de configuração (agent-setup)
export interface AgentSetupContent {
  business: {
    name: string;
    summary: string;
    segment: string;
    city: string;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    website_url: string | null;
    instagram: string | null;
    tone_observed: string;
  };
  agent: { agent_name: string; language: string; persona_prompt: string; guardrails: string };
  business_hours: { timezone: string; weekly: BusinessHours } | null;
  handoff: { keywords: string[]; message: string; out_of_hours_message: string | null };
  payment_links: { label: string; url: string; description: string | null }[];
  faqs: { question: string; answer: string; source: string }[];
  products: { name: string; description: string | null; price: number | null; currency: string; url: string | null }[];
  missing_information: { topic: string; question: string }[];
  sources_used: { title: string; kind: string }[];
}

export interface AgentSetupDraft {
  id: string;
  workspace_id: string;
  status: "ready" | "applied" | "discarded";
  source_ids: string[];
  extra_text: string | null;
  model: string | null;
  draft: AgentSetupContent;
  usage: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
  applied_by: string | null;
  applied_sections: string[] | null;
}

export interface SetupSections {
  profile?: boolean;
  guardrails?: boolean;
  business_hours?: boolean;
  handoff?: boolean;
  payment_links?: boolean;
  faqs?: number[];
  products?: number[];
}

export interface SetupApplyResult {
  applied: {
    profile: boolean;
    guardrails: boolean;
    business_hours: boolean;
    handoff: boolean;
    payment_links: boolean;
    faqs: number;
    products: number;
  };
}

export interface ApiKey {
  id: string;
  workspace_id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface PublicApiRequest {
  id: string;
  workspace_id: string | null;
  api_key_id: string | null;
  method: string;
  path: string;
  status_code: number;
  error_code: string | null;
  duration_ms: number | null;
  correlation_id: string | null;
  ip: string | null;
  created_at: string;
}

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "conversation.handoff",
  "public_api.event.received",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  secret_last4: string;
  max_attempts: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  workspace_id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  status: "pending" | "retrying" | "success" | "failed";
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface AuditLog {
  id: string;
  workspace_id: string | null;
  actor_user_id: string | null;
  actor_type: "user" | "api_key" | "system";
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: unknown;
  correlation_id: string | null;
  created_at: string;
}

// Respostas das functions (docs/EDGE_CONTRACTS.md)
export interface SearchResult {
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_kind: string;
  content: string;
  score: number;
  keyword_rank: number | null;
  similarity: number | null;
}

export interface SimulateMedia {
  type: "image" | "video" | "document" | "audio";
  url: string;
  caption?: string | null;
  file_name?: string | null;
}

export interface SimulateResult {
  reply: string | null;
  handoff: boolean;
  engine: string;
  knowledge: { source_title: string; content: string; score: number }[];
  tool_calls: { name: string; arguments: unknown; result: unknown }[];
  /** Mídias que o agente enviaria (ex.: fotos de enviar_fotos). */
  media?: SimulateMedia[];
}

export interface HbookRoom {
  name: string;
  rate?: string | null;
  total_price?: number | null;
  price_per_night?: number | null;
  available_units?: number | null;
}

export interface HbookAvailability {
  rooms: HbookRoom[];
  nights: number;
  booking_link: string | null;
  currency: string;
  checkin?: string;
  checkout?: string;
}

// ---------------------------------------------------------------- Integrações simplificadas (function integrations)
export type IntegrationKind = "whatsapp" | "hospedin" | "hbook" | "booking_link";
export type IntegrationStatus = "connected" | "error" | "disconnected" | "pending";

export interface Integration {
  kind: IntegrationKind;
  status: IntegrationStatus;
  title: string;
  summary: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  /** Nunca sensível: account_id, categories, price_unit, booking_link, instance_id… */
  details: {
    account_id?: string;
    categories?: { id: number | string; title: string; occupants?: number | null }[];
    price_unit?: "reais" | "cents";
    booking_link?: string | null;
    instance_id?: string;
    [key: string]: unknown;
  };
}

export interface AvailabilityRoom {
  name: string;
  rate: string | null;
  total_price: number;
  price_per_night: number;
  available_units: number | null;
  capacity?: number | null;
}

export interface AvailabilityTest {
  provider: "hospedin" | "hbook";
  checkin: string;
  checkout: string;
  nights: number;
  adults: number;
  children_ages: number[];
  currency: string;
  sold_out: boolean;
  booking_link: string | null;
  rooms: AvailabilityRoom[];
}

// ---------------------------------------------------------------- Fotos (function media)
export type MediaSource = "upload" | "drive" | "hospedin";

export interface MediaAsset {
  id: string;
  workspace_id: string;
  album: string;
  product_id: string | null;
  caption: string | null;
  public_url: string;
  mime_type: string;
  size_bytes: number | null;
  source: MediaSource;
  position: number;
  created_at: string;
}

export interface Album {
  name: string;
  product_id: string | null;
  /** Nome do item do catálogo ligado (fonte única de nome e capacidade). */
  product_name?: string | null;
  /** Nome a exibir: o do catálogo quando ligado, senão o do álbum. */
  display_name?: string;
  count: number;
  cover_url: string | null;
}

export interface MediaImport {
  id: string;
  source: "drive" | "hospedin";
  status: "running" | "done" | "failed";
  total: number;
  imported: number;
  skipped: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
