// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "@/components/requests/timeline";
import type { RequestEvent } from "@/lib/types";

afterEach(cleanup);

const ev = (id: string, from: string | null, to: string, extra: Partial<RequestEvent> = {}) =>
  ({ id, fromStatus: from, toStatus: to, actor: { id: "a", fullName: "Ana Perera" }, assignee: null, note: null, createdAt: "2026-11-02T08:00:00.000Z", ...extra }) as RequestEvent;

describe("Timeline", () => {
  const events = [
    ev("1", null, "SUBMITTED"),
    ev("2", "SUBMITTED", "ASSIGNED", { assignee: { id: "w", fullName: "Jun Hao Teoh" } }),
    ev("3", "ASSIGNED", "ASSIGNED", { assignee: { id: "x", fullName: "Daniel Nair" } }),
    ev("4", "ASSIGNED", "IN_PROGRESS", { note: "On it" }),
  ];

  it("lists every step in order with who did it, and the note", () => {
    render(<Timeline events={events} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".font-semibold")?.textContent)).toEqual([
      "Submitted",
      "Assigned to Jun Hao Teoh",
      "Reassigned to Daniel Nair",
      "In Progress",
    ]);
    expect(items[3].textContent).toContain("On it");
    expect(items[0].textContent).toContain("by Ana Perera");
  });

  it("draws a line between steps only: one fewer than the steps, none after the last", () => {
    const { container } = render(<Timeline events={events} />);
    expect(container.querySelectorAll("[data-slot=timeline-line]")).toHaveLength(events.length - 1);
    const last = screen.getAllByRole("listitem").at(-1)!;
    expect(last.querySelector("[data-slot=timeline-line]")).toBeNull();
  });

  it("marks only the latest step as current, and that dot is the red one", () => {
    render(<Timeline events={events} />);
    const items = screen.getAllByRole("listitem");
    expect(items.filter((li) => li.getAttribute("aria-current") === "step")).toEqual([items[3]]);
    expect(items[3].querySelector("[data-slot=timeline-dot]")?.className).toContain("bg-primary");
    expect(items[0].querySelector("[data-slot=timeline-dot]")?.className).not.toContain("bg-primary");
  });

  it("blinks only the latest dot, and not for people who prefer reduced motion", () => {
    render(<Timeline events={events} />);
    const dots = screen.getAllByRole("listitem").map((li) => li.querySelector("[data-slot=timeline-dot]")!.className);
    expect(dots.filter((c) => c.includes("animate-pulse"))).toHaveLength(1);
    expect(dots[3]).toContain("animate-pulse");
    expect(dots[3]).toContain("motion-reduce:animate-none");
  });

  it("stops blinking once the request is closed, but keeps blinking when only resolved", () => {
    const resolved = [...events, ev("5", "IN_PROGRESS", "RESOLVED")];
    const { unmount } = render(<Timeline events={resolved} />);
    expect(screen.getAllByRole("listitem").at(-1)!.querySelector("[data-slot=timeline-dot]")!.className).toContain("animate-pulse");
    unmount();
    render(<Timeline events={[...resolved, ev("6", "RESOLVED", "CLOSED")]} />);
    const dots = screen.getAllByRole("listitem").map((li) => li.querySelector("[data-slot=timeline-dot]")!.className);
    expect(dots.some((c) => c.includes("animate-pulse"))).toBe(false);
    expect(dots.at(-1)).toContain("bg-primary"); // still the red current step
  });

  it("handles a single step", () => {
    const { container } = render(<Timeline events={[ev("1", null, "SUBMITTED")]} />);
    expect(container.querySelectorAll("[data-slot=timeline-line]")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
