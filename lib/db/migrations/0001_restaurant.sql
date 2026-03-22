CREATE TABLE IF NOT EXISTS "guests" (
  "id" integer PRIMARY KEY NOT NULL,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "email" text,
  "dietary" text,
  "notes" text
);

CREATE TABLE IF NOT EXISTS "tables" (
  "id" integer PRIMARY KEY NOT NULL,
  "capacity" integer,
  "location" text
);

CREATE TABLE IF NOT EXISTS "reservations" (
  "id" integer PRIMARY KEY NOT NULL,
  "guest_id" integer NOT NULL REFERENCES "guests"("id"),
  "table_id" integer NOT NULL REFERENCES "tables"("id"),
  "party_size" integer,
  "date" text,
  "time" text,
  "status" text,
  "notes" text
);

INSERT INTO "guests" ("id", "first_name", "last_name", "phone", "email", "dietary", "notes") VALUES
(1, 'Maria', 'Chen', '+15551001001', 'maria@email.com', 'vegetarian', 'Prefers window seating'),
(2, 'James', 'Patel', '+15551001002', 'james@email.com', 'none', 'Regular — birthday in June'),
(3, 'Sofia', 'Reyes', '+15551001003', 'sofia@email.com', 'gluten-free', 'Allergy: tree nuts'),
(4, 'Marcus', 'Nguyen', '+15551001004', 'marcus@email.com', 'vegan', 'VIP — comp dessert on visits');

INSERT INTO "tables" ("id", "capacity", "location") VALUES
(1, 2, 'window'),
(2, 2, 'patio'),
(3, 4, 'main'),
(4, 4, 'main'),
(5, 6, 'private room');

INSERT INTO "reservations" ("id", "guest_id", "table_id", "party_size", "date", "time", "status", "notes") VALUES
(1, 1, 3, 3, '2026-03-20', '19:00', 'confirmed', 'Anniversary dinner'),
(2, 2, 1, 2, '2026-03-21', '20:00', 'confirmed', NULL),
(3, 3, 5, 5, '2026-03-22', '18:30', 'confirmed', 'Gluten-free menu requested'),
(4, 4, 4, 4, '2026-03-19', '19:30', 'completed', NULL);
