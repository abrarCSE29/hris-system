// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers";
import { api } from "@/lib/api";
import { setServiceUnavailable } from "@/lib/service-status";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
});
afterEach(() => {
  cleanup();
  setServiceUnavailable(false);
  vi.unstubAllGlobals();
});

const reply = (status: number, body?: unknown) => new Response(body === undefined ? "Internal Server Error" : JSON.stringify(body), { status });

describe("backend unavailable", () => {
  it.each([
    ["network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["502 from the proxy", () => Promise.resolve(reply(502))],
    ["503", () => Promise.resolve(reply(503, { error: { code: "X", message: "x" } }))],
    ["504", () => Promise.resolve(reply(504))],
    ["500 that is not the backend's envelope", () => Promise.resolve(reply(500))],
  ])("shows the window on %s", async (_n, impl) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    render(<Providers><div /></Providers>);
    await expect(api("/requests")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(await screen.findByText("Service Unavailable")).toBeTruthy();
    expect(screen.getByText("Please try again later.")).toBeTruthy();
  });

  it("does not show it for the backend's own 500 error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(reply(500, { error: { code: "INTERNAL", message: "Internal server error" } }))));
    render(<Providers><div /></Providers>);
    await expect(api("/requests")).rejects.toMatchObject({ code: "INTERNAL" });
    expect(screen.queryByText("Service Unavailable")).toBeNull();
  });

  it("closes once Try again reaches the backend", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(reply(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Providers><div /></Providers>);
    await expect(api("/requests")).rejects.toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Service Unavailable")).toBeNull());
  });

  it("stays open if Try again still can't reach it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    render(<Providers><div /></Providers>);
    await expect(api("/requests")).rejects.toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("Service Unavailable")).toBeTruthy();
  });
});
