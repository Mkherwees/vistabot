export const DEFAULT_RESTAURANT_NAME = "Bella Vista";

/** IANA zone for the physical restaurant (PST/PDT: America/Los_Angeles). */
export const DEFAULT_RESTAURANT_TIMEZONE = "America/Los_Angeles";

export function getRestaurantName(): string {
  const name = process.env.NEXT_PUBLIC_RESTAURANT_NAME?.trim();
  if (name) {
    return name;
  }
  return DEFAULT_RESTAURANT_NAME;
}

export function getRestaurantTimeZone(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_RESTAURANT_TIMEZONE?.trim() ||
    process.env.RESTAURANT_TIMEZONE?.trim();
  if (fromEnv) {
    const key = fromEnv.toUpperCase();
    if (key === "PST" || key === "PDT") {
      return DEFAULT_RESTAURANT_TIMEZONE;
    }
    return fromEnv;
  }
  return DEFAULT_RESTAURANT_TIMEZONE;
}
