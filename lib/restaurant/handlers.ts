import { logRestaurantEndpoint } from "@/lib/restaurant-api-log";
import {
  appendGuestNoteInDb,
  cancelReservationInDb,
  createBookingInDb,
  updateReservationInDb,
} from "@/lib/db/restaurant-queries";
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
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
    });

    return {
      ok: true,
      message: `Reservation #${row.id} is saved for ${enriched.display}.`,
      display: typeof enriched.display === "string" ? enriched.display : undefined,
      reservationId: row.id,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create reservation.";
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
