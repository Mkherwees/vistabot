import "server-only";

import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { chat, guests, reservations, restaurantTables } from "@/lib/db/schema";
import { db } from "@/lib/db/queries";

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

  for (const table of ordered) {
    const [taken] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.table_id, table.id),
          eq(reservations.date, date),
          eq(reservations.time, time),
          ne(reservations.status, "cancelled")
        )
      )
      .limit(1);
    if (!taken) {
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
    return r ?? null;
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
    return r ?? null;
  }

  const [latest] = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.guest_id, chatId),
        ne(reservations.status, "cancelled")
      )
    )
    .orderBy(desc(reservations.id))
    .limit(1);
  return latest ?? null;
}

export async function createBookingInDb({
  chatId,
  partySize,
  date,
  time,
  seatingPreference,
  notes,
}: {
  chatId: string;
  partySize: number;
  date: string;
  time: string;
  seatingPreference?: string;
  notes?: string;
}) {
  await ensureGuestForChatId(chatId);
  const tableId = await pickFreeTableId(
    partySize,
    seatingPreference,
    date,
    time
  );

  const [created] = await db
    .insert(reservations)
    .values({
      guest_id: chatId,
      table_id: tableId,
      party_size: partySize,
      date,
      time,
      status: "confirmed",
      notes: notes ?? null,
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
      const [blocking] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.table_id, row.table_id),
            eq(reservations.date, nd),
            eq(reservations.time, nt),
            ne(reservations.id, row.id),
            ne(reservations.status, "cancelled")
          )
        )
        .limit(1);
      if (blocking) {
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
