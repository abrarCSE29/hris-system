// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { HiresWaiting } from "@/components/dashboard/hires-waiting";
import type { DashboardSummary } from "@/lib/dashboard";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const hire = (id: string, fullName: string, title: string) => ({
  id,
  fullName,
  country: { id: "c-cy", shortcode: "CY", name: "Cyprus" },
  department: { id: "eng", name: "Engineering" },
  instanceId: `i-${id}`,
  openRequests: [{ id: `r-${id}`, reference: `SR-${id}`, title, status: "SUBMITTED" as const, priority: "HIGH" as const }],
});
const dept = (id: string, code: string, name: string) => ({ id, code, name });
const waiting: DashboardSummary["newHiresWaiting"] = [
  { department: dept("it", "ITOPS", "IT Operations"), count: 2, hires: [hire("1", "Ana Perera", "Laptop"), hire("2", "Ben Karim", "Headset")] },
  { department: dept("ops", "OPS", "Operations"), count: 0, hires: [] },
  { department: dept("hr", "PEOPLE", "People & Culture"), count: 1, hires: [hire("1", "Ana Perera", "Payslip query")] },
];

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const names = () => screen.queryAllByRole("link", { name: /Perera|Karim/ }).map((a) => a.textContent);
const choose = async (name: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
  await userEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name }));
};

describe("New hires waiting on …: department selector", () => {
  it("starts on IT Operations", () => {
    render(<HiresWaiting waiting={waiting} />);
    expect(heading()).toContain("New hires waiting on IT Operations");
    expect(heading()).toContain("(2)");
    expect(names()).toEqual(["Ana Perera", "Ben Karim"]);
    expect(screen.getByRole("combobox", { name: "Department" }).textContent).toContain("IT Operations");
  });

  it("offers every department that handles requests, with no 'all' option", async () => {
    render(<HiresWaiting waiting={waiting} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Department" }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["IT Operations", "Operations", "People & Culture"]);
  });

  it("switches the title, description, count and list to the chosen department", async () => {
    render(<HiresWaiting waiting={waiting} />);
    await choose("People & Culture");
    expect(heading()).toContain("New hires waiting on People & Culture");
    expect(heading()).toContain("(1)");
    expect(screen.getByText(/unresolved request with People & Culture/)).toBeTruthy();
    expect(names()).toEqual(["Ana Perera"]);
    expect(screen.getByText(/Payslip query/)).toBeTruthy();
    expect(screen.queryByText(/Laptop/)).toBeNull();
  });

  it("says so when nobody is waiting on the chosen department, and keeps the list area", async () => {
    render(<HiresWaiting waiting={waiting} />);
    await choose("Operations");
    expect(heading()).toContain("(0)");
    expect(screen.getByText(/No new hire is waiting on Operations/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "New hires waiting on Operations" }).className).toContain("h-80");
  });

  it("falls back to the first department if the chosen one disappears", async () => {
    const { rerender } = render(<HiresWaiting waiting={waiting} />);
    await choose("People & Culture");
    rerender(<HiresWaiting waiting={waiting.slice(0, 2)} />);
    expect(heading()).toContain("IT Operations");
  });
});
