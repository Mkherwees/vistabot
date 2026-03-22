DROP TABLE IF EXISTS "reservations";
DROP TABLE IF EXISTS "guests";

CREATE TABLE "guests" (
  "id" uuid PRIMARY KEY NOT NULL REFERENCES "Chat"("id") ON DELETE CASCADE,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "email" text,
  "dietary" text,
  "notes" text
);

CREATE TABLE "reservations" (
  "id" integer PRIMARY KEY NOT NULL,
  "guest_id" uuid NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "table_id" integer NOT NULL REFERENCES "tables"("id"),
  "party_size" integer,
  "date" text,
  "time" text,
  "status" text,
  "notes" text
);

INSERT INTO "guests" ("id", "first_name", "last_name", "phone", "email", "dietary", "notes")
SELECT
  "id",
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM "Chat"
WHERE NOT EXISTS (SELECT 1 FROM "guests" AS g WHERE g."id" = "Chat"."id");
