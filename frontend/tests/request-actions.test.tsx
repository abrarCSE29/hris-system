// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestAction, RequestDetail, RequestStatus } from "@/lib/types";

const mutate = vi.fn();
vi.mock("@/lib/hooks/requests", () => ({ useTransition: () => ({ mutate, isPending: false, error: null }) }));
vi.mock("@/lib/hooks/users", () => ({
  useAssignable: () => ({
    isPending: false,
    data: {
      data: [
        { id: "jun", employeeCode: "E1", fullName: "Jun Hao Teoh", jobTitle: "Support" },
        { id: "daniel", employeeCode: "E2", fullName: "Daniel Nair", jobTitle: "Network Engineer" },
      ],
    },
  }),
}));

import { RequestActions } from "@/components/requests/actions";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  mutate.mockClear();
});

const request = (status: RequestStatus, allowedActions: RequestAction[]) =>
  ({ id: "r1", status, allowedActions, assignee: status === "SUBMITTED" ? null : { id: "jun", fullName: "Jun Hao Teoh" }, handlingDepartment: { id: "it", code: "ITOPS", name: "IT Operations" } }) as unknown as RequestDetail;

describe("Request actions: assigning and reassigning", () => {
  it("offers Assign on a new request and Reassign on an assigned one", () => {
    render(<RequestActions request={request("SUBMITTED", ["assign"])} />);
    expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy();
    cleanup();
    render(<RequestActions request={request("ASSIGNED", ["assign"])} />);
    expect(screen.getByRole("button", { name: "Reassign" })).toBeTruthy();
  });

  it("offers Reassign on a request that is already in progress", () => {
    render(<RequestActions request={request("IN_PROGRESS", ["assign"])} />);
    expect(screen.getByRole("button", { name: "Reassign" })).toBeTruthy();
  });

  it("leaves the person already working on it out of the choices, and sends the chosen person", async () => {
    render(<RequestActions request={request("IN_PROGRESS", ["assign"])} />);
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.click(screen.getByRole("combobox", { name: /assign to/i }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Daniel Nair · Network Engineer"]);
    await userEvent.click(within(list).getByRole("option", { name: /Daniel Nair/ }));
    await userEvent.click(screen.getByRole("button", { name: "Reassign request" }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toEqual({ action: "assign", assigneeId: "daniel" });
  });

  it("still lists everyone when reassigning a request that has not been started", async () => {
    render(<RequestActions request={request("ASSIGNED", ["assign"])} />);
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.click(screen.getByRole("combobox", { name: /assign to/i }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(2);
  });
});
