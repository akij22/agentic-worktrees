// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "./dropdown-menu";

afterEach(cleanup);

const items = [
  { id: "vscode", label: "Visual Studio Code" },
  { id: "zed", label: "Zed" },
  { id: "sublime-text", label: "Sublime Text" },
  { id: "android-studio", label: "Android Studio" },
];

const setup = () => {
  const onSelect = vi.fn();
  const { container } = render(
    <div style={{ overflow: "hidden", height: 32 }}>
      <DropdownMenu label="Open in editor" items={items} onSelect={onSelect} />
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Open in editor" });
  fireEvent.click(trigger);
  return { container, trigger, onSelect };
};

describe("DropdownMenu", () => {
  it("renders every editor outside the clipping header without replacing the trigger", () => {
    const { container, trigger, onSelect } = setup();
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(menu.classList.contains("fixed")).toBe(true);
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Visual Studio Code" }),
    );
    expect(trigger.textContent).toBe("Open in editor");
    fireEvent.click(screen.getByRole("menuitem", { name: "Android Studio" }));
    expect(onSelect).toHaveBeenCalledWith("android-studio");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports keyboard navigation and Escape", () => {
    const { trigger } = setup();
    fireEvent.keyDown(
      screen.getByRole("menuitem", { name: "Visual Studio Code" }),
      { key: "ArrowDown" },
    );
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Zed" }),
    );
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Zed" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on an outside click", () => {
    setup();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
