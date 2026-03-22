import { inspect } from "node:util";

/**
 * Logs restaurant API calls to stderr (dummy endpoints for development).
 * Avoids `console.*` to satisfy project lint rules.
 */
export function logRestaurantEndpoint(
  endpoint: string,
  payload: unknown
): void {
  const line = `[restaurant-api:${endpoint}] ${inspect(payload, { depth: 6, colors: false })}\n`;
  process.stderr.write(line);
}
