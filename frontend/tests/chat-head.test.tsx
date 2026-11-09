// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api";
import type { ChatDraft, Meta, RequestSummary } from "@/lib/types";

const META = {
  departments: [
    { id: "d-it", code: "ITOPS", name: "IT Operations", headId: null },
    { id: "d-ops", code: "OPS", name: "Operations", headId: null },
    { id: "d-hr", code: "PEOPLE", name: "People & Culture", headId: null },
  ],
  requestCategories: [
    { id: "c-it", code: "IT_EQUIPMENT", name: "IT Equipment", handlingDepartmentId: "d-it" },
    { id: "c-fac", code: "FACILITIES", name: "Facilities", handlingDepartmentId: "d-ops" },
  ],
  enums: { requestPriorities: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
} as unknown as Meta;

const DRAFT: ChatDraft = {
  title: "Laptop overheating", description: "The laptop is getting very hot.", categoryId: "c-it", priority: "URGENT",
  departmentId: "d-it", confidence: 0.93, lowConfidence: false, reasoning: "Hardware fault with a possible safety risk.",
};

let pathname = "/people";
const draftMutate = vi.fn();
const draftReset = vi.fn();
const createMutate = vi.fn();
const createReset = vi.fn();
let draftState: { isPending: boolean; isError: boolean };
let historyState: { data: { data: RequestSummary[] } | undefined; isPending: boolean; isError: boolean };
const historyEnabled = vi.fn();
let createState: { isPending: boolean; error: unknown };

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/hooks/users", () => ({ useMeta: () => ({ data: META }) }));
vi.mock("@/lib/hooks/chat", () => ({
  useChatDraft: () => ({ mutate: draftMutate, reset: draftReset, ...draftState }),
  useChatRequests: (enabled: boolean) => {
    historyEnabled(enabled);
    return historyState;
  },
}));
vi.mock("@/lib/hooks/requests", () => ({ useCreateRequest: () => ({ mutate: createMutate, reset: createReset, ...createState }) }));

import { ChatHead } from "@/components/chat/chat-head";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
beforeEach(() => {
  pathname = "/people";
  draftState = { isPending: false, isError: false };
  historyState = { data: { data: [] }, isPending: false, isError: false };
  historyEnabled.mockReset();
  createState = { isPending: false, error: null };
  draftMutate.mockReset().mockImplementation((_body, opts) => opts?.onSuccess?.(DRAFT));
  createMutate.mockReset().mockImplementation((_body, opts) =>
    opts?.onSuccess?.({ id: "r-1", reference: "SR-1042", handlingDepartment: { name: "IT Operations" } }),
  );
  draftReset.mockReset();
  createReset.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async () => userEvent.click(screen.getByRole("button", { name: "Ask the request assistant" }));
const write = async (text: string) => userEvent.type(screen.getByLabelText("Your message"), text);
const draftIt = async (text = "my laptop is firing up") => {
  await open();
  await write(text);
  await userEvent.click(screen.getByRole("button", { name: "Draft my request" }));
};
const choose = async (label: string, option: string) => {
  // Inside a modal panel the browser lets the option list be clicked; jsdom marks the page "pointer-events: none", so skip that check.
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
  await user.click(screen.getByRole("combobox", { name: label }));
  // The option list opens in a portal outside the modal panel, which jsdom treats as hidden.
  const lists = await screen.findAllByRole("listbox", { hidden: true });
  await user.click(within(lists[lists.length - 1]).getByRole("option", { name: option, hidden: true }));
};

describe("Chat head", () => {
  it("is a button, and opens a panel that greets the person by first name", async () => {
    render(<ChatHead firstName="Nadia" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await open();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Hi Nadia, tell me what you need/)).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Request assistant" })).toBeTruthy();
  });

  it("cannot send an empty or blank message, and counts characters", async () => {
    render(<ChatHead firstName="Nadia" />);
    await open();
    const send = screen.getByRole("button", { name: "Draft my request" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await write("   ");
    expect(send.disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText("Your message"));
    await write("hello");
    expect(send.disabled).toBe(false);
    expect(screen.getByText("5/1000")).toBeTruthy();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).maxLength).toBe(1000);
  });

  it("sends the trimmed message and the page it was opened on", async () => {
    pathname = "/requests";
    render(<ChatHead firstName="Nadia" />);
    await draftIt("  my laptop is firing up  ");
    expect(draftMutate).toHaveBeenCalledOnce();
    expect(draftMutate.mock.calls[0][0]).toEqual({ message: "my laptop is firing up", page: "/requests" });
  });

  it("is disabled while the assistant is working, and says it is waking up after 3 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    draftState = { isPending: true, isError: false };
    render(<ChatHead firstName="Nadia" />);
    await open();
    expect((screen.getByRole("button", { name: "Drafting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByText("Waking up the assistant…")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByText("Waking up the assistant…")).toBeTruthy();
  });
});

describe("The draft card", () => {
  it("shows every field filled in, each marked AI suggested, and no reasoning", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    const card = screen.getByRole("form", { name: "Draft request" });
    expect((within(card).getByLabelText("Title") as HTMLInputElement).value).toBe("Laptop overheating");
    expect((within(card).getByLabelText("Description") as HTMLTextAreaElement).value).toBe("The laptop is getting very hot.");
    expect(within(card).getByRole("combobox", { name: "Category" }).textContent).toContain("IT Equipment");
    expect(within(card).getByRole("combobox", { name: "Priority" }).textContent).toContain("Urgent");
    expect(within(card).getByRole("combobox", { name: "Department" }).textContent).toContain("IT Operations");
    expect(within(card).getAllByText("AI suggested")).toHaveLength(5);
    expect(screen.queryByText("Hardware fault with a possible safety risk.")).toBeNull();
    expect(screen.queryByText(/I'm not sure about this/)).toBeNull();
    expect(screen.getByText("my laptop is firing up")).toBeTruthy(); // their own message, for context
  });

  it("warns when the assistant is not confident", async () => {
    draftMutate.mockImplementation((_b, opts) => opts?.onSuccess?.({ ...DRAFT, lowConfidence: true, confidence: 0.2 }));
    render(<ChatHead firstName="Nadia" />);
    await draftIt("it's broken");
    expect(screen.getByRole("status", { name: "" }) ?? true).toBeTruthy();
    expect(screen.getByText("I'm not sure about this, please check it.")).toBeTruthy();
  });

  it("lets the person edit the text fields; the badge goes away for a field they changed", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    const card = screen.getByRole("form", { name: "Draft request" });
    await userEvent.type(within(card).getByLabelText("Title"), " (Dell XPS)");
    expect((within(card).getByLabelText("Title") as HTMLInputElement).value).toBe("Laptop overheating (Dell XPS)");
    expect(within(card).getAllByText("AI suggested")).toHaveLength(4);
    await userEvent.type(within(card).getByLabelText("Description"), " It smells of plastic.");
    expect(within(card).getAllByText("AI suggested")).toHaveLength(3);
  });

  it("changing the category also sets the department to that category's, which can then be changed by hand", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await choose("Category", "Facilities");
    const card = screen.getByRole("form", { name: "Draft request" });
    expect(within(card).getByRole("combobox", { name: "Department" }).textContent).toContain("Operations");
    expect(within(card).getAllByText("AI suggested")).toHaveLength(3); // category and department are now the person's
    await choose("Department", "People & Culture");
    expect(within(card).getByRole("combobox", { name: "Category" }).textContent).toContain("Facilities");
    expect(within(card).getByRole("combobox", { name: "Department" }).textContent).toContain("People & Culture");
  });

  it("can change the priority", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await choose("Priority", "Low");
    expect(screen.getByRole("combobox", { name: "Priority" }).textContent).toContain("Low");
  });

  it("will not submit without a title or a description", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    const card = screen.getByRole("form", { name: "Draft request" });
    await userEvent.clear(within(card).getByLabelText("Title"));
    expect((within(card).getByRole("button", { name: "Submit request" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Submitting", () => {
  it("sends exactly the values on the card, including the department", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    const card = screen.getByRole("form", { name: "Draft request" });
    await userEvent.clear(within(card).getByLabelText("Title"));
    await userEvent.type(within(card).getByLabelText("Title"), "  Laptop too hot  ");
    await choose("Category", "Facilities");
    await choose("Priority", "High");
    await userEvent.click(within(card).getByRole("button", { name: "Submit request" }));
    expect(createMutate).toHaveBeenCalledOnce();
    expect(createMutate.mock.calls[0][0]).toEqual({
      categoryId: "c-fac", title: "Laptop too hot", description: "The laptop is getting very hot.", priority: "HIGH", handlingDepartmentId: "d-ops", channel: "CHAT",
    });
  });

  it("sends an unedited draft as the assistant filled it", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(createMutate.mock.calls[0][0]).toEqual({
      categoryId: "c-it", title: "Laptop overheating", description: "The laptop is getting very hot.", priority: "URGENT", handlingDepartmentId: "d-it", channel: "CHAT",
    });
  });

  it("confirms with the reference and a link to the request, then can start again", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(screen.getByText("SR-1042")).toBeTruthy();
    expect(screen.getByText(/was sent to IT Operations/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View request" }).getAttribute("href")).toBe("/requests/r-1");
    expect(screen.queryByRole("form", { name: "Draft request" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Raise another" }));
    expect(screen.getByLabelText("Your message")).toBeTruthy();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the server's field problems beside the fields", async () => {
    createState = {
      isPending: false,
      error: new ApiClientError(422, "VALIDATION_FAILED", "Validation failed", [
        { path: "title", message: "Too long" },
        { path: "handlingDepartmentId", message: "Department not found" },
      ]),
    };
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    expect(screen.getByText("Too long")).toBeTruthy();
    expect(screen.getByText("Department not found")).toBeTruthy();
  });

  it("start over clears the card and the message", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByRole("form", { name: "Draft request" })).toBeNull();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("");
    expect(draftReset).toHaveBeenCalled();
  });
});

describe("When the assistant is down", () => {
  it("points to the normal form and keeps what the person typed", async () => {
    draftState = { isPending: false, isError: true };
    draftMutate.mockImplementation(() => {});
    render(<ChatHead firstName="Nadia" />);
    await open();
    await write("my laptop is firing up");
    expect(screen.getByText(/The assistant isn't available right now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fill it in yourself" }).getAttribute("href")).toBe("/requests/new");
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("my laptop is firing up");
  });

  it("always offers the form, quietly, when everything is fine", async () => {
    render(<ChatHead firstName="Nadia" />);
    await open();
    expect(screen.getByRole("link", { name: "Fill it in yourself" })).toBeTruthy();
    expect(screen.queryByText(/isn't available/)).toBeNull();
  });
});

describe("Keeping the draft", () => {
  it("is still there after the panel is closed and opened again", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await userEvent.type(screen.getByLabelText("Title"), " edited");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await open();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Laptop overheating edited");
  });

  it("keeps an unsent message when the panel is closed and opened again", async () => {
    render(<ChatHead firstName="Nadia" />);
    await open();
    await write("half a thought");
    await userEvent.keyboard("{Escape}");
    await open();
    expect((screen.getByLabelText("Your message") as HTMLTextAreaElement).value).toBe("half a thought");
  });
});


const past = (over: Partial<RequestSummary>): RequestSummary =>
  ({
    id: "r-x", reference: "SR-1", title: "A request", priority: "MEDIUM", status: "SUBMITTED", channel: "CHAT",
    createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z",
    category: { id: "c-it", code: "IT_EQUIPMENT", name: "IT Equipment" }, handlingDepartment: { id: "d-it", code: "ITOPS", name: "IT Operations" },
    requester: { id: "u", fullName: "Nadia", country: "MALAYSIA" }, assignee: null, ...over,
  }) as RequestSummary;

describe("Earlier requests in the thread", () => {
  it("shows each as a pair of bubbles, oldest first, newest nearest the message box", async () => {
    // the API returns newest first
    historyState.data = {
      data: [
        past({ id: "r-3", reference: "SR-1003", title: "Third, the newest", status: "IN_PROGRESS", priority: "HIGH" }),
        past({ id: "r-2", reference: "SR-1002", title: "Second request" }),
        past({ id: "r-1", reference: "SR-1001", title: "First, the oldest", status: "RESOLVED", handlingDepartment: { id: "d-hr", code: "PEOPLE", name: "People & Culture" } }),
      ],
    };
    render(<ChatHead firstName="Nadia" />);
    await open();
    const section = screen.getByRole("region", { name: "Your earlier requests" });
    const mine = [...section.querySelectorAll('[data-from="you"]')].map((n) => n.textContent);
    expect(mine).toEqual(["First, the oldest", "Second request", "Third, the newest"]);
    const replies = [...section.querySelectorAll('[data-from="assistant"]')].map((n) => n.textContent ?? "");
    expect(replies[0]).toContain("SR-1001");
    expect(replies[0]).toContain("was sent to People & Culture");
    expect(replies[2]).toContain("SR-1003");
  });

  it("shows the live status and priority and links to the request", async () => {
    historyState.data = { data: [past({ id: "r-9", reference: "SR-1009", status: "IN_PROGRESS", priority: "URGENT" })] };
    render(<ChatHead firstName="Nadia" />);
    await open();
    const section = screen.getByRole("region", { name: "Your earlier requests" });
    expect(within(section).getByRole("link", { name: "SR-1009" }).getAttribute("href")).toBe("/requests/r-9");
    expect(within(section).getByText("In progress")).toBeTruthy();
    expect(within(section).getByText("Urgent")).toBeTruthy();
  });

  it("starts the thread with the greeting, before the earlier requests", async () => {
    historyState.data = { data: [past({ title: "Earlier" })] };
    render(<ChatHead firstName="Nadia" />);
    await open();
    const log = screen.getByRole("log", { name: "Conversation" });
    const bubbles = [...log.querySelectorAll("[data-from]")].map((n) => n.textContent ?? "");
    expect(bubbles[0]).toContain("Hi Nadia, tell me what you need");
    expect(bubbles[1]).toBe("Earlier");
  });

  it("loads the list only when the panel is open", async () => {
    render(<ChatHead firstName="Nadia" />);
    expect(historyEnabled).toHaveBeenLastCalledWith(false);
    await open();
    expect(historyEnabled).toHaveBeenLastCalledWith(true);
  });

  it("shows a placeholder while loading, a quiet message when it fails, and nothing extra when there are none", async () => {
    historyState = { data: undefined, isPending: true, isError: false };
    const first = render(<ChatHead firstName="Nadia" />);
    await open();
    expect(screen.getByLabelText("Loading your earlier requests")).toBeTruthy();
    first.unmount();

    historyState = { data: undefined, isPending: false, isError: true };
    const second = render(<ChatHead firstName="Nadia" />);
    await open();
    expect(screen.getByText("Couldn't load your earlier requests.")).toBeTruthy();
    // the rest of the chat still works
    expect(screen.getByLabelText("Your message")).toBeTruthy();
    second.unmount();

    historyState = { data: { data: [] }, isPending: false, isError: false };
    render(<ChatHead firstName="Nadia" />);
    await open();
    expect(screen.queryByRole("region", { name: "Your earlier requests" })).toBeNull();
    expect(screen.getByText(/Hi Nadia/)).toBeTruthy();
  });

  it("puts the new draft after the earlier requests, and the message box stays at the bottom while composing", async () => {
    historyState.data = { data: [past({ title: "Earlier one" })] };
    render(<ChatHead firstName="Nadia" />);
    await open();
    expect(screen.getByLabelText("Your message")).toBeTruthy();
    await write("my laptop is firing up");
    await userEvent.click(screen.getByRole("button", { name: "Draft my request" }));
    const log = screen.getByRole("log", { name: "Conversation" });
    const order = [...log.querySelectorAll("[data-from]")].map((n) => n.textContent ?? "");
    expect(order.findIndex((t) => t === "Earlier one")).toBeLessThan(order.findIndex((t) => t === "my laptop is firing up"));
    expect(screen.queryByLabelText("Your message")).toBeNull(); // the draft replaces the composer
  });

  it("shows a just-submitted request once, as the current turn, even after the list has refreshed to include it", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt("my laptop is firing up");
    // The list refetches after a submit and now contains the new request.
    historyState.data = { data: [past({ id: "r-1", reference: "SR-1042", title: "Laptop overheating" })] };
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(screen.getAllByText("SR-1042")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Your earlier requests" })).toBeNull();
    expect(screen.getByText("my laptop is firing up")).toBeTruthy();
    expect(screen.getByText(/was sent to IT Operations/)).toBeTruthy();
  });

  it("sends the request as a chat request so it joins the thread next time", async () => {
    render(<ChatHead firstName="Nadia" />);
    await draftIt();
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(createMutate.mock.calls[0][0].channel).toBe("CHAT");
  });
});
