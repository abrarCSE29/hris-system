// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The people list shows names from the lookup tables and filters by their ids (spec docs/spec-lookup-tables.md). */
const META = {
  departments: [{ id: "d-eng", code: "ENG", name: "Engineering", headId: null }],
  requestCategories: [],
  roles: [{ id: "r-emp", code: "EMPLOYEE", name: "Employee" }, { id: "r-mgr", code: "MANAGER", name: "Manager" }, { id: "r-hr", code: "HR_ADMIN", name: "HR Admin" }],
  countries: [{ id: "c-cy", shortcode: "CY", name: "Cyprus" }, { id: "c-lk", shortcode: "LK", name: "Sri Lanka" }],
  userStatuses: [{ id: "s-act", code: "ACTIVE", name: "Active" }, { id: "s-prob", code: "ON_PROBATION", name: "On probation" }],
  enums: { requestPriorities: [], requestStatuses: [], ownerTypes: [], onboardingTaskStatuses: [] },
};
const USER = {
  id: "u1", employeeCode: "EMP-0001", fullName: "Ana Perera", email: "ana@hris.test", managerId: null, jobTitle: "Engineer", joiningDate: "2026-01-01",
  role: META.roles[0], country: META.countries[1], status: META.userStatuses[1], department: { id: "d-eng", code: "ENG", name: "Engineering" },
};

const useUsers = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/hooks/auth", () => ({ useMe: () => ({ data: { user: { role: { code: "HR_ADMIN" } } } }) }));
vi.mock("@/lib/hooks/users", () => ({
  useMeta: () => ({ data: META }),
  useUsers: (filters: unknown) => (useUsers(filters), { data: { data: [USER], total: 1, page: 1, pageSize: 20 }, isError: false, error: null }),
}));

import PeoplePage from "@/app/(app)/people/page";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  useUsers.mockClear();
});

describe("People list", () => {
  it("has no Add new hire button (adding a hire is done from the Onboarding page)", () => {
    render(<PeoplePage />);
    expect(screen.queryByRole("link", { name: /add new hire/i })).toBeNull();
    expect(screen.queryByText(/add new hire/i)).toBeNull();
  });

  it("shows the country and status by their names", () => {
    render(<PeoplePage />);
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText("Ana Perera"))!;
    expect(within(row).getByText("Sri Lanka")).toBeTruthy();
    expect(within(row).getByText("On probation")).toBeTruthy();
  });

  it("filters by the id of the chosen country and status, not by a code or a name", async () => {
    render(<PeoplePage />);
    await userEvent.click(screen.getByRole("combobox", { name: "All countries" }));
    await userEvent.click(await screen.findByRole("option", { name: "Cyprus" }));
    await userEvent.click(screen.getByRole("combobox", { name: "All statuses" }));
    await userEvent.click(await screen.findByRole("option", { name: "On probation" }));
    const last = useUsers.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ countryId: "c-cy", statusId: "s-prob" });
    expect(last).not.toHaveProperty("country");
    expect(last).not.toHaveProperty("status");
  });
});
