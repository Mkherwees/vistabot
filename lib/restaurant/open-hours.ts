import {
  getIsoCalendarWeekday,
  getTodayIsoInTimeZone,
} from "@/lib/restaurant/reservation-datetime";

/** One day: open/close as HH:mm (24h), same calendar day. */
export type DayHoursWindow = { open: string; close: string };

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const DEFAULT_DAY: DayHoursWindow = {
  open: "11:00",
  close: "22:00",
};

function parseHm(raw: string): { h: number; m: number } | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    return null;
  }
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h > 23 || min > 59) {
    return null;
  }
  return { h, m: min };
}

export function minutesFromHHmm(hm: string): number | null {
  const p = parseHm(hm);
  if (!p) {
    return null;
  }
  return p.h * 60 + p.m;
}

export function hhmmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function windowToMinutes(w: DayHoursWindow): { open: number; close: number } | null {
  const o = minutesFromHHmm(w.open);
  const c = minutesFromHHmm(w.close);
  if (o === null || c === null) {
    return null;
  }
  if (o >= c) {
    return null;
  }
  return { open: o, close: c };
}

/**
 * Weekly schedule: keys 0–6 (Sun–Sat). `null` = closed that day.
 * Env `RESTAURANT_OPEN_HOURS`: JSON `{ "0": null, "1": { "open": "11:00", "close": "22:00" }, ... }`.
 * If unset, every day uses 11:00–22:00.
 */
export function getRestaurantWeeklySchedule(): Record<
  number,
  DayHoursWindow | null
> {
  const raw =
    process.env.RESTAURANT_OPEN_HOURS?.trim() ||
    process.env.NEXT_PUBLIC_RESTAURANT_OPEN_HOURS?.trim();
  const base: Record<number, DayHoursWindow | null> = {
    0: { ...DEFAULT_DAY },
    1: { ...DEFAULT_DAY },
    2: { ...DEFAULT_DAY },
    3: { ...DEFAULT_DAY },
    4: { ...DEFAULT_DAY },
    5: { ...DEFAULT_DAY },
    6: { ...DEFAULT_DAY },
  };
  if (!raw) {
    return base;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return base;
    }
    const o = parsed as Record<string, unknown>;
    for (let d = 0; d <= 6; d++) {
      const key = String(d);
      const v = o[key];
      if (v === null) {
        base[d] = null;
        continue;
      }
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        continue;
      }
      const open = (v as { open?: unknown }).open;
      const close = (v as { close?: unknown }).close;
      if (typeof open !== "string" || typeof close !== "string") {
        continue;
      }
      const win: DayHoursWindow = { open, close };
      if (windowToMinutes(win) === null) {
        continue;
      }
      base[d] = win;
    }
    return base;
  } catch {
    return base;
  }
}

export function getBookingSlotIntervalMinutes(): number {
  const raw =
    process.env.RESTAURANT_BOOKING_SLOT_MINUTES?.trim() ||
    process.env.NEXT_PUBLIC_RESTAURANT_BOOKING_SLOT_MINUTES?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 30;
  if (!Number.isFinite(n) || n < 5 || n > 180) {
    return 30;
  }
  return n;
}

function formatHmForDisplay(hm: string): string {
  const mins = minutesFromHHmm(hm);
  if (mins === null) {
    return hm;
  }
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Short paragraph for the system prompt (hours + slot step). */
export function getRestaurantHoursSummaryForPrompt(): string {
  const schedule = getRestaurantWeeklySchedule();
  const interval = getBookingSlotIntervalMinutes();
  const lines: string[] = [];
  for (let d = 0; d <= 6; d++) {
    const w = schedule[d];
    const name = DAY_NAMES[d];
    if (w === null) {
      lines.push(`${name}: closed`);
    } else {
      const win = windowToMinutes(w);
      if (win === null) {
        lines.push(`${name}: invalid hours in config`);
      } else {
        lines.push(
          `${name}: ${formatHmForDisplay(w.open)} – ${formatHmForDisplay(w.close)}`
        );
      }
    }
  }
  return [
    `Reservations are offered in ${interval}-minute slots during these local hours (restaurant timezone):`,
    lines.join("; "),
  ].join(" ");
}

function getCurrentHmInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "0";
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Candidate slot times (HH:mm) for a calendar date, excluding outside hours.
 * Does not filter “past” times — use {@link isReservationSlotInThePast} per slot.
 */
export function listCandidateSlotTimesForDate(dateIso: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso.trim())) {
    return [];
  }
  const dow = getIsoCalendarWeekday(dateIso);
  const schedule = getRestaurantWeeklySchedule();
  const window = schedule[dow];
  if (window === null) {
    return [];
  }
  const bounds = windowToMinutes(window);
  if (bounds === null) {
    return [];
  }
  const step = getBookingSlotIntervalMinutes();
  const out: string[] = [];
  for (let t = bounds.open; t < bounds.close; t += step) {
    out.push(hhmmFromMinutes(t));
  }
  return out;
}

export function isReservationSlotInThePast(
  dateIso: string,
  timeHm: string,
  timeZone: string
): boolean {
  const today = getTodayIsoInTimeZone(timeZone);
  if (dateIso < today) {
    return true;
  }
  if (dateIso > today) {
    return false;
  }
  const slotM = minutesFromHHmm(timeHm);
  const nowM = minutesFromHHmm(getCurrentHmInTimeZone(timeZone));
  if (slotM === null || nowM === null) {
    return false;
  }
  return slotM < nowM;
}

export function isTimeWithinOpenHours(dateIso: string, timeHm: string): boolean {
  const dow = getIsoCalendarWeekday(dateIso);
  const schedule = getRestaurantWeeklySchedule();
  const window = schedule[dow];
  if (window === null) {
    return false;
  }
  const bounds = windowToMinutes(window);
  const t = minutesFromHHmm(timeHm);
  if (bounds === null || t === null) {
    return false;
  }
  return t >= bounds.open && t < bounds.close;
}

/**
 * Throws `Error` with a guest-safe message if the slot is not bookable.
 */
export function assertReservationSlotAllowed(
  dateIso: string,
  timeHm: string,
  timeZone: string
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso.trim())) {
    throw new Error("Invalid reservation date.");
  }
  const today = getTodayIsoInTimeZone(timeZone);
  if (dateIso < today) {
    throw new Error(
      "That date is in the past. Choose today or a future day in the restaurant's calendar."
    );
  }
  if (isReservationSlotInThePast(dateIso, timeHm, timeZone)) {
    throw new Error(
      "That time has already passed today. Pick a later time or another day."
    );
  }
  if (!isTimeWithinOpenHours(dateIso, timeHm)) {
    const dow = getIsoCalendarWeekday(dateIso);
    const schedule = getRestaurantWeeklySchedule();
    const w = schedule[dow];
    if (w === null) {
      throw new Error("We are closed that day. Choose another date.");
    }
    throw new Error(
      `That time is outside our opening hours (${formatHmForDisplay(w.open)}–${formatHmForDisplay(w.close)}). Ask for an available time or use listAvailableSlots for that date.`
    );
  }

  const allowed = new Set(listCandidateSlotTimesForDate(dateIso));
  if (!allowed.has(timeHm)) {
    throw new Error(
      `Reservations start every ${getBookingSlotIntervalMinutes()} minutes on our schedule. Use listAvailableSlots for that date to see exact times, or pick a time that lines up with those slots.`
    );
  }
}

