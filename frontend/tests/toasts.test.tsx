// @vitest-environment jsdom
import { useMutation } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { failureMessage, Providers } from "@/components/providers";
import { useChatDraft } from "@/lib/hooks/chat";
import { setServiceUnavailable } from "@/lib/service-status";
import { ApiClientError } from "@/lib/api";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
});
afterEach(cleanup);

type Meta = { success?: string | ((v: never, d: never) => string); failure?: (error: unknown) => string | undefined };
function Button({ fn, meta }: { fn: () => Promise<unknown>; meta?: Meta }) {
  const m = useMutation({ mutationFn: fn, meta });
  return <button onClick={() => m.mutate()}>go</button>;
}
const press = async (fn: () => Promise<unknown>, meta?: Meta) => {
  render(<Providers><Button fn={fn} meta={meta} /></Providers>);
  await userEvent.click(screen.getByRole("button", { name: "go" }));
};

describe("toasts (shadcn Sonner)", () => {
  it("announces a success with the text given in the mutation's meta", async () => {
    await press(async () => ({ reference: "SR-1042" }), { success: ((_v: never, d: { reference: string }) => `Request ${d.reference} submitted`) as never });
    expect(await screen.findByText("Request SR-1042 submitted")).toBeTruthy();
  });

  it("announces a failure with the server's message", async () => {
    await press(async () => { throw new ApiClientError(409, "INVALID_TRANSITION", "That request was already assigned"); });
    expect(await screen.findByText("That request was already assigned")).toBeTruthy();
  });

  it("points at the form when the failure carries field details", async () => {
    await press(async () => { throw new ApiClientError(422, "VALIDATION_FAILED", "Invalid", [{ path: "title", message: "Required" }]); });
    expect(await screen.findByText("Please check the highlighted fields.")).toBeTruthy();
    expect(screen.queryByText("Invalid")).toBeNull();
  });

  it("gives a plain message for an unexpected error", async () => {
    await press(async () => { throw new Error("boom"); });
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
  });

  it("stays quiet for an expired session (the person is being sent to sign in)", async () => {
    await press(async () => { throw new ApiClientError(401, "UNAUTHORIZED", "Authentication required"); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByText("Authentication required")).toBeNull();
  });

  it("uses the wording from meta.failure when it gives one, even for a 401 (wrong password)", async () => {
    const failure = (e: unknown) => (e instanceof ApiClientError && e.status === 401 ? "Incorrect email or password." : undefined);
    await press(async () => { throw new ApiClientError(401, "INVALID_CREDENTIALS", "Invalid email or password"); }, { failure });
    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
    cleanup();
    await press(async () => { throw new ApiClientError(500, "INTERNAL", "Internal server error"); }, { failure });
    expect(await screen.findByText("Internal server error")).toBeTruthy();
  });

  it("shows nothing for a success that has no text", async () => {
    // Sonner keeps its toasts in a module-wide store, so earlier tests' toasts are still around: count, don't expect none.
    const count = () => document.querySelectorAll("[data-sonner-toast]").length;
    render(<Providers><Button fn={async () => "ok"} /></Providers>);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); }); // let leftover toasts finish mounting
    const before = count();
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(count()).toBe(before);
  });
});

describe("failureMessage", () => {
  it("covers the three cases", () => {
    expect(failureMessage(new ApiClientError(403, "FORBIDDEN", "No access"))).toBe("No access");
    expect(failureMessage(new ApiClientError(422, "V", "x", [{ path: "a", message: "b" }]))).toBe("Please check the highlighted fields.");
    expect(failureMessage(new ApiClientError(500, "INTERNAL", "Internal server error", []))).toBe("Internal server error");
    expect(failureMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
});

describe("when the AI service is down", () => {
  function Draft() {
    const draft = useChatDraft();
    return <button onClick={() => draft.mutate({ message: "my laptop is hot", page: "/requests" })}>draft</button>;
  }
  const down = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));
  afterEach(() => {
    vi.unstubAllGlobals();
    setServiceUnavailable(false);
    toast.dismiss(); // toasts live in a module-level store, so one test's toast would show in the next test's render
  });

  it("says so in a toast and leaves the rest of the page alone", async () => {
    down(503, { error: { code: "AI_UNAVAILABLE", message: "The assistant can't draft right now. You can still fill in the form yourself.", requestId: "r-1" } });
    render(<Providers><p>the page</p><Draft /></Providers>);
    await userEvent.click(screen.getByRole("button", { name: "draft" }));
    expect(await screen.findByText(/The AI service is currently unavailable/)).toBeTruthy();
    expect(screen.queryByText("Service Unavailable")).toBeNull(); // no full-page "backend is down" window
    expect(screen.getByText("the page")).toBeTruthy();
  });

  it("still shows the backend-down window when the backend itself is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    render(<Providers><Draft /></Providers>);
    await userEvent.click(screen.getByRole("button", { name: "draft" }));
    expect(await screen.findByText("Service Unavailable")).toBeTruthy();
    expect(screen.queryByText(/AI service is currently unavailable/)).toBeNull(); // not blamed on the AI
  });

  it("keeps other draft failures on the server's own message", async () => {
    down(422, { error: { code: "VALIDATION_FAILED", message: "Message is too long" } });
    render(<Providers><Draft /></Providers>);
    await userEvent.click(screen.getByRole("button", { name: "draft" }));
    expect(await screen.findByText("Message is too long")).toBeTruthy();
    expect(screen.queryByText(/AI service is currently unavailable/)).toBeNull();
  });
});
