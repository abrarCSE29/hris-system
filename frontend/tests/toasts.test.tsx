// @vitest-environment jsdom
import { useMutation } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { failureMessage, Providers } from "@/components/providers";
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
