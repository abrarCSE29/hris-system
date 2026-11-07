-- Sequence backing service_requests.reference (SR-1001, SR-1002, ...). Must exist before the table.
CREATE SEQUENCE "service_request_ref_seq" START WITH 1001;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'MANAGER', 'HR_ADMIN');

-- CreateEnum
CREATE TYPE "Country" AS ENUM ('BANGLADESH', 'MALAYSIA', 'SRI_LANKA', 'CYPRUS');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'ON_PROBATION', 'ON_NOTICE');

-- CreateEnum
CREATE TYPE "RequestCategoryCode" AS ENUM ('IT_EQUIPMENT', 'SOFTWARE_ACCESS', 'HR_QUERY', 'FACILITIES', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('DEPARTMENT', 'MANAGER');

-- CreateEnum
CREATE TYPE "OnboardingInstanceStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "head_id" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "country" "Country" NOT NULL,
    "department_id" UUID NOT NULL,
    "manager_id" UUID,
    "job_title" TEXT NOT NULL,
    "joining_date" DATE NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_categories" (
    "id" UUID NOT NULL,
    "code" "RequestCategoryCode" NOT NULL,
    "name" TEXT NOT NULL,
    "handling_department_id" UUID NOT NULL,

    CONSTRAINT "request_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL DEFAULT (('SR-'::text || (nextval('service_request_ref_seq'::regclass))::text)),
    "requester_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "handling_department_id" UUID NOT NULL,
    "assignee_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "RequestPriority" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "assignee_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_comments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_tasks" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_department_id" UUID,
    "offset_days" INTEGER NOT NULL,
    "deadline_label" TEXT NOT NULL,
    "depends_on_id" UUID,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_instances" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "status" "OnboardingInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_department_id" UUID,
    "assignee_id" UUID,
    "due_date" DATE NOT NULL,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "depends_on_id" UUID,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" UUID,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "departments_head_id_idx" ON "departments"("head_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_code_key" ON "users"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "users_department_id_status_idx" ON "users"("department_id", "status");

-- CreateIndex
CREATE INDEX "users_country_idx" ON "users"("country");

-- CreateIndex
CREATE UNIQUE INDEX "request_categories_code_key" ON "request_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_reference_key" ON "service_requests"("reference");

-- CreateIndex
CREATE INDEX "service_requests_requester_id_created_at_idx" ON "service_requests"("requester_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_requests_assignee_id_status_idx" ON "service_requests"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "service_requests_status_created_at_idx" ON "service_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_requests_category_id_status_idx" ON "service_requests"("category_id", "status");

-- CreateIndex
CREATE INDEX "request_events_request_id_created_at_idx" ON "request_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "request_comments_request_id_created_at_idx" ON "request_comments"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_name_key" ON "onboarding_templates"("name");

-- CreateIndex
CREATE INDEX "template_tasks_template_id_sort_order_idx" ON "template_tasks"("template_id", "sort_order");

-- CreateIndex
CREATE INDEX "template_tasks_depends_on_id_idx" ON "template_tasks"("depends_on_id");

-- CreateIndex
CREATE INDEX "onboarding_instances_employee_id_idx" ON "onboarding_instances"("employee_id");

-- CreateIndex
CREATE INDEX "onboarding_tasks_instance_id_sort_order_idx" ON "onboarding_tasks"("instance_id", "sort_order");

-- CreateIndex
CREATE INDEX "onboarding_tasks_depends_on_id_idx" ON "onboarding_tasks"("depends_on_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_categories" ADD CONSTRAINT "request_categories_handling_department_id_fkey" FOREIGN KEY ("handling_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "request_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_handling_department_id_fkey" FOREIGN KEY ("handling_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_comments" ADD CONSTRAINT "request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "onboarding_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_owner_department_id_fkey" FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "template_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "onboarding_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "onboarding_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_owner_department_id_fkey" FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "onboarding_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
