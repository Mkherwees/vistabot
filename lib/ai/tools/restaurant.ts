import { tool } from "ai";
import { z } from "zod";
import {
  handleAddGuestNote,
  handleCancelReservation,
  handleCreateBooking,
  handleUpdateReservation,
} from "@/lib/restaurant/handlers";

export function createRestaurantTools(context: { chatId: string }) {
  const { chatId } = context;

  const createBooking = tool({
    description:
      "Use when the guest wants a NEW reservation. Call this before saying a booking was created. Do not use createDocument for reservations.",
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
      seatingPreference: z
        .string()
        .optional()
        .describe("e.g. window, patio, quiet"),
      notes: z.string().optional(),
    }),
    execute: async (input) =>
      handleCreateBooking({ chatId, operation: "createBooking", ...input }),
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
    createBooking,
    updateReservation,
    addGuestNote,
    cancelReservation,
  };
}
