CREATE SEQUENCE IF NOT EXISTS reservations_id_seq;
SELECT setval(
  'reservations_id_seq',
  COALESCE((SELECT MAX("id") FROM "reservations"), 1)
);
ALTER TABLE "reservations"
  ALTER COLUMN "id" SET DEFAULT nextval('reservations_id_seq');
ALTER SEQUENCE reservations_id_seq OWNED BY "reservations"."id";
