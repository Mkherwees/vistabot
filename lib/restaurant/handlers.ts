import { logRestaurantEndpoint } from "@/lib/restaurant-api-log";
import {
  appendGuestNoteInDb,
  cancelReservationInDb,
  confirmReservationInDb,
  createBookingInDb,
  getAvailableReservationSlotsForDate,
  listGuestReservationsForChat,
  updateReservationInDb,
  type GuestReservationListItem,
} from "@/lib/db/restaurant-queries";
import { getRestaurantTimeZone } from "@/lib/restaurant";
import { getBlockedExpiryMillis } from "@/lib/restaurant/reservation-status";
import { parseGuestNameFromString } from "@/lib/restaurant/guest-name";
import {
  isIsoDateOnly,
  normalizeBookingSlot,
  normalizeReservationDate,
  normalizeReservationTime,
  resolveTimezone,
} from "@/lib/restaurant/reservation-datetime";

export type RestaurantHandlerResult = {
  ok: boolean;
  message: string;
  display?: string;
  reservationId?: number;
  /** HH:mm strings from listAvailableSlots */
  availableTimes?: string[];
  maxPartySize?: number;
  date?: string;
  reservations?: GuestReservationListItem[];
};

function enrichCreateBookingPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const rawDate = String(payload.date ?? "");
  const rawTime = String(payload.time ?? "");
  const timezone = resolveTimezone(
    typeof payload.timezone === "string" ? payload.timezone : undefined
  );
  const slot = normalizeBookingSlot({
    date: rawDate,
    time: rawTime,
    timezone,
  });

  return {
    ...payload,
    timezone,
    rawDate: slot.rawDate,
    rawTime: slot.rawTime,
    date: slot.date,
    time: slot.time,
    dateNormalized: slot.dateNormalized,
    timeNormalized: slot.timeNormalized,
    display: slot.display,
  };
}

function enrichUpdateReservationPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const timezone = resolveTimezone(
    typeof payload.timezone === "string" ? payload.timezone : undefined
  );
  const next: Record<string, unknown> = { ...payload, timezone };

  const newDate = payload.newDate;
  const newTime = payload.newTime;
  if (typeof newDate === "string" && typeof newTime === "string") {
    const slot = normalizeBookingSlot({
      date: newDate,
      time: newTime,
      timezone,
    });
    next.newDate = slot.date;
    next.newTime = slot.time;
    next.newDateRaw = slot.rawDate;
    next.newTimeRaw = slot.rawTime;
    next.newDisplay = slot.display;
    next.newDateNormalized = slot.dateNormalized;
    next.newTimeNormalized = slot.timeNormalized;
  } else {
    if (typeof newDate === "string" && newDate) {
      const nd = normalizeReservationDate(newDate, timezone);
      next.newDate = nd;
      next.newDateNormalized = isIsoDateOnly(nd);
    }
    if (typeof newTime === "string" && newTime) {
      const t = normalizeReservationTime(newTime);
      next.newTime = t ?? newTime;
      next.newTimeNormalized = t !== null;
    }
  }

  const prevDate = payload.previousDate;
  const prevTime = payload.previousTime;
  if (typeof prevDate === "string" && typeof prevTime === "string") {
    const slot = normalizeBookingSlot({
      date: prevDate,
      time: prevTime,
      timezone,
    });
    next.previousDate = slot.date;
    next.previousTime = slot.time;
    next.previousDisplay = slot.display;
  } else {
    if (typeof prevDate === "string" && prevDate) {
      next.previousDate = normalizeReservationDate(prevDate, timezone);
    }
    if (typeof prevTime === "string" && prevTime) {
      const t = normalizeReservationTime(prevTime);
      next.previousTime = t ?? prevTime;
    }
  }

  return next;
}

function formatHoldDeadlineLocal(status: string | null | undefined): string {
  const ms = status ? getBlockedExpiryMillis(status) : null;
  if (ms === null) {
    return "within the next few minutes";
  }
  const tz = getRestaurantTimeZone();
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: tz,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function enrichCancelPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const timezone = resolveTimezone(
    typeof payload.timezone === "string" ? payload.timezone : undefined
  );
  const next: Record<string, unknown> = { ...payload, timezone };
  const date = payload.date;
  const time = payload.time;
  if (typeof date === "string" && typeof time === "string") {
    const slot = normalizeBookingSlot({ date, time, timezone });
    next.date = slot.date;
    next.time = slot.time;
    next.cancelDisplay = slot.display;
    next.dateNormalized = slot.dateNormalized;
    next.timeNormalized = slot.timeNormalized;
  } else {
    if (typeof date === "string" && date) {
      const nd = normalizeReservationDate(date, timezone);
      next.date = nd;
      next.dateNormalized = isIsoDateOnly(nd);
    }
    if (typeof time === "string" && time) {
      const t = normalizeReservationTime(time);
      next.time = t ?? time;
      next.timeNormalized = t !== null;
    }
  }
  return next;
}

export async function handleCreateBooking(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  const enriched = enrichCreateBookingPayload(payload);
  logRestaurantEndpoint("createBooking", enriched);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id for booking." };
  }

  if (!enriched.dateNormalized || !enriched.timeNormalized) {
    return {
      ok: false,
      message:
        "Could not resolve the date and time to YYYY-MM-DD and 24h HH:mm. Ask the guest for a specific date and time.",
    };
  }

  const partyRaw = payload.partySize;
  const partySize =
    typeof partyRaw === "number"
      ? partyRaw
      : Number.parseInt(String(partyRaw ?? ""), 10);
  if (!Number.isFinite(partySize) || partySize < 1) {
    return { ok: false, message: "Invalid party size." };
  }

  const guestNameRaw =
    typeof payload.guestName === "string" ? payload.guestName.trim() : "";
  let resolvedFirst: string | undefined;
  let resolvedLast: string | undefined;

  if (guestNameRaw) {
    const parsed = parseGuestNameFromString(guestNameRaw);
    resolvedFirst = parsed.firstName || undefined;
    resolvedLast = parsed.lastName;
  } else {
    const fn =
      typeof payload.firstName === "string" ? payload.firstName.trim() : "";
    const ln =
      typeof payload.lastName === "string" ? payload.lastName.trim() : "";
    resolvedFirst = fn || undefined;
    resolvedLast = ln || undefined;
  }

  if (!resolvedFirst?.trim()) {
    return {
      ok: false,
      message:
        "Need at least the guest's first name to create a booking. Ask for their name (one word is enough), or pass guestName / firstName in the tool.",
    };
  }

  try {
    const row = await createBookingInDb({
      chatId,
      partySize: Math.floor(partySize),
      date: String(enriched.date),
      time: String(enriched.time),
      seatingPreference:
        typeof payload.seatingPreference === "string"
          ? payload.seatingPreference
          : undefined,
      firstName: resolvedFirst,
      lastName: resolvedLast,
      dietaryRestrictions:
        typeof payload.dietaryRestrictions === "string"
          ? payload.dietaryRestrictions
          : undefined,
      guestNotes:
        typeof payload.guestNotes === "string" ? payload.guestNotes : undefined,
      reservationNotes:
        typeof payload.reservationNotes === "string"
          ? payload.reservationNotes
          : undefined,
    });

    const holdLine = formatHoldDeadlineLocal(row.status);
    return {
      ok: true,
      message: [
        `Hold created: reservation #${row.id} for ${enriched.display}.`,
        `Status is pending until the guest confirms. The table is held until ${holdLine} (restaurant local time).`,
        "Summarize party size, date, time, and name back to the guest, then ask them to confirm the details are correct.",
        "When they clearly agree (e.g. yes, confirm, that works), call confirmReservation with this reservation id.",
        "Do not say the booking is fully confirmed until confirmReservation succeeds.",
      ].join(" "),
      display: typeof enriched.display === "string" ? enriched.display : undefined,
      reservationId: row.id,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create reservation.";
    return { ok: false, message: msg };
  }
}

export async function handleListGuestReservations(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  logRestaurantEndpoint("listGuestReservations", payload);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id." };
  }

  try {
    const items = await listGuestReservationsForChat(chatId);
    if (items.length === 0) {
      return {
        ok: true,
        message:
          "No upcoming reservations on file for this guest in this chat.",
        reservations: [],
      };
    }

    const summary = items
      .map(
        (r) =>
          `#${r.id} ${r.date} ${r.time} — ${r.partySize} guest(s) — ${r.status}`
      )
      .join("; ");

    return {
      ok: true,
      message: `Found ${items.length} reservation(s): ${summary}`,
      reservations: items,
    };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Could not list reservations.";
    return { ok: false, message: msg };
  }
}

export async function handleListAvailableSlots(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  logRestaurantEndpoint("listAvailableSlots", payload);

  const timezone = resolveTimezone(
    typeof payload.timezone === "string" ? payload.timezone : undefined
  );
  const rawDate = typeof payload.date === "string" ? payload.date.trim() : "";
  if (!rawDate) {
    return {
      ok: false,
      message:
        "Pass a date (e.g. YYYY-MM-DD or 'this Friday') to list open reservation times.",
    };
  }

  const normalized = normalizeReservationDate(rawDate, timezone);
  if (!isIsoDateOnly(normalized)) {
    return {
      ok: false,
      message:
        "Could not resolve the date to YYYY-MM-DD in the restaurant timezone. Ask for a definite day.",
    };
  }

  const partyRaw = payload.partySize;
  let partySize = 2;
  if (typeof partyRaw === "number" && Number.isFinite(partyRaw)) {
    partySize = Math.floor(partyRaw);
  } else if (typeof partyRaw === "string" && partyRaw.trim()) {
    const n = Number.parseInt(partyRaw, 10);
    if (Number.isFinite(n)) {
      partySize = n;
    }
  }

  const seatingPreference =
    typeof payload.seatingPreference === "string"
      ? payload.seatingPreference
      : undefined;

  try {
    const result = await getAvailableReservationSlotsForDate({
      date: normalized,
      partySize,
      seatingPreference,
    });
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    const slotLabel =
      result.availableTimes.length === 0
        ? "No open slots remain for that day (or we are closed that day)."
        : `Open slots (HH:mm): ${result.availableTimes.join(", ")}`;

    return {
      ok: true,
      message: [
        `Date ${result.date}, party of ${partySize}: ${slotLabel}`,
        `Largest table seats ${result.maxPartySize}.`,
      ].join(" "),
      date: result.date,
      availableTimes: result.availableTimes,
      maxPartySize: result.maxPartySize,
    };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Could not list available slots.";
    return { ok: false, message: msg };
  }
}

export async function handleUpdateReservation(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  const enriched = enrichUpdateReservationPayload(payload);
  logRestaurantEndpoint("updateReservation", enriched);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id." };
  }

  try {
    const row = await updateReservationInDb({
      chatId,
      reservationIdRaw: payload.reservationId,
      previousDate:
        typeof enriched.previousDate === "string"
          ? enriched.previousDate
          : undefined,
      previousTime:
        typeof enriched.previousTime === "string"
          ? enriched.previousTime
          : undefined,
      newDate:
        typeof enriched.newDate === "string" ? enriched.newDate : undefined,
      newTime:
        typeof enriched.newTime === "string" ? enriched.newTime : undefined,
      newPartySize:
        typeof payload.newPartySize === "number"
          ? payload.newPartySize
          : undefined,
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
    });

    const display = `${row.date}, ${row.time}`;
    return {
      ok: true,
      message: `Reservation #${row.id} updated.`,
      display,
      reservationId: row.id,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not update reservation.";
    return { ok: false, message: msg };
  }
}

export async function handleAddGuestNote(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  logRestaurantEndpoint("addGuestNote", payload);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id." };
  }

  const note = typeof payload.note === "string" ? payload.note : "";
  if (!note) {
    return { ok: false, message: "Note text is empty." };
  }

  const category = payload.category;
  if (
    category !== "allergy" &&
    category !== "dietary" &&
    category !== "preference" &&
    category !== "other"
  ) {
    return { ok: false, message: "Invalid note category." };
  }

  try {
    await appendGuestNoteInDb({
      chatId,
      note,
      category,
      severity:
        typeof payload.severity === "string" ? payload.severity : undefined,
    });
    return {
      ok: true,
      message: "Note saved on the guest profile for staff.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save note.";
    return { ok: false, message: msg };
  }
}

export async function handleConfirmReservation(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  logRestaurantEndpoint("confirmReservation", payload);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id." };
  }

  try {
    const row = await confirmReservationInDb({
      chatId,
      reservationIdRaw: payload.reservationId,
    });
    const display = `${row.date}, ${row.time}`;
    return {
      ok: true,
      message: `Reservation #${row.id} is confirmed for ${display}.`,
      display,
      reservationId: row.id,
    };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Could not confirm reservation.";
    return { ok: false, message: msg };
  }
}

export async function handleCancelReservation(
  payload: Record<string, unknown>
): Promise<RestaurantHandlerResult> {
  const enriched = enrichCancelPayload(payload);
  logRestaurantEndpoint("cancelReservation", enriched);

  const chatId = String(payload.chatId ?? "");
  if (!chatId) {
    return { ok: false, message: "Missing conversation id." };
  }

  try {
    const row = await cancelReservationInDb({
      chatId,
      reservationIdRaw: payload.reservationId,
      date:
        typeof enriched.date === "string" ? enriched.date : undefined,
      time:
        typeof enriched.time === "string" ? enriched.time : undefined,
      reason:
        typeof payload.reason === "string" ? payload.reason : undefined,
    });

    return {
      ok: true,
      message: `Reservation #${row.id} is marked cancelled.`,
      display:
        typeof enriched.cancelDisplay === "string"
          ? enriched.cancelDisplay
          : `${row.date}, ${row.time}`,
      reservationId: row.id,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not cancel reservation.";
    return { ok: false, message: msg };
  }
}
