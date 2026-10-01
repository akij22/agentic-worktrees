// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChatView } from "../features/coding-agent/views/ChatView";
import { Marketplace } from "../pages/Marketplace";
import { AppShell } from "./AppShell";
import { findPageLabel } from "./AppNavigation";

vi.mock("../features/coding-agent/hooks/useCodingAgentSessions", () => ({
  useCodingAgentSessions: () => ({
    contexts: [], sessions: [], sessionDetails: new Map(), loading: false,
  }),
}));
vi.mock("../features/coding-agent/views/NewThreadView", () => ({
  NewThreadView: () => <div>Chat landing content</div>,
}));
vi.mock("../features/coding-agent/views/CodingAgentWorkspace", () => ({
  CodingAgentWorkspace: () => <div>Active thread content</div>,
}));

vi.mock("../features/marketplace/hooks/useMarketplace", () => ({
  useMarketplace: () => ({
    items: [], loading: false, query: "", filter: "all", isExactSpec: false,
    setQuery: vi.fn(), setFilter: vi.fn(), installSkill: vi.fn(),
  }),
}));

afterEach(() => cleanup());

const renderShell = (path = "/chat") => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ChatView />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/chat/worktree/run" element={<ChatView activeRunId="run" />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/settings" element={<div>Settings content</div>} />
        <Route path="/worktrees" element={<div>Worktrees content</div>} />
        <Route path="/intelligence" element={<div>Intelligence content</div>} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe("AppShell navigation", () => {
  it.each(["/", "/chat", "/chat/worktree/run"])(
    "uses the thread sidebar as the only sidebar on %s",
    (path) => {
      const { container } = renderShell(path);
      expect(container.querySelectorAll("aside")).toHaveLength(1);
      expect(screen.queryByRole("separator", { name: "Resize main navigation" })).toBeNull();
      expect(screen.getByRole("separator", { name: "Resize thread sidebar" })).toBeTruthy();
      const navigation = screen.getByRole("navigation", { name: "Main navigation" });
      expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual(["Threads", "Marketplace"]);
      expect(within(navigation).getByRole("link", { name: "Threads" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    },
  );

  it("switches to Marketplace and back with one sidebar and the correct active state", async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    await user.click(screen.getByRole("link", { name: "Marketplace" }));
    expect(screen.getByRole("region", { name: "Marketplace" })).toBeTruthy();
    expect(container.querySelectorAll("aside")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Marketplace" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Threads" }).getAttribute("aria-current")).toBeNull();
    await user.click(screen.getByRole("link", { name: "Threads" }));
    expect(screen.getByText("Chat landing content")).toBeTruthy();
    expect(container.querySelectorAll("aside")).toHaveLength(1);
  });

  it("keeps Settings and the secondary destinations accessible from the footer", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByText("Settings content")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.keyboard("{Enter}");
    expect(screen.getByText("Worktrees content")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Worktrees" }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Intelligence content")).toBeTruthy();
  });

  it("retains keyboard resizing for the thread sidebar", () => {
    renderShell();
    const separator = screen.getByRole("separator", { name: "Resize thread sidebar" });
    expect(separator.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("316");
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("300");
  });

  it("resolves headings for existing destinations", () => {
    expect(findPageLabel("/chat/worktree/run")).toBe("Threads");
    expect(findPageLabel("/worktrees")).toBe("Worktrees");
    expect(findPageLabel("/intelligence")).toBe("Intelligence");
    expect(findPageLabel("/marketplace")).toBe("Marketplace");
    expect(findPageLabel("/settings")).toBe("Settings");
    expect(findPageLabel("/unknown")).toBeUndefined();
  });
});

describe("AppShell page layout", () => {
  it("renders chat full-bleed without duplicate route chrome", () => {
    renderShell();
    expect(screen.queryByRole("heading", { name: "Threads", level: 1 })?.closest("main")?.querySelector("header")).toBeNull();
    const routeFrame = screen.getByText("Chat landing content").closest("main")?.firstElementChild;
    expect(routeFrame?.classList.contains("overflow-hidden")).toBe(true);
    expect(routeFrame?.classList.contains("p-6")).toBe(false);
  });

  it("keeps settings padded", () => {
    renderShell("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    const contentFrame = screen.getByText("Settings content").parentElement?.parentElement;
    expect(contentFrame?.classList.contains("p-6")).toBe(true);
  });
});
