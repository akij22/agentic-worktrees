// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";

afterEach(() => cleanup());

describe("AppShell visual language", () => {
  it("renders the product mark plus a consistent vector navigation icon set", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Dashboard content</div>} />
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

  it("renders capabilities as a full-bleed workspace without duplicate route chrome", () => {
    render(
      <MemoryRouter initialEntries={["/capabilities"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/capabilities"
              element={<div>Capabilities workspace content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const workspace = screen.getByText("Capabilities workspace content");
    const routeFrame = workspace.parentElement;
    const contentFrame = routeFrame?.parentElement;

    expect(screen.queryByRole("heading", { name: "Capabilities" })).toBeNull();
    expect(routeFrame?.classList.contains("h-full")).toBe(true);
    expect(contentFrame?.classList.contains("overflow-hidden")).toBe(true);
    expect(contentFrame?.classList.contains("p-6")).toBe(false);
  });
});
