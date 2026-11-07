// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/ui/password-input";

afterEach(cleanup);

describe("PasswordInput", () => {
  const field = () => screen.getByLabelText("Password") as HTMLInputElement;
  const toggle = () => screen.getByRole("button", { name: /password/i });
  const setup = () => render(<><label htmlFor="pw">Password</label><PasswordInput id="pw" defaultValue="s3cret!" autoComplete="current-password" /></>);

  it("hides the password by default", () => {
    setup();
    expect(field().type).toBe("password");
    expect(toggle().getAttribute("aria-label")).toBe("Show password");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("shows and hides it when the button is pressed, keeping what was typed", async () => {
    setup();
    await userEvent.click(toggle());
    expect(field().type).toBe("text");
    expect(field().value).toBe("s3cret!");
    expect(toggle().getAttribute("aria-label")).toBe("Hide password");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(toggle());
    expect(field().type).toBe("password");
    expect(field().value).toBe("s3cret!");
  });

  it("works from the keyboard", async () => {
    setup();
    await userEvent.tab(); // password field
    await userEvent.tab(); // the show/hide button
    expect(document.activeElement).toBe(toggle());
    await userEvent.keyboard("{Enter}");
    expect(field().type).toBe("text");
    await userEvent.keyboard(" ");
    expect(field().type).toBe("password");
  });

  it("never submits the surrounding form", async () => {
    let submitted = false;
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true; }}>
        <PasswordInput aria-label="pw" />
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(submitted).toBe(false);
  });

  it("keeps the autocomplete hint and other props", () => {
    setup();
    expect(field().getAttribute("autocomplete")).toBe("current-password");
  });

  it("decorative icons are hidden from assistive technology", () => {
    setup();
    expect(toggle().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
