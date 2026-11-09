/** The role's `code`. Behaviour (navigation, permissions in the UI) compares on this, never on an id. */
export type Role = "EMPLOYEE" | "MANAGER" | "HR_ADMIN";
export type UserStatus = "ACTIVE" | "ON_PROBATION" | "ON_NOTICE";

/** The role, country and status of a person are rows of lookup tables; the API sends each as an object with its id and display name. */
export interface RoleRef { id: string; code: Role; name: string }
export interface StatusRef { id: string; code: UserStatus; name: string }
export interface CountryRef { id: string; shortcode: string; name: string }

export interface User {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  role: RoleRef;
  country: CountryRef;
  department: { id: string; code: string; name: string };
  managerId: string | null;
  jobTitle: string;
  status: StatusRef;
  joiningDate: string;
}

export interface MeResponse {
  user: User;
  isNewHire: boolean;
  headOfDepartmentId: string | null;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  headId: string | null;
}

export interface Meta {
  departments: Department[];
  requestCategories: { id: string; code: string; name: string; handlingDepartmentId: string }[];
  /** The three lookup lists, with the ids that filters and forms send. Roles and statuses in natural order, countries by name. */
  roles: RoleRef[];
  countries: CountryRef[];
  userStatuses: StatusRef[];
  enums: {
    requestPriorities: string[];
    requestStatuses: string[];
    ownerTypes: string[];
    onboardingTaskStatuses: string[];
  };
}

export type RequestStatus = "SUBMITTED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type RequestPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type RequestAction = "assign" | "start" | "resolve" | "close";

export interface RequestSummary {
  id: string;
  reference: string;
  title: string;
  priority: RequestPriority;
  status: RequestStatus;
  /** How it was raised: with the form, or through the chat assistant. */
  channel: "FORM" | "CHAT";
  createdAt: string;
  updatedAt: string;
  category: { id: string; code: string; name: string };
  handlingDepartment: { id: string; code: string; name: string };
  requester: { id: string; fullName: string; country: CountryRef };
  assignee: { id: string; fullName: string } | null;
}

export interface RequestEvent {
  id: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  actor: { id: string; fullName: string };
  assignee: { id: string; fullName: string } | null;
  note: string | null;
  createdAt: string;
}

export interface RequestComment {
  id: string;
  body: string;
  author: { id: string; fullName: string };
  createdAt: string;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  events: RequestEvent[];
  comments: RequestComment[];
  allowedActions: RequestAction[];
}

/** What POST /requests/chat-draft returns: the form's fields, filled in by the assistant. Nothing is saved yet. */
export interface ChatDraft {
  title: string;
  description: string;
  categoryId: string;
  priority: RequestPriority;
  departmentId: string;
  confidence: number;
  lowConfidence: boolean;
  reasoning: string;
}

export interface Assignable {
  id: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
/** Stored status plus the calculated BLOCKED. */
export type DisplayStatus = TaskStatus | "BLOCKED";
export type TaskAction = "start" | "complete";
/** What the server may offer someone on a task: work it (start / complete) or, for the department head and HR, assign it. */
export type TaskAllowedAction = TaskAction | "assign";

export interface OnboardingTask {
  id: string;
  instanceId: string;
  title: string;
  description: string;
  ownerType: "DEPARTMENT" | "MANAGER";
  ownerDepartment: { id: string; code: string; name: string } | null;
  assignee: { id: string; fullName: string } | null;
  dueDate: string;
  status: TaskStatus;
  displayStatus: DisplayStatus;
  blocked: boolean;
  overdue: boolean;
  dependsOn: { id: string; title: string } | null;
  completedAt: string | null;
  completedBy: { id: string; fullName: string } | null;
  sortOrder: number;
  allowedActions: TaskAllowedAction[];
}

export interface Progress {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  overdue: number;
  percentComplete: number;
}

export interface InstanceHeader {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  startDate: string;
  createdAt: string;
  employee: {
    id: string;
    fullName: string;
    email: string;
    country: CountryRef;
    jobTitle: string;
    managerId: string | null;
    department: { id: string; code: string; name: string };
  };
  template: { id: string; name: string };
  progress: Progress;
}

export interface InstanceDetail extends InstanceHeader {
  tasks: OnboardingTask[];
}

export interface QueueTask extends OnboardingTask {
  employee: { id: string; fullName: string; country: CountryRef };
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: { id: string; fullName: string };
  taskCount: number;
}

export interface TemplateTask {
  id: string;
  title: string;
  description: string;
  ownerType: "DEPARTMENT" | "MANAGER";
  ownerDepartment: { id: string; code: string; name: string } | null;
  offsetDays: number;
  deadlineLabel: string;
  dependsOnId: string | null;
  sortOrder: number;
}

export interface TemplateDetail extends Omit<TemplateSummary, "taskCount"> {
  tasks: TemplateTask[];
}

export interface CreatedUser {
  user: User;
  temporaryPassword?: string;
  onboarding?: { instanceId: string; taskCount: number };
}
