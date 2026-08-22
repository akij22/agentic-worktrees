// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickerMenu, type PickerOption } from "./PickerMenu";

const options: PickerOption[] = [
  { id: "a", label: "Claude Sonnet", hint: "Anthropic" },
  { id: "b", label: "GPT-5", hint: "OpenAI" },
];

const InteractivePicker = ({
  onChange = () => undefined,
}: {
  onChange?: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("a");
  return (
    <PickerMenu
      ariaLabel="AI model"
      open={open}
      onOpenChange={setOpen}
      options={options}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      searchable
    />
  );
};

afterEach(() => cleanup());

describe("PickerMenu", () => {
  it("opens a filterable listbox from the trigger pill", () => {
    render(<InteractivePicker />);
    const trigger = screen.getByRole("button", { name: "AI model" });

    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "AI model" });
    expect(listbox).toBeTruthy();
    expect(screen.getByRole("searchbox")).toBeTruthy();
    expect(within(listbox).getByText("Claude Sonnet")).toBeTruthy();
    expect(within(listbox).getByText("GPT-5")).toBeTruthy();
  });

  it("filters options from the search field", () => {
    render(<InteractivePicker />);
    fireEvent.click(screen.getByRole("button", { name: "AI model" }));
    const listbox = screen.getByRole("listbox", { name: "AI model" });

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "gpt" },
    });

    expect(within(listbox).getByText("GPT-5")).toBeTruthy();
    expect(within(listbox).queryByText("Claude Sonnet")).toBeNull();
  });

  it("selects an option with the mouse and closes the menu", () => {
    const onChange = vi.fn();
    render(<InteractivePicker onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "AI model" }));

    fireEvent.click(screen.getByRole("option", { name: /GPT-5/ }));

    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects the highlighted option with the keyboard", () => {
    const onChange = vi.fn();
    render(<InteractivePicker onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "AI model" }));
    const listbox = screen.getByRole("listbox");

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without changing the selection", () => {
    const onChange = vi.fn();
    render(<InteractivePicker onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "AI model" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
