export function buildInboxClaimMetadata(
  currentMetadata: Record<string, unknown> | null | undefined,
  userId: string,
  pauseHours: number,
  now = new Date(),
) {
  const safePauseHours = Number.isInteger(pauseHours) && pauseHours > 0 ? pauseHours : 12;
  return {
    ...(currentMetadata ?? {}),
    claimed_at: now.toISOString(),
    claimed_by: userId,
    human_until: new Date(now.getTime() + safePauseHours * 60 * 60 * 1000).toISOString(),
  };
}
