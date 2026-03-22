/** Prefix for a time-limited hold before the guest confirms. Value is `BLOCKED~<ISO8601>`. */
export const RESERVATION_BLOCKED_PREFIX = "BLOCKED~" as const;

export const RESERVATION_HOLD_MS = 10 * 60 * 1000;

export function buildBlockedStatus(nowMs = Date.now()): string {
  const until = new Date(nowMs + RESERVATION_HOLD_MS);
  return `${RESERVATION_BLOCKED_PREFIX}${until.toISOString()}`;
}

export function getBlockedExpiryMillis(status: string): number | null {
  if (!status.startsWith(RESERVATION_BLOCKED_PREFIX)) {
    return null;
  }
  const raw = status.slice(RESERVATION_BLOCKED_PREFIX.length);
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return null;
  }
  return ms;
}

/** Whether this row occupies the slot for availability (confirmed or non-expired hold). */
export function reservationBlocksSlot(
  status: string | null | undefined,
  nowMs: number
): boolean {
  if (!status || status === "cancelled") {
    return false;
  }
  if (status === "confirmed") {
    return true;
  }
  const exp = getBlockedExpiryMillis(status);
  if (exp !== null) {
    return nowMs < exp;
  }
  return false;
}

/** Whether the guest can still see and act on this reservation (not cancelled, hold not expired). */
export function isActiveGuestReservation(
  status: string | null | undefined,
  nowMs: number
): boolean {
  if (!status || status === "cancelled") {
    return false;
  }
  if (status === "confirmed") {
    return true;
  }
  const exp = getBlockedExpiryMillis(status);
  if (exp !== null) {
    return nowMs < exp;
  }
  return false;
}

export function isPendingBlockedStatus(status: string | null | undefined): boolean {
  return Boolean(status?.startsWith(RESERVATION_BLOCKED_PREFIX));
}
