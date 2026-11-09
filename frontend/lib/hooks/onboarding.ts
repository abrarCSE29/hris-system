"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildQuery } from "@/lib/query";
import type {
  CreatedUser, InstanceDetail, InstanceHeader, Paginated, QueueTask, TaskAction, TemplateDetail, TemplateSummary,
} from "@/lib/types";

const KEY = "onboarding";

export function useMyOnboarding() {
  return useQuery({ queryKey: [KEY, "me"], queryFn: () => api<InstanceDetail | null>("/onboarding/me") });
}

export interface InstanceFilters { countryId?: string; status?: string; page?: number; pageSize?: number }
export function useInstances(filters: InstanceFilters) {
  return useQuery({
    queryKey: [KEY, "instances", filters],
    queryFn: () => api<Paginated<InstanceHeader>>(`/onboarding/instances${buildQuery({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

export function useInstance(id: string) {
  return useQuery({ queryKey: [KEY, "instance", id], queryFn: () => api<InstanceDetail>(`/onboarding/instances/${id}`), retry: false });
}

export interface TaskFilters { status?: string; overdue?: string; /** "false": only tasks nobody has been given yet */ assigned?: string; page?: number; pageSize?: number }
export function useTaskQueue(filters: TaskFilters) {
  return useQuery({
    queryKey: [KEY, "tasks", filters],
    queryFn: () => api<Paginated<QueueTask>>(`/onboarding/tasks${buildQuery({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

export function useTaskTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: TaskAction }) =>
      api<{ instanceStatus: "ACTIVE" | "COMPLETED" }>(`/onboarding/tasks/${taskId}/transitions`, { method: "POST", body: { action } }),
    meta: {
      success: (v: { action: TaskAction }, r: { instanceStatus: "ACTIVE" | "COMPLETED" }) =>
        v.action === "start" ? "Task started" : r.instanceStatus === "COMPLETED" ? "Task completed. The onboarding checklist is finished" : "Task completed",
    },
    // Completing a task can unblock others and finish the checklist, so refresh everything onboarding-related.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** The head of the owning department (or HR) hands a department task to one of its members. */
export function useAssignTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, assigneeId }: { taskId: string; assigneeId: string }) =>
      api<{ assignee: { fullName: string } | null }>(`/onboarding/tasks/${taskId}/assign`, { method: "POST", body: { assigneeId } }),
    meta: { success: (_v: unknown, r: { assignee: { fullName: string } | null }) => `Task assigned to ${r.assignee?.fullName ?? "the team member"}` },
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useTemplates() {
  return useQuery({ queryKey: [KEY, "templates"], queryFn: () => api<{ data: TemplateSummary[] }>("/onboarding/templates") });
}

export function useTemplate(id: string) {
  return useQuery({ queryKey: [KEY, "template", id], queryFn: () => api<TemplateDetail>(`/onboarding/templates/${id}`), retry: false });
}

export interface TemplateInput {
  name: string;
  description: string;
  tasks: {
    key: string;
    title: string;
    description: string;
    ownerType: "DEPARTMENT" | "MANAGER";
    ownerDepartmentId?: string;
    offsetDays: number;
    deadlineLabel: string;
    dependsOnKey?: string;
  }[];
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateInput) => api<TemplateDetail>("/onboarding/templates", { method: "POST", body }),
    meta: { success: "Template created" },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "templates"] }),
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateInput) => api<TemplateDetail>(`/onboarding/templates/${id}`, { method: "PUT", body }),
    meta: { success: "Template saved" },
    onSuccess: (t) => {
      qc.setQueryData([KEY, "template", id], t);
      qc.invalidateQueries({ queryKey: [KEY, "templates"] });
    },
  });
}

export function useAssignChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { employeeId: string; templateId: string; startDate?: string }) =>
      api<InstanceDetail>("/onboarding/instances", { method: "POST", body }),
    meta: { success: "Onboarding checklist assigned" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export interface NewUserInput {
  fullName: string;
  email: string;
  countryId: string;
  /** Id of the role (from `useMeta().roles`); defaults to Employee on the server when omitted. */
  roleId?: string;
  departmentId: string;
  managerId: string;
  jobTitle: string;
  joiningDate: string;
  /** Id of the status (Active or On probation); defaults to On probation on the server when omitted. */
  statusId?: string;
  templateId?: string;
  password?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewUserInput) => api<CreatedUser>("/users", { method: "POST", body }),
    meta: { success: "New hire added" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
