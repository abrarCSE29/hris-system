// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, Role } from "@/lib/types";

const logout = vi.fn();
let me: MeResponse | undefined;
let pathname = "/dashboard";

vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/auth", () => ({
  useMe: () => ({ data: me }),
  useLogout: () => ({ mutate: logout }),
}));

import AppLayout from "@/app/(app)/layout";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
});
beforeEach(() => logout.mockClear());
afterEach(cleanup);

const asUser = (role: Role, isNewHire = false): MeResponse => ({
  user: {
    id: "u1", employeeCode: "EMP-0001", fullName: "Ana Perera", email: "ana@hris.test", role, country: "CYPRUS",
    department: { id: "d1", code: "ENG", name: "Engineering" }, managerId: null, jobTitle: "Engineer", status: "ACTIVE", joiningDate: "2026-01-01",
  },
  isNewHire,
  headOfDepartmentId: null,
});

const links = () => within(screen.getByRole("list", { name: "Main" })).getAllByRole("link").map((a) => a.textContent);

describe("app shell (shadcn Sidebar)", () => {
  it("shows an HR Admin every management page", () => {
    me = asUser("HR_ADMIN");
    render(<AppLayout><p>page body</p></AppLayout>);
    expect(links()).toEqual(["Dashboard", "Requests", "People", "Onboarding", "Task queue", "Templates"]);
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("shows an Employee only what they can use, plus My onboarding while onboarding", () => {
    me = asUser("EMPLOYEE");
    const { unmount } = render(<AppLayout>x</AppLayout>);
    expect(links()).toEqual(["Requests", "Task queue"]);
    unmount();
    me = asUser("EMPLOYEE", true);
    render(<AppLayout>x</AppLayout>);
    expect(links()).toEqual(["Requests", "My onboarding", "Task queue"]);
  });

  it("marks only the current page", () => {
    me = asUser("HR_ADMIN");
    pathname = "/onboarding/tasks";
    render(<AppLayout>x</AppLayout>);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Task queue"]);
    pathname = "/dashboard";
  });

  it("gives only the selected item a red side bar, with no rounded corners", () => {
    me = asUser("HR_ADMIN");
    pathname = "/requests";
    render(<AppLayout>x</AppLayout>);
    const nav = within(screen.getByRole("list", { name: "Main" })).getAllByRole("link");
    expect(nav.filter((a) => a.hasAttribute("data-active")).map((a) => a.textContent)).toEqual(["Requests"]);

    for (const a of nav) {
      // The selected-state styles are keyed on data-active, so only the selected link picks them up.
      expect(a.className).toContain("rounded-l-none"); // square left edge for every item
      expect(a.className).toContain("data-active:before:bg-primary"); // the red bar
      expect(a.className).toContain("data-active:before:left-0"); // on the left edge
      expect(a.className).not.toContain("2px"); // no custom 2px radius anywhere on the item
    }
    pathname = "/dashboard";
  });

  it("does not change the selected item's font weight", () => {
    me = asUser("HR_ADMIN");
    pathname = "/requests";
    render(<AppLayout>x</AppLayout>);
    for (const a of within(screen.getByRole("list", { name: "Main" })).getAllByRole("link")) {
      // The stock sidebar's `data-active:font-medium` must be overridden, not merely added to.
      expect(a.className).toContain("data-active:font-normal");
      expect(a.className).not.toContain("data-active:font-medium");
    }
    pathname = "/dashboard";
  });

  it("shows who is signed in and signs out", async () => {
    me = asUser("MANAGER");
    render(<AppLayout>x</AppLayout>);
    expect(screen.getByText("Ana Perera")).toBeTruthy();
    expect(screen.getByText("Manager · Engineering")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("renders a skeleton, not the app, until the session is known", () => {
    me = undefined;
    render(<AppLayout><p>secret page</p></AppLayout>);
    expect(screen.queryByText("secret page")).toBeNull();
    expect(screen.queryByRole("list", { name: "Main" })).toBeNull();
  });
});
