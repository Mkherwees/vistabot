import "server-only";

import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { chat, guests, reservations, restaurantTables } from "@/lib/db/schema";
import { db } from "@/lib/db/queries";
import {
  buildBlockedStatus,
  isActiveGuestReservation,
  isPendingBlockedStatus,
  reservationBlocksSlot,
} from "@/lib/restaurant/reservation-status";

function parseReservationId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const n = Number.parseInt(String(raw), 10);
  return Number.isNaN(n) ? undefined : n;
}

async function ensureGuestForChatId(chatId: string): Promise<void> {
  const [c] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(eq(chat.id, chatId))
    .limit(1);
  if (!c) {
    throw new Error("This conversation is not linked to a chat.");
  }
  const [g] = await db
    .select({ id: guests.id })
    .from(guests)
    .where(eq(guests.id, chatId))
    .limit(1);
  if (!g) {
    await db.insert(guests).values({ id: chatId });
  }
}

async function pickFreeTableId(
  partySize: number,
  seatingPreference: string | undefined,
  date: string,
  time: string
): Promise<number> {
  const candidates = await db
    .select()
    .from(restaurantTables)
    .where(gte(restaurantTables.capacity, partySize))
    .orderBy(asc(restaurantTables.capacity));

  if (candidates.length === 0) {
    throw new Error("No table is large enough for your party size.");
  }

  const pref = seatingPreference?.trim().toLowerCase();
  let ordered = [...candidates];
  if (pref) {
    const matched = candidates.filter((t) =>
      t.location?.toLowerCase().includes(pref)
    );
    const rest = candidates.filter((t) => !matched.includes(t));
    ordered = [...matched, ...rest];
  }

  const nowMs = Date.now();
  for (const table of ordered) {
    const conflicting = await db
      .select({ id: reservations.id, status: reservations.status })
      .from(reservations)
      .where(
        and(
          eq(reservations.table_id, table.id),
          eq(reservations.date, date),
          eq(reservations.time, time),
          ne(reservations.status, "cancelled")
        )
      );
    const blocks = conflicting.some((row) =>
      reservationBlocksSlot(row.status, nowMs)
    );
    if (!blocks) {
      return table.id;
    }
  }

  throw new Error("No table is available at that date and time.");
}

export async function findReservationForGuest({
  chatId,
  reservationId,
  previousDate,
  previousTime,
}: {
  chatId: string;
  reservationId?: number;
  previousDate?: string;
  previousTime?: string;
}) {
  const nowMs = Date.now();

  if (reservationId !== undefined) {
    const [r] = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.guest_id, chatId)
        )
      )
      .limit(1);
    if (!r || r.status === "cancelled") {
      return null;
    }
    if (!isActiveGuestReservation(r.status, nowMs)) {
      return null;
    }
    return r;
  }

  if (previousDate && previousTime) {
    const [r] = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.guest_id, chatId),
          eq(reservations.date, previousDate),
          eq(reservations.time, previousTime),
          ne(reservations.status, "cancelled")
        )
      )
      .limit(1);
    if (!r || !isActiveGuestReservation(r.status, nowMs)) {
      return null;
    }
    return r;
  }

  const recent = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.guest_id, chatId),
        ne(reservations.status, "cancelled")
      )
    )
    .orderBy(desc(reservations.id))
    .limit(40);

  for (const row of recent) {
    if (isActiveGuestReservation(row.status, nowMs)) {
      return row;
    }
  }
  return null;
}

async function applyGuestDetailsForBooking({
  chatId,
  firstName,
  lastName,
  dietaryRestrictions,
  guestNotes,
}: {
  chatId: string;
  firstName?: string;
  lastName?: string;
  dietaryRestrictions?: string;
  guestNotes?: string;
}): Promise<void> {
  const [g] = await db
    .select()
    .from(guests)
    .where(eq(guests.id, chatId))
    .limit(1);
  if (!g) {
    return;
  }

  const patch: {
    first_name?: string;
    last_name?: string;
    dietary?: string;
    notes?: string;
  } = {};

  const fn = firstName?.trim();
  const ln = lastName?.trim();
  if (fn) {
    patch.first_name = fn;
  }
  if (ln) {
    patch.last_name = ln;
  }

  const diet = dietaryRestrictions?.trim();
  if (diet) {
    patch.dietary = g.dietary ? `${g.dietary}; ${diet}` : diet;
  }

  const gn = guestNotes?.trim();
  if (gn) {
    patch.notes = g.notes ? `${g.notes}\n${gn}` : gn;
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  await db.update(guests).set(patch).where(eq(guests.id, chatId));
}

export async function createBookingInDb({
  chatId,
  partySize,
  date,
  time,
  seatingPreference,
  reservationNotes,
  firstName,
  lastName,
  dietaryRestrictions,
  guestNotes,
}: {
  chatId: string;
  partySize: number;
  date: string;
  time: string;
  seatingPreference?: string;
  /** Notes about this specific visit (occasion, celebration, business context). */
  reservationNotes?: string;
  firstName?: string;
  lastName?: string;
  /** Dietary restrictions / allergies — stored on the guest profile. */
  dietaryRestrictions?: string;
  /** Person-level preferences (e.g. seating likes) — stored on the guest profile. */
  guestNotes?: string;
}) {
  await ensureGuestForChatId(chatId);
  await applyGuestDetailsForBooking({
    chatId,
    firstName,
    lastName,
    dietaryRestrictions,
    guestNotes,
  });

  const tableId = await pickFreeTableId(
    partySize,
    seatingPreference,
    date,
    time
  );

  const reservationNotesCombined = reservationNotes?.trim() ?? null;

  const [created] = await db
    .insert(reservations)
    .values({
      guest_id: chatId,
      table_id: tableId,
      party_size: partySize,
      date,
      time,
      status: buildBlockedStatus(),
      notes: reservationNotesCombined,
    })
    .returning();

  if (!created) {
    throw new Error("Could not create reservation.");
  }

  return created;
}

export async function updateReservationInDb({
  chatId,
  reservationIdRaw,
  previousDate,
  previousTime,
  newDate,
  newTime,
  newPartySize,
  notes,
}: {
  chatId: string;
  reservationIdRaw: unknown;
  previousDate?: string;
  previousTime?: string;
  newDate?: string;
  newTime?: string;
  newPartySize?: number;
  notes?: string;
}) {
  const reservationId = parseReservationId(reservationIdRaw);
  const row = await findReservationForGuest({
    chatId,
    reservationId,
    previousDate,
    previousTime,
  });
  if (!row) {
    throw new Error("No matching reservation found to update.");
  }

  const nd = newDate ?? row.date ?? "";
  const nt = newTime ?? row.time ?? "";
  const np = newPartySize ?? row.party_size ?? 1;

  const [currentTable] = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.id, row.table_id))
    .limit(1);
  const cap = currentTable?.capacity ?? 0;

  let tableId = row.table_id;

  if (np > cap) {
    tableId = await pickFreeTableId(np, undefined, nd, nt);
  } else if (newDate !== undefined || newTime !== undefined) {
    if (nd !== row.date || nt !== row.time) {
      const nowMs = Date.now();
      const blockingRows = await db
        .select({ id: reservations.id, status: reservations.status })
        .from(reservations)
        .where(
          and(
            eq(reservations.table_id, row.table_id),
            eq(reservations.date, nd),
            eq(reservations.time, nt),
            ne(reservations.id, row.id),
            ne(reservations.status, "cancelled")
          )
        );
      const blocks = blockingRows.some((b) =>
        reservationBlocksSlot(b.status, nowMs)
      );
      if (blocks) {
        tableId = await pickFreeTableId(np, undefined, nd, nt);
      }
    }
  }

  const [updated] = await db
    .update(reservations)
    .set({
      date: newDate ?? row.date,
      time: newTime ?? row.time,
      party_size: newPartySize ?? row.party_size,
      notes: notes ?? row.notes,
      table_id: tableId,
    })
    .where(eq(reservations.id, row.id))
    .returning();

  if (!updated) {
    throw new Error("Could not update reservation.");
  }

  return updated;
}

export async function cancelReservationInDb({
  chatId,
  reservationIdRaw,
  date,
  time,
  reason,
}: {
  chatId: string;
  reservationIdRaw: unknown;
  date?: string;
  time?: string;
  reason?: string;
}) {
  const reservationId = parseReservationId(reservationIdRaw);
  const row = await findReservationForGuest({
    chatId,
    reservationId,
    previousDate: date,
    previousTime: time,
  });
  if (!row) {
    throw new Error("No matching reservation found to cancel.");
  }

  const noteSuffix = reason
    ? `${row.notes ? `${row.notes}\n` : ""}[cancelled] ${reason}`
    : row.notes;

  const [updated] = await db
    .update(reservations)
    .set({
      status: "cancelled",
      notes: noteSuffix ?? row.notes,
    })
    .where(eq(reservations.id, row.id))
    .returning();

  if (!updated) {
    throw new Error("Could not cancel reservation.");
  }

  return updated;
}

export async function confirmReservationInDb({
  chatId,
  reservationIdRaw,
}: {
  chatId: string;
  reservationIdRaw?: unknown;
}) {
  const nowMs = Date.now();
  const reservationId = parseReservationId(reservationIdRaw);

  let row:
    | Awaited<ReturnType<typeof findReservationForGuest>>
    | undefined;

  if (reservationId !== undefined) {
    const [r] = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.guest_id, chatId)
        )
      )
      .limit(1);
    if (!r || r.status === "cancelled") {
      throw new Error("No matching reservation found to confirm.");
    }
    if (!isPendingBlockedStatus(r.status)) {
      throw new Error(
        "This reservation is not waiting for confirmation (it may already be confirmed)."
      );
    }
    if (!isActiveGuestReservation(r.status, nowMs)) {
      throw new Error(
        "The hold on this reservation has expired. The guest needs to request a new booking."
      );
    }
    row = r;
  } else {
    const recent = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.guest_id, chatId),
          ne(reservations.status, "cancelled")
        )
      )
      .orderBy(desc(reservations.id))
      .limit(40);
    row = recent.find(
      (r) =>
        isPendingBlockedStatus(r.status) &&
        isActiveGuestReservation(r.status, nowMs)
    );
    if (!row) {
      throw new Error(
        "No pending reservation found to confirm. The guest may need to book again if the hold expired."
      );
    }
  }

  const [updated] = await db
    .update(reservations)
    .set({ status: "confirmed" })
    .where(eq(reservations.id, row.id))
    .returning();

  if (!updated) {
    throw new Error("Could not confirm reservation.");
  }

  return updated;
}

export async function appendGuestNoteInDb({
  chatId,
  note,
  category,
  severity,
}: {
  chatId: string;
  note: string;
  category: "allergy" | "dietary" | "preference" | "other";
  severity?: string;
}) {
  await ensureGuestForChatId(chatId);

  const [g] = await db
    .select()
    .from(guests)
    .where(eq(guests.id, chatId))
    .limit(1);
  if (!g) {
    throw new Error("Guest record not found.");
  }

  const severityPart = severity ? ` (${severity})` : "";
  const line = `[${category}]${severityPart} ${note}`;
  const nextNotes = g.notes ? `${g.notes}\n${line}` : line;

  let nextDietary = g.dietary;
  if (category === "allergy" || category === "dietary") {
    nextDietary = g.dietary ? `${g.dietary}; ${note}` : note;
  }

  const [updated] = await db
    .update(guests)
    .set({
      notes: nextNotes,
      dietary: nextDietary,
    })
    .where(eq(guests.id, chatId))
    .returning();

  if (!updated) {
    throw new Error("Could not save guest note.");
  }

  return updated;
}
