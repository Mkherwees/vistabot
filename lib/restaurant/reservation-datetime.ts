import { getRestaurantTimeZone } from "@/lib/restaurant";

/** YYYY-MM-DD in the given IANA timezone (calendar day for "now"). */
export function getTodayIsoInTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map((x) => Number.parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

export function isIsoDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** Calendar weekday 0=Sun … 6=Sat for a YYYY-MM-DD (UTC noon anchor). */
export function getIsoCalendarWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map((x) => Number.parseInt(x, 10));
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return utc.getUTCDay();
}

const WEEKDAY_NAME_TO_DOW: [string, number][] = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
];

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:!?]+$/u, "").trim();
}

/**
 * Parses phrases like "this Wednesday", "next Friday", "this coming Wednesday"
 * to the next matching calendar date in the restaurant timezone.
 * When multiple weekday names appear, the last one in the string wins.
 */
export function tryParseWeekdayPhraseToIso(
  raw: string,
  timeZone: string
): string | null {
  const stripped = stripTrailingPunctuation(raw.trim());
  const lower = stripped.toLowerCase().replace(/\s+/g, " ");

  let bestIndex = -1;
  let targetDow: number | undefined;
  for (const [name, dow] of WEEKDAY_NAME_TO_DOW) {
    const re = new RegExp(`\\b${name}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lower)) !== null) {
      if (match.index > bestIndex) {
        bestIndex = match.index;
        targetDow = dow;
      }
    }
  }
  if (targetDow === undefined) {
    return null;
  }

  const todayIso = getTodayIsoInTimeZone(timeZone);
  const todayDow = getIsoCalendarWeekday(todayIso);
  const hasNext = /\bnext\b/.test(lower);
  let diff = (targetDow - todayDow + 7) % 7;
  if (hasNext && diff === 0) {
    diff = 7;
  }

  return addDaysToIsoDate(todayIso, diff);
}

/**
 * Resolves relative phrases and ISO dates to YYYY-MM-DD in `timeZone`.
 */
export function normalizeReservationDate(
  raw: string,
  timeZone: string
): string {
  const trimmed = raw.trim().replace(/[.,]+$/u, "").trim();
  const lower = trimmed.toLowerCase();
  const today = getTodayIsoInTimeZone(timeZone);

  if (lower === "today" || lower === "tonight") {
    return today;
  }
  if (lower === "tomorrow") {
    return addDaysToIsoDate(today, 1);
  }
  if (isIsoDateOnly(trimmed)) {
    return trimmed;
  }

  const fromWeekday = tryParseWeekdayPhraseToIso(trimmed, timeZone);
  if (fromWeekday) {
    return fromWeekday;
  }

  return trimmed;
}

/**
 * Parses common time strings to 24h HH:mm (e.g. 9pm -> 21:00, 19:00 -> 19:00).
 */
export function normalizeReservationTime(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, " ");

  const iso24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (iso24) {
    const h = Number.parseInt(iso24[1], 10);
    const min = Number.parseInt(iso24[2], 10);
    if (h > 23 || min > 59) {
      return null;
    }
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const m12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m12) {
    let hour = Number.parseInt(m12[1], 10);
    const minutes = Number.parseInt(m12[2] ?? "0", 10);
    const suffix = m12[3];
    if (hour < 1 || hour > 12 || minutes > 59) {
      return null;
    }
    if (suffix === "pm") {
      if (hour !== 12) {
        hour += 12;
      }
    } else if (hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const compact = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (compact) {
    const spacer = compact[2] !== undefined ? `:${compact[2]}` : ":00";
    return normalizeReservationTime(`${compact[1]}${spacer} ${compact[3]}`);
  }

  return null;
}

export type NormalizedBookingSlot = {
  timezone: string;
  /** Canonical YYYY-MM-DD */
  date: string;
  /** True when date is a resolved YYYY-MM-DD (not leftover free text) */
  dateNormalized: boolean;
  /** Canonical HH:mm (24h) when parse succeeds */
  time: string;
  timeNormalized: boolean;
  rawDate: string;
  rawTime: string;
  /** `YYYY-MM-DD, HH:mm` for logs and DB */
  display: string;
};

export function normalizeBookingSlot(input: {
  date: string;
  time: string;
  timezone?: string;
}): NormalizedBookingSlot {
  const timezone = resolveTimezone(input.timezone);
  const rawDate = input.date.trim();
  const rawTime = input.time.trim();
  const date = normalizeReservationDate(rawDate, timezone);
  const dateNormalized = isIsoDateOnly(date);
  const parsedTime = normalizeReservationTime(rawTime);
  const timeNormalized = parsedTime !== null;
  const time = parsedTime ?? rawTime;

  return {
    timezone,
    date,
    dateNormalized,
    time,
    timeNormalized,
    rawDate,
    rawTime,
    display: `${date}, ${time}`,
  };
}

export function resolveTimezone(input?: string): string {
  const t = input?.trim();
  if (!t) {
    return getRestaurantTimeZone();
  }
  const key = t.toUpperCase();
  if (key === "PST" || key === "PDT") {
    return getRestaurantTimeZone();
  }
  return t;
}
