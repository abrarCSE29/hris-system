-- Role, country and status of a user move from enums to their own tables (spec docs/spec-lookup-tables.md, T31).
-- Hand-written because the data must be carried over. Order: create and fill the tables, add the new columns, backfill, stop if any
-- user is left empty, then make the columns required, add the foreign keys, replace the indexes and drop the old columns and enums.
-- The ids are generated here (gen_random_uuid) and differ between environments; code never depends on them.

-- Lookup tables --------------------------------------------------------------------------------------------------------------
CREATE TABLE "roles" (
    "id"   UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "countries" (
    "id"        UUID NOT NULL,
    "shortcode" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    CONSTRAINT "countries_pkey" PRIMARY KEY ("id"),
    -- ISO 3166-1 alpha-2: exactly two capital letters.
    CONSTRAINT "countries_shortcode_format" CHECK ("shortcode" ~ '^[A-Z]{2}$')
);

CREATE TABLE "user_statuses" (
    "id"   UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "user_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX "countries_shortcode_key" ON "countries"("shortcode");
CREATE UNIQUE INDEX "user_statuses_code_key" ON "user_statuses"("code");

-- Closed to everyone but the backend's own database role, like every other table.
ALTER TABLE "roles"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "countries"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_statuses" ENABLE ROW LEVEL SECURITY;

INSERT INTO "roles" ("id", "code", "name") VALUES
    (gen_random_uuid(), 'EMPLOYEE', 'Employee'),
    (gen_random_uuid(), 'MANAGER',  'Manager'),
    (gen_random_uuid(), 'HR_ADMIN', 'HR Admin');

INSERT INTO "countries" ("id", "shortcode", "name") VALUES
    (gen_random_uuid(), 'BD', 'Bangladesh'),
    (gen_random_uuid(), 'MY', 'Malaysia'),
    (gen_random_uuid(), 'LK', 'Sri Lanka'),
    (gen_random_uuid(), 'CY', 'Cyprus');

INSERT INTO "user_statuses" ("id", "code", "name") VALUES
    (gen_random_uuid(), 'ACTIVE',       'Active'),
    (gen_random_uuid(), 'ON_PROBATION', 'On probation'),
    (gen_random_uuid(), 'ON_NOTICE',    'On notice');

-- New columns, filled from the old ones -----------------------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "role_id"    UUID,
                    ADD COLUMN "country_id" UUID,
                    ADD COLUMN "status_id"  UUID;

UPDATE "users" u SET "role_id"   = r."id" FROM "roles" r         WHERE r."code" = u."role"::text;
UPDATE "users" u SET "status_id" = s."id" FROM "user_statuses" s WHERE s."code" = u."status"::text;
UPDATE "users" u SET "country_id" = c."id" FROM "countries" c
 WHERE c."shortcode" = CASE u."country"::text
         WHEN 'BANGLADESH' THEN 'BD'
         WHEN 'MALAYSIA'   THEN 'MY'
         WHEN 'SRI_LANKA'  THEN 'LK'
         WHEN 'CYPRUS'     THEN 'CY'
       END;

-- Stop (and undo everything) if a user could not be matched, rather than lose their role, country or status.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "role_id" IS NULL OR "country_id" IS NULL OR "status_id" IS NULL) THEN
    RAISE EXCEPTION 'user_lookup_tables: some users could not be matched to a role, country or status';
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "role_id"    SET NOT NULL,
                    ALTER COLUMN "country_id" SET NOT NULL,
                    ALTER COLUMN "status_id"  SET NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey"    FOREIGN KEY ("role_id")    REFERENCES "roles"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_status_id_fkey"  FOREIGN KEY ("status_id")  REFERENCES "user_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes: the old ones go with their columns; the replacements are on the new columns.
DROP INDEX "users_department_id_status_idx";
DROP INDEX "users_country_idx";
CREATE INDEX "users_department_id_status_id_idx" ON "users"("department_id", "status_id");
CREATE INDEX "users_country_id_idx" ON "users"("country_id");

ALTER TABLE "users" DROP COLUMN "role", DROP COLUMN "country", DROP COLUMN "status";
DROP TYPE "Role";
DROP TYPE "Country";
DROP TYPE "UserStatus";
