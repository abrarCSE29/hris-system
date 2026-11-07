-- Hand-written migration: rules Prisma's schema language cannot express.
-- Every generated migration MUST be reviewed so it does not drop anything defined here
-- (see README: "prisma migrate diff" check).

-- ── CHECK constraints ─────────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD CONSTRAINT "users_not_own_manager" CHECK ("manager_id" IS NULL OR "manager_id" <> "id"),
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_assignee_when_assigned"
  CHECK ("status" = 'SUBMITTED' OR "assignee_id" IS NOT NULL);

ALTER TABLE "template_tasks"
  ADD CONSTRAINT "template_tasks_owner_department"
    CHECK (("owner_type" = 'DEPARTMENT') = ("owner_department_id" IS NOT NULL)),
  ADD CONSTRAINT "template_tasks_not_self_dependent"
    CHECK ("depends_on_id" IS NULL OR "depends_on_id" <> "id"),
  ADD CONSTRAINT "template_tasks_offset_non_negative" CHECK ("offset_days" >= 0);

ALTER TABLE "onboarding_tasks"
  ADD CONSTRAINT "onboarding_tasks_owner_department"
    CHECK (("owner_type" = 'DEPARTMENT') = ("owner_department_id" IS NOT NULL)),
  ADD CONSTRAINT "onboarding_tasks_not_self_dependent"
    CHECK ("depends_on_id" IS NULL OR "depends_on_id" <> "id");

-- ── Partial indexes (spec §3.4) ───────────────────────────────────────────────
-- Department queue: open requests only.
CREATE INDEX "service_requests_dept_queue_idx"
  ON "service_requests" ("handling_department_id", "created_at" DESC)
  WHERE "status" NOT IN ('RESOLVED', 'CLOSED');

-- One ACTIVE onboarding per employee.
CREATE UNIQUE INDEX "onboarding_instances_one_active_per_employee"
  ON "onboarding_instances" ("employee_id")
  WHERE "status" = 'ACTIVE';

-- Department and manager task queues: unfinished tasks only.
CREATE INDEX "onboarding_tasks_dept_queue_idx"
  ON "onboarding_tasks" ("owner_department_id", "due_date")
  WHERE "status" <> 'COMPLETED';

CREATE INDEX "onboarding_tasks_assignee_queue_idx"
  ON "onboarding_tasks" ("assignee_id", "due_date")
  WHERE "status" <> 'COMPLETED';

-- ── Row-level security: enabled with NO policies (spec §3.5) ──────────────────
-- Blocks Supabase's public Data API. The backend connects as the table owner, which bypasses RLS.
ALTER TABLE "departments"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_categories"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_requests"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_events"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_comments"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_templates"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "template_tasks"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_instances"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_tasks"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations"    ENABLE ROW LEVEL SECURITY;
