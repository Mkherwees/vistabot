/**
 * Single "name" field → first + last for storage.
 * - One word → first name only.
 * - Two+ words → first = first space-delimited token, last = last space-delimited token
 *   (middle parts are not stored separately).
 */
export function parseGuestNameFromString(raw: string): {
  firstName: string;
  lastName?: string;
} {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) {
    return { firstName: "" };
  }
  const parts = collapsed.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0] ?? "" };
  }
  return {
    firstName: parts[0] ?? "",
    lastName: parts.at(-1),
  };
}
