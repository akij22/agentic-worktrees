// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const select = vi.fn();
const setFilter = vi.fn();
const setQuery = vi.fn();
const installSkill = vi.fn();
let marketplaceError: string | undefined;
const capability = {
  id: "web",
  name: "Web Search",
  description: "Search",
  version: "1",
  category: "search",
  source: "npm",
  compatibility: { codex: "supported", opencode: "supported" },
  state: "ready",
  installationState: "available",
  trust: "official",
  packageName: "@agentic/web",
};
const skill = {
  id: "review",
  name: "Review",
  description: "Review code",
  version: "1",
  source: "local",
  compatibility: { codex: "supported", opencode: "supported" },
  installationState: "installed",
  automaticInvocation: true,
};

vi.mock("../features/marketplace/hooks/useMarketplace", () => ({
  useMarketplace: () => ({
    items: [
      { kind: "capability", capability },
      { kind: "skill", skill },
    ],
    selected: undefined,
    detail: undefined,
    loading: false,
    filter: "all",
    query: "",
    isExactSpec: false,
    error: marketplaceError,
    select,
    setFilter,
    setQuery,
    installSkill,
    refresh: vi.fn(),
    inspectPackage: vi.fn(),
  }),
}));

import { Marketplace } from "./Marketplace";
import { AppShell } from "../components/AppShell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  marketplaceError = undefined;
});

describe("Marketplace", () => {
  it("shows distinct item badges and exposes all filters", () => {
    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>,
    );
    expect(screen.getByText("capability")).toBeTruthy();
    expect(screen.getByText("skill")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(setFilter).toHaveBeenCalledWith("skill");
    expect(screen.getByRole("button", { name: "Installed" })).toBeTruthy();
  });

  it("imports a local Skill through the pathless API action", () => {
    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import local Skill" }));
    expect(installSkill).toHaveBeenCalled();
  });

  it("delegates Marketplace search input to the hook", () => {
    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>,
    );
    fireEvent.change(
      screen.getByLabelText("Search Official items or enter an npm package"),
      { target: { value: "missing" } },
    );
    expect(setQuery).toHaveBeenCalledWith("missing");
  });

  it("shows Marketplace errors without a retry action that only refreshes the list", () => {
    marketplaceError = "The package operation could not be completed.";
    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert").textContent).toContain("could not be completed");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("uses one populated sidebar and a full-height workspace inside the app shell", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/marketplace"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/marketplace" element={<Marketplace />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    const sidebar = screen.getByRole("complementary", { name: "Ecosystem index" });
    expect(within(sidebar).getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(within(sidebar).getByText("Web Search")).toBeTruthy();
    expect(within(sidebar).getByRole("group", { name: "Marketplace filters" })).toBeTruthy();
    expect(within(sidebar).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(sidebar.style.width).toBe("240px");
    expect(screen.getAllByRole("heading", { name: "Marketplace" })).toHaveLength(1);
    const workspace = screen.getByRole("region", { name: "Marketplace" });
    expect(workspace.parentElement?.parentElement?.classList.contains("p-6")).toBe(false);
  });
});
