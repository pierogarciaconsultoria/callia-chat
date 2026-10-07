export const CALLIA_OUTBOUND_ECHO_WINDOW_MS = 30_000;

export type RecentOutboundCandidate = {
  queued_at?: string | null;
  sent_at?: string | null;
  payload?: { text?: string | null } | null;
  message_id?: string | null;
};

function comparableText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function findMatchingRecentOutbound(
  candidates: RecentOutboundCandidate[],
  messageText: string | null,
  now = new Date(),
) {
  const expectedText = comparableText(messageText);
  if (!expectedText) return null;

  const cutoff = now.getTime() - CALLIA_OUTBOUND_ECHO_WINDOW_MS;
  return candidates.find((candidate) => {
    const timestamp = candidate.sent_at ?? candidate.queued_at;
    const sentAt = timestamp ? new Date(timestamp).getTime() : Number.NaN;
    return (
      Number.isFinite(sentAt) &&
      sentAt >= cutoff &&
      sentAt <= now.getTime() &&
      comparableText(candidate.payload?.text) === expectedText
    );
  }) ?? null;
}

export function isPhoneHumanReply(input: {
  fromMe: boolean;
  existingMessage: unknown;
  matchingRecentOutbound: unknown;
}) {
  return input.fromMe && !input.existingMessage && !input.matchingRecentOutbound;
}

export function markMessageAsPhoneReply<T extends { metadata?: Record<string, unknown> }>(
  message: T,
) {
  return {
    ...message,
    sender: "agent" as const,
    metadata: {
      ...(message.metadata ?? {}),
      source: "phone",
    },
  };
}

export function buildPhoneHandoffMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  pauseHours: number,
  now = new Date(),
) {
  const safePauseHours = Number.isInteger(pauseHours) && pauseHours > 0 ? pauseHours : 12;
  return {
    ...(currentMetadata ?? {}),
    handoff_reason: "phone_reply",
    handoff_at: now.toISOString(),
    human_until: new Date(now.getTime() + safePauseHours * 60 * 60 * 1000).toISOString(),
  };
}

export function shouldReturnConversationToBot(input: {
  mode: "bot" | "human";
  metadata: Record<string, unknown> | null | undefined;
  now?: Date;
}) {
  if (input.mode !== "human") return false;
  const humanUntil = input.metadata?.human_until;
  if (typeof humanUntil !== "string") return false;
  const expiresAt = new Date(humanUntil).getTime();
  const now = (input.now ?? new Date()).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function buildBotResumeMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  now = new Date(),
) {
  const { human_until: _humanUntil, ...metadata } = currentMetadata ?? {};
  return {
    ...metadata,
    returned_to_bot_at: now.toISOString(),
    returned_to_bot_reason: "human_pause_expired",
  };
}
