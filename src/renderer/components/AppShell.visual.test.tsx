// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell, findNavItem, navItems } from "./AppShell";

afterEach(() => cleanup());

describe("AppShell navigation", () => {
  it("orders the rail Chat first and Worktrees second, pinning Settings to the footer", () => {
    const main = navItems.filter((item) => item.placement === "main");
    const footer = navItems.filter((item) => item.placement === "footer");

    expect(main.map((item) => item.to)).toEqual([
      "/chat",
      "/worktrees",
      "/intelligence",
      "/marketplace",
    ]);
    expect(footer.map((item) => item.to)).toEqual(["/settings"]);
  });

  it("resolves the page heading for every rail destination", () => {
    expect(findNavItem("/chat/worktree/run")?.label).toBe("Chat");
    expect(findNavItem("/worktrees")?.label).toBe("Worktrees");
    expect(findNavItem("/intelligence")?.label).toBe("Intelligence");
    expect(findNavItem("/marketplace")?.label).toBe("Marketplace");
    expect(findNavItem("/settings")?.label).toBe("Settings");
  });

  it("falls back to the chat label on an unmapped path", () => {
    expect(findNavItem("/unknown")).toBeUndefined();
  });
});

describe("AppShell visual language", () => {
  it("renders the product mark plus a consistent vector navigation icon set", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/chat" element={<div>Chat content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Main navigation",
    });

    expect(navigation.querySelectorAll("svg")).toHaveLength(4);
    expect(navigation.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Agentic Worktrees" })).toBeTruthy();
  });

  it("renders the chat landing as a full-bleed workspace without duplicate route chrome", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/chat" element={<div>Chat landing content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const workspace = screen.getByText("Chat landing content");
    const routeFrame = workspace.parentElement;
    const contentFrame = routeFrame?.parentElement;

    expect(screen.queryByRole("heading", { name: "Chat" })).toBeNull();
    expect(routeFrame?.classList.contains("h-full")).toBe(true);
    expect(contentFrame?.classList.contains("overflow-hidden")).toBe(true);
    expect(contentFrame?.classList.contains("p-6")).toBe(false);
  });

  it("keeps worktrees full-bleed and settings padded", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/settings" element={<div>Settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const workspace = screen.getByText("Settings content");
    const routeFrame = workspace.parentElement;
    const contentFrame = routeFrame?.parentElement;

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(contentFrame?.classList.contains("p-6")).toBe(true);
  });
});
