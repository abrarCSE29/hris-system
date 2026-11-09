// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const createRequest = vi.fn();
const createUser = vi.fn();
const useUsersCall = vi.fn();

const META = {
  departments: [
    { id: "d-it", code: "ITOPS", name: "IT Operations", headId: "m-it" },
    { id: "d-eng", code: "ENG", name: "Engineering", headId: "m-eng" },
  ],
  requestCategories: [{ id: "c-laptop", code: "IT_EQUIPMENT", name: "IT Equipment", handlingDepartmentId: "d-it" }],
  countries: [{ id: "c-bd", shortcode: "BD", name: "Bangladesh" }, { id: "c-cy", shortcode: "CY", name: "Cyprus" }],
  roles: [{ id: "r-emp", code: "EMPLOYEE", name: "Employee" }, { id: "r-mgr", code: "MANAGER", name: "Manager" }, { id: "r-hr", code: "HR_ADMIN", name: "HR Admin" }],
  userStatuses: [{ id: "s-act", code: "ACTIVE", name: "Active" }, { id: "s-prob", code: "ON_PROBATION", name: "On probation" }, { id: "s-not", code: "ON_NOTICE", name: "On notice" }],
  enums: { requestPriorities: ["LOW", "MEDIUM", "HIGH", "URGENT"], requestStatuses: [], ownerTypes: [], onboardingTaskStatuses: [] },
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/users", () => ({
  useMeta: () => ({ data: META }),
  useUsers: (filters: unknown, options: unknown) => (useUsersCall(filters, options), { data: { data: [{ id: "m-eng", fullName: "Eng Manager", jobTitle: "Engineering Manager" }, { id: "m-it", fullName: "IT Head", jobTitle: "Head of IT" }] } }),
}));
vi.mock("@/lib/hooks/requests", () => ({ useCreateRequest: () => ({ mutate: createRequest, isPending: false, error: null }) }));
vi.mock("@/lib/hooks/onboarding", () => ({
  useTemplates: () => ({ data: { data: [{ id: "t-std", name: "Standard Onboarding", taskCount: 10 }] } }),
  useCreateUser: () => ({ mutate: createUser, isPending: false, error: null, reset: vi.fn() }),
}));

import NewPersonPage from "@/app/(app)/people/new/page";
import NewRequestPage from "@/app/(app)/requests/new/page";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => { push.mockClear(); createRequest.mockClear(); createUser.mockClear(); });
afterEach(cleanup);

const choose = async (name: string | RegExp, option: string) => {
  await userEvent.click(screen.getByRole("combobox", { name }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
};

describe("New request form", () => {
  it("stays disabled until category, title and description are filled", async () => {
    render(<NewRequestPage />);
    const submit = screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await choose("Category", "IT Equipment");
    await userEvent.type(screen.getByLabelText("Title"), "New laptop");
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Description"), "Mine is slow");
    expect(submit.disabled).toBe(false);
  });

  it("tells you which team handles the chosen category", async () => {
    render(<NewRequestPage />);
    expect(screen.queryByText(/Handled by/)).toBeNull();
    await choose("Category", "IT Equipment");
    expect(screen.getByText("Handled by IT Operations.")).toBeTruthy();
  });

  it("submits the chosen values, with Medium as the default priority", async () => {
    render(<NewRequestPage />);
    await choose("Category", "IT Equipment");
    await userEvent.type(screen.getByLabelText("Title"), "  New laptop  ");
    await userEvent.type(screen.getByLabelText("Description"), "Mine is slow");
    expect(screen.getByRole("combobox", { name: "Priority" }).textContent).toContain("Medium");
    await choose("Priority", "Urgent");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(createRequest).toHaveBeenCalledOnce();
    expect(createRequest.mock.calls[0][0]).toEqual({ categoryId: "c-laptop", title: "New laptop", description: "Mine is slow", priority: "URGENT" });
  });
});

describe("Add new hire form", () => {
  async function fillRequired() {
    await userEvent.type(screen.getByLabelText("Full name"), "Kim Lee");
    await userEvent.type(screen.getByLabelText("Work email"), "kim@hris.test");
    await choose("Country", "Cyprus");
    await choose("Department", "Engineering");
    await userEvent.type(screen.getByLabelText("Job title"), "Engineer");
  }

  it("suggests the department head as manager, and sends the form values", async () => {
    render(<NewPersonPage />);
    await fillRequired();
    expect(screen.getByRole("combobox", { name: "Reports to" }).textContent).toContain("Eng Manager"); // the Engineering head
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(createUser).toHaveBeenCalledOnce();
    const body = createUser.mock.calls[0][0];
    expect(body).toMatchObject({
      fullName: "Kim Lee", email: "kim@hris.test", countryId: "c-cy", departmentId: "d-eng", managerId: "m-eng", jobTitle: "Engineer", statusId: "s-prob",
    });
    expect(body).not.toHaveProperty("templateId"); // "None" must not send a template
    expect(body).not.toHaveProperty("password"); // blank = generate one
  });

  it("finds the managers by the id of the Manager role from the role list, not by a code", () => {
    render(<NewPersonPage />);
    expect(useUsersCall).toHaveBeenCalledWith({ roleId: "r-mgr", pageSize: 100 }, { enabled: true });
  });

  it("sends the Employee role by default and the chosen role otherwise", async () => {
    render(<NewPersonPage />);
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(createUser.mock.calls[0][0]).toMatchObject({ roleId: "r-emp" });
    createUser.mockClear();
    await choose("Role", "HR Admin");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(createUser.mock.calls[0][0]).toMatchObject({ roleId: "r-hr" });
  });

  it("includes the checklist and a chosen status", async () => {
    render(<NewPersonPage />);
    await fillRequired();
    await choose("Employment status", "Active");
    await choose(/Onboarding checklist/, "Standard Onboarding (10 tasks)");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(createUser.mock.calls[0][0]).toMatchObject({ statusId: "s-act", templateId: "t-std" });
  });

  it("can go back to no checklist", async () => {
    render(<NewPersonPage />);
    await fillRequired();
    await choose(/Onboarding checklist/, "Standard Onboarding (10 tasks)");
    await choose(/Onboarding checklist/, "None");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(createUser.mock.calls[0][0]).not.toHaveProperty("templateId");
  });

  it("has a show/hide control on the password field", async () => {
    render(<NewPersonPage />);
    const pw = screen.getByLabelText("Password (optional)") as HTMLInputElement;
    expect(pw.type).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw.type).toBe("text");
  });

  it("keeps the submit button off until the required fields are in", () => {
    render(<NewPersonPage />);
    expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(document.body).getAllByRole("combobox").length).toBeGreaterThanOrEqual(5);
  });
});
