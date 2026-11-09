// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api";
import { roleSentence, sharePercent, statusSentence, type DepartmentBreakdown } from "@/lib/departments";
import { navForRole } from "@/lib/nav";

let result: { isPending: boolean; isError: boolean; data?: DepartmentBreakdown; error?: unknown; refetch: () => void };
vi.mock("@/lib/hooks/departments", () => ({ useDepartmentBreakdown: () => result }));

import DepartmentsPage from "@/app/(app)/departments/page";

afterEach(cleanup);

const COUNTRIES = [
  { id: "c-bd", shortcode: "BD", name: "Bangladesh" },
  { id: "c-cy", shortcode: "CY", name: "Cyprus" },
  { id: "c-my", shortcode: "MY", name: "Malaysia" },
  { id: "c-lk", shortcode: "LK", name: "Sri Lanka" },
];
const STATUS = {
  ACTIVE: { id: "s-a", code: "ACTIVE" as const, name: "Active" },
  ON_PROBATION: { id: "s-p", code: "ON_PROBATION" as const, name: "On probation" },
  ON_NOTICE: { id: "s-n", code: "ON_NOTICE" as const, name: "On notice" },
};
const ROLE = {
  EMPLOYEE: { id: "r-e", code: "EMPLOYEE" as const, name: "Employee" },
  MANAGER: { id: "r-m", code: "MANAGER" as const, name: "Manager" },
  HR_ADMIN: { id: "r-h", code: "HR_ADMIN" as const, name: "HR Admin" },
};
const dept = (id: string, name: string, headcount: number, over: Partial<DepartmentBreakdown["departments"][number]> = {}) => ({
  id,
  code: name.slice(0, 3).toUpperCase(),
  name,
  head: { id: `h-${id}`, fullName: `${name} Head` },
  headcount,
  byCountry: COUNTRIES.map((country, i) => ({ country, count: i === 0 ? headcount : 0 })),
  byStatus: [
    { status: STATUS.ACTIVE, count: headcount },
    { status: STATUS.ON_PROBATION, count: 0 },
    { status: STATUS.ON_NOTICE, count: 0 },
  ],
  byRole: [
    { role: ROLE.EMPLOYEE, count: headcount },
    { role: ROLE.MANAGER, count: 0 },
    { role: ROLE.HR_ADMIN, count: 0 },
  ],
  ...over,
});

describe("departments helpers", () => {
  it("computes the share, safely for an empty company", () => {
    expect(sharePercent(1, 4)).toBe(25);
    expect(sharePercent(0, 0)).toBe(0);
  });
  it("describes only the non-default statuses and roles", () => {
    expect(statusSentence(dept("a", "Alpha", 3).byStatus)).toBe("—");
    expect(
      statusSentence([
        { status: STATUS.ACTIVE, count: 5 },
        { status: STATUS.ON_PROBATION, count: 2 },
        { status: STATUS.ON_NOTICE, count: 1 },
      ]),
    ).toBe("2 on probation · 1 on notice");
    expect(
      roleSentence([
        { role: ROLE.EMPLOYEE, count: 9 },
        { role: ROLE.MANAGER, count: 1 },
        { role: ROLE.HR_ADMIN, count: 2 },
      ]),
    ).toBe("1 manager · 2 HR admins");
  });
});

describe("Departments nav item", () => {
  it("is for HR Admin only", () => {
    expect(navForRole("HR_ADMIN").map((i) => i.href)).toContain("/departments");
    expect(navForRole("MANAGER").map((i) => i.href)).not.toContain("/departments");
    expect(navForRole("EMPLOYEE").map((i) => i.href)).not.toContain("/departments");
  });
});

describe("Departments page", () => {
  it("lists each department with its head, headcount, share and a link to its people, and a total row", () => {
    result = {
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: { total: 10, departments: [dept("a", "Alpha", 6), dept("b", "Beta", 4, { head: null })] },
    };
    render(<DepartmentsPage />);
    const rows = screen.getAllByRole("row");
    const alpha = rows.find((r) => within(r).queryByText("Alpha"))!;
    expect(within(alpha).getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/people?departmentId=a");
    expect(within(alpha).getByText("Head: Alpha Head")).toBeTruthy();
    expect(within(alpha).getByText("60%")).toBeTruthy();
    const beta = rows.find((r) => within(r).queryByText("Beta"))!;
    expect(within(beta).getByText("No head assigned")).toBeTruthy();
    const total = rows.find((r) => within(r).queryByText("All departments"))!;
    expect(within(total).getAllByRole("cell")[1].textContent).toBe("10");
  });

  it("shows a loading state, an error with retry, and a clear 403 message", () => {
    result = { isPending: true, isError: false, refetch: vi.fn() };
    const { unmount } = render(<DepartmentsPage />);
    expect(screen.queryByRole("table")).toBeNull();
    unmount();

    const refetch = vi.fn();
    result = { isPending: false, isError: true, error: new Error("boom"), refetch };
    const second = render(<DepartmentsPage />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load departments");
    second.unmount();

    result = { isPending: false, isError: true, error: new ApiClientError(403, "FORBIDDEN", "no"), refetch };
    render(<DepartmentsPage />);
    expect(screen.getByRole("alert").textContent).toContain("only available to HR Admins");
  });
});
