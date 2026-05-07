export const supportedWebhookEvents = [
  "message.received",
  "message.sent",
  "conversation.handoff",
  "public_api.event.received",
] as const;

export type SupportedWebhookEvent = (typeof supportedWebhookEvents)[number];

export type WebhookRecord = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  url: string;
  events: string[];
  headers: Record<string, string>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  secret_masked: string;
};

export function formatWebhookEvents(events: string[]) {
  return events.join(", ");
}
