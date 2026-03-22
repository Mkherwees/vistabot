import { tool } from "ai";
import { z } from "zod";
import {
  handleAddGuestNote,
  handleCancelReservation,
  handleConfirmReservation,
  handleCreateBooking,
  handleListAvailableSlots,
  handleListGuestReservations,
  handleUpdateReservation,
} from "@/lib/restaurant/handlers";

export function createRestaurantTools(context: { chatId: string }) {
  const { chatId } = context;

  const listMyReservations = tool({
    description:
      "Lists this guest's upcoming reservations (and any active hold pending confirmation) for this chat: reservation id, date, time, party size, and status (confirmed vs pending_confirmation). Call when the guest asks what they have booked or wants to see their reservations.",
    inputSchema: z.object({}),
    execute: async () =>
      handleListGuestReservations({
        chatId,
        operation: "listGuestReservations",
      }),
  });

  const listAvailableSlots = tool({
    description:
      "Returns bookable start times (HH:mm) for a given calendar date and party size, based on opening hours and current reservations. Call when the guest needs time options or before suggesting times — avoids trial-and-error. Requires a concrete date (or phrase the server can resolve).",
    inputSchema: z.object({
      date: z
        .string()
        .describe(
          "Calendar day (YYYY-MM-DD preferred) or phrase like 'this Friday' resolved in the restaurant timezone"
        ),
      partySize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Head count; defaults to 2 if omitted"),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone for interpreting the date phrase"),
      seatingPreference: z
        .string()
        .optional()
        .describe(
          "Optional area (e.g. window) — same as createBooking seating preference"
        ),
    }),
    execute: async (input) =>
      handleListAvailableSlots({
        chatId,
        operation: "listAvailableSlots",
        ...input,
      }),
  });

  const createBooking = tool({
    description:
      "Use for a NEW reservation request. Minimum required: party size, date, time, and at least a first name (via guestName or firstName). This creates a time-limited hold (not fully confirmed yet). After success, summarize the booking and ask the guest to confirm; when they agree, call confirmReservation. Prefer passing guestName as the guest said it (e.g. 'Maria' or 'Maria Chen'); the server splits into first/last. Optional: dietaryRestrictions, guestNotes, reservationNotes, seatingPreference.",
    inputSchema: z.object({
      partySize: z.number().int().positive().describe("Number of guests"),
      date: z
        .string()
        .describe("Reservation date (e.g. ISO date or 'today', 'Friday')"),
      time: z.string().describe("Local time (e.g. '21:00', '9pm')"),
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone (omit to use the restaurant default; all bookings use the restaurant clock)"
        ),
      guestName: z
        .string()
        .optional()
        .describe(
          "Guest's name as they gave it (ask for 'name' only, not first/last separately). One word = first name only; multiple words: first token → first name, last token → last name."
        ),
      firstName: z
        .string()
        .optional()
        .describe(
          "Only if not using guestName: first name alone (stored on guest profile)"
        ),
      lastName: z
        .string()
        .optional()
        .describe(
          "Only if not using guestName: last name alone (stored on guest profile)"
        ),
      dietaryRestrictions: z
        .string()
        .optional()
        .describe(
          "Dietary restrictions or allergies for the kitchen — stored on guest profile (guests.dietary)"
        ),
      guestNotes: z
        .string()
        .optional()
        .describe(
          "Person-level notes: preferences about them as a diner (e.g. prefers window seats, quiet table). Stored on guest profile."
        ),
      reservationNotes: z
        .string()
        .optional()
        .describe(
          "Notes about this specific booking/visit (e.g. anniversary, birthday, business dinner). Stored on the reservation row only."
        ),
      seatingPreference: z
        .string()
        .optional()
        .describe(
          "Table area for seating algorithm (e.g. window, patio). Also mention in guestNotes if it is a personal preference."
        ),
    }),
    execute: async (input) =>
      handleCreateBooking({ chatId, operation: "createBooking", ...input }),
  });

  const confirmReservation = tool({
    description:
      "Call after createBooking succeeds and the guest has clearly confirmed the summarized details (verbal yes). Sets the reservation to confirmed. If reservationId is omitted, the latest pending hold for this chat is used.",
    inputSchema: z.object({
      reservationId: z
        .string()
        .optional()
        .describe(
          "Reservation id from the createBooking result (e.g. from the tool message). Omit if there is only one pending hold."
        ),
    }),
    execute: async (input) =>
      handleConfirmReservation({
        chatId,
        operation: "confirmReservation",
        ...input,
      }),
  });

  const updateReservation = tool({
    description:
      "Use when the guest wants to CHANGE an existing booking (date, time, or party size). Call before confirming the change.",
    inputSchema: z.object({
      reservationId: z
        .string()
        .optional()
        .describe("If the guest gave an id or confirmation code"),
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone (omit for restaurant default; used when interpreting dates/times)"
        ),
      previousDate: z.string().optional(),
      previousTime: z.string().optional(),
      newDate: z.string().optional(),
      newTime: z.string().optional(),
      newPartySize: z.number().int().positive().optional(),
      notes: z.string().optional(),
    }),
    execute: async (input) =>
      handleUpdateReservation({
        chatId,
        operation: "updateReservation",
        ...input,
      }),
  });

  const addGuestNote = tool({
    description:
      "Use to log allergies, dietary restrictions, or special preferences for this guest or their reservation. Call when the guest shares medical or kitchen-relevant info.",
    inputSchema: z.object({
      note: z.string().describe("Full note to store for kitchen/staff"),
      category: z
        .enum(["allergy", "dietary", "preference", "other"])
        .describe("Type of note"),
      severity: z
        .string()
        .optional()
        .describe("e.g. severe, mild — especially for allergies"),
    }),
    execute: async (input) =>
      handleAddGuestNote({ chatId, operation: "addGuestNote", ...input }),
  });

  const cancelReservation = tool({
    description:
      "Use when the guest wants to CANCEL a booking. Call before stating cancellation is complete.",
    inputSchema: z.object({
      reservationId: z.string().optional(),
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone (omit for restaurant default; used when interpreting date/time)"
        ),
      date: z.string().optional().describe("Which booking date to cancel"),
      time: z.string().optional(),
      reason: z.string().optional(),
    }),
    execute: async (input) =>
      handleCancelReservation({
        chatId,
        operation: "cancelReservation",
        ...input,
      }),
  });

  return {
    listMyReservations,
    listAvailableSlots,
    createBooking,
    confirmReservation,
    updateReservation,
    addGuestNote,
    cancelReservation,
  };
}
