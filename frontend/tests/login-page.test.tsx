// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api";

const mutate = vi.fn();
let loginState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/auth", () => ({
  useMe: () => ({ data: undefined }),
  useLogin: () => ({ mutate, ...loginState }),
}));

import LoginPage from "@/app/(auth)/login/page";

beforeEach(() => {
  mutate.mockClear();
  loginState = { isPending: false, error: null };
});
afterEach(cleanup);

const card = () => document.querySelector('[data-slot="card"]') as HTMLElement;

describe("Sign-in page", () => {
  it("puts the whole sign-in form inside one card", () => {
    render(<LoginPage />);
    expect(card()).toBeTruthy();
    const inCard = within(card());
    expect(inCard.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(inCard.getByText("Use your work email and password.")).toBeTruthy();
    expect(inCard.getByLabelText("Email")).toBeTruthy();
    expect(inCard.getByLabelText("Password")).toBeTruthy();
    expect(inCard.getByRole("button", { name: "Show password" })).toBeTruthy();
    expect(inCard.getByRole("button", { name: "Sign in" })).toBeTruthy();
    // And the form itself is inside the card, not around it.
    expect(card().querySelector("form")).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(1);
  });

  it("shows no error in the card for any failure: they are toasts", () => {
    for (const error of [
      new ApiClientError(401, "UNAUTHORIZED", "Invalid email or password"),
      new ApiClientError(422, "VALIDATION_FAILED", "Enter a valid email"),
      new ApiClientError(500, "INTERNAL", "Internal server error"),
      new TypeError("Failed to fetch"),
    ]) {
      loginState = { isPending: false, error };
      const { unmount } = render(<LoginPage />);
      expect(within(card()).queryByRole("alert")).toBeNull();
      expect(card().textContent).not.toMatch(/Incorrect|Invalid|valid email|Internal|wrong/i);
      unmount();
    }
  });

  it("has no request assistant: it belongs to the signed-in app only", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("button", { name: "Ask the request assistant" })).toBeNull();
  });

  it("offers a show/hide control that reveals the typed password", async () => {
    render(<LoginPage />);
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    await userEvent.type(pw, "hunter2-hunter2");
    expect(pw.type).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw.type).toBe("text");
    expect(pw.value).toBe("hunter2-hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(pw.type).toBe("password");
  });

  it("submits the entered credentials, also with the password visible", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pass-pass-pass");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith({ email: "ana@example.com", password: "pass-pass-pass" });
  });

  it("pressing Enter in the password field submits", async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pass-pass-pass{Enter}");
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("disables the button while signing in", () => {
    loginState = { isPending: true, error: null };
    render(<LoginPage />);
    const btn = screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
