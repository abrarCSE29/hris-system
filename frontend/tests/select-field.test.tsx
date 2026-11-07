// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FilterSelect } from "@/components/filter-select";
import { SelectField } from "@/components/select-field";

// jsdom lacks a few browser APIs the popup uses.
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const OPTIONS = [
  { value: "BANGLADESH", label: "Bangladesh" },
  { value: "CYPRUS", label: "Cyprus" },
];

function Controlled({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="c">Country</label>
      <SelectField id="c" value={value} onValueChange={(v) => { setValue(v); onChange(v); }} options={OPTIONS} placeholder="Choose…" />
    </>
  );
}

describe("SelectField (shadcn Select)", () => {
  it("shows the placeholder when nothing is chosen", () => {
    render(<Controlled />);
    expect(screen.getByRole("combobox", { name: "Country" }).textContent).toContain("Choose…");
  });

  it("shows the chosen option's label, not its raw value", () => {
    render(<Controlled initial="CYPRUS" />);
    const trigger = screen.getByRole("combobox", { name: "Country" });
    expect(trigger.textContent).toContain("Cyprus");
    expect(trigger.textContent).not.toContain("CYPRUS");
  });

  it("opens, lists the options, and reports the choice", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Country" }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bangladesh", "Cyprus"]);
    await userEvent.click(within(list).getByRole("option", { name: "Cyprus" }));
    expect(onChange).toHaveBeenCalledWith("CYPRUS");
    expect(screen.getByRole("combobox", { name: "Country" }).textContent).toContain("Cyprus");
  });

  it("can be operated with the keyboard", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    screen.getByRole("combobox", { name: "Country" }).focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalled();
  });
});

describe("FilterSelect", () => {
  function Filter({ onChange = vi.fn(), initial = "" }: { onChange?: (v: string) => void; initial?: string }) {
    const [value, setValue] = useState(initial);
    return <FilterSelect label="All countries" value={value} onChange={(v) => { setValue(v); onChange(v); }} options={OPTIONS} />;
  }

  it("shows its label while no filter is set", () => {
    render(<Filter />);
    expect(screen.getByRole("combobox", { name: "All countries" }).textContent).toContain("All countries");
  });

  it("applies a filter, then clears it with the first option", async () => {
    const onChange = vi.fn();
    render(<Filter onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "All countries" }));
    await userEvent.click(await screen.findByRole("option", { name: "Cyprus" }));
    expect(onChange).toHaveBeenLastCalledWith("CYPRUS");

    await userEvent.click(screen.getByRole("combobox", { name: "All countries" }));
    await userEvent.click(await screen.findByRole("option", { name: "All countries" }));
    expect(onChange).toHaveBeenLastCalledWith(""); // "" = no filter, which is what the pages expect
  });
});
