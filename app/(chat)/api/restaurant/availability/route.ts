import { handleListAvailableSlots } from "@/lib/restaurant/handlers";

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    const json: unknown = await request.json();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      body = json as Record<string, unknown>;
    }
  } catch {
    body = {};
  }
  const result = await handleListAvailableSlots(body);
  return Response.json(result);
}
