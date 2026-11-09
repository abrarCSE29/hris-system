// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TaskActions } from "@/components/onboarding/task-actions";
import { ownerLabel } from "@/components/onboarding/task-list";
import type { OnboardingTask } from "@/lib/types";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IT = { id: "it", code: "ITOPS", name: "IT Operations" };
const task = (over: Partial<OnboardingTask> = {}) => ({
  id: "t1", ownerDepartment: IT, assignee: null, status: "NOT_STARTED" as const, allowedActions: ["start", "complete", "assign"] as OnboardingTask["allowedActions"], ...over,
});
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const people = { data: [
  { id: "u1", fullName: "Nadia Rahman", jobTitle: "Support Engineer" },
  { id: "u2", fullName: "Imran Khan", jobTitle: "SysAdmin" },
] };

function setup(t = task()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return json(url.startsWith("/api/v1/users/assignable") ? people : { assignee: { id: "u1", fullName: "Nadia Rahman" } });
  }));
  render(<QueryClientProvider client={new QueryClient()}><TaskActions task={t} /></QueryClientProvider>);
  return calls;
}

describe("task owner label", () => {
  it("names the assignee, or says nobody has it yet", () => {
    expect(ownerLabel({ ownerType: "DEPARTMENT", ownerDepartment: IT, assignee: null })).toBe("IT Operations · Not assigned yet");
    expect(ownerLabel({ ownerType: "DEPARTMENT", ownerDepartment: IT, assignee: { id: "u1", fullName: "Nadia Rahman" } })).toBe("IT Operations · Nadia Rahman");
    expect(ownerLabel({ ownerType: "MANAGER", ownerDepartment: null, assignee: { id: "m", fullName: "Sam" } })).toBe("Manager · Sam");
  });
});

describe("assigning a task", () => {
  it("offers Assign only when the server allows it", () => {
    setup(task({ allowedActions: ["start", "complete"] }));
    expect(screen.queryByRole("button", { name: /assign/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("offers nothing to someone with no actions", () => {
    setup(task({ allowedActions: [] }));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says Reassign when someone already has the task, and sends the chosen person to the server", async () => {
    const calls = setup(task({ assignee: { id: "u2", fullName: "Imran Khan" } }));
    await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Assign to" }));
    const list = await screen.findByRole("listbox");
    expect(within(list).queryByRole("option", { name: /Imran Khan/ })).toBeNull(); // not the current person
    await userEvent.click(within(list).getByRole("option", { name: /Nadia Rahman/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/onboarding/tasks/t1/assign")).toBe(true));
    const post = calls.find((c) => c.url === "/api/v1/onboarding/tasks/t1/assign")!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toEqual({ assigneeId: "u1" });
    expect(calls.find((c) => c.url.startsWith("/api/v1/users/assignable"))!.url).toContain("departmentId=it");
  });

  it("does not load the people list until Assign is opened", () => {
    const calls = setup();
    expect(calls.length).toBe(0);
  });
});
