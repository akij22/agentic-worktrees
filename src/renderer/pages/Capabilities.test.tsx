// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capabilities } from "./Capabilities";

const summary = { id: "agentic-worktrees.web-search", name: "Web Search", version: "0.1.0", description: "Search the web with Exa", category: "web-browser", compatibility: { codex: "supported", opencode: "supported" }, state: "available", secretConfigured: false } as const;
const detail = { ...summary, sdkVersion: "^0.1.0", author: { name: "Agentic Worktrees" }, license: "MIT", provenance: { kind: "manual-port", source: "pi-extension", package: "pi-web-access", sourceVersion: "0.25.0", repository: "https://github.com/nicobailon/pi-web-access" }, permissions: { network: ["mcp.exa.ai", "api.exa.ai"], secrets: ["exa-api-key"] }, settings: [], reviewStatus: "bundled-reviewed", providedTools: ["web_search"], permissionDigest: "digest" } as const;
afterEach(cleanup);

function installApi(state: "available" | "ready" = "available") {
  const contextualSummary = { ...summary, state };
  const contextualDetail = { ...detail, state };
  const activate = vi.fn().mockResolvedValue({ runId: "run-1", capabilityId: summary.id, name: summary.name, version: summary.version, state: "active" });
  Object.defineProperty(window, "api", { configurable: true, value: { capabilities: { list: vi.fn().mockResolvedValue([contextualSummary]), get: vi.fn().mockResolvedValue(contextualDetail), configure: vi.fn(), activate, deactivate: vi.fn(), onChanged: vi.fn(() => () => undefined) } } });
  return { activate };
}

describe("Capabilities library", () => {
  it("searches and opens reviewed capability details with compatibility", async () => {
    installApi();
    render(<MemoryRouter><Capabilities /></MemoryRouter>);
    expect(await screen.findByText("Web Search")).toBeTruthy();
    expect(await screen.findByText("Reviewed permissions")).toBeTruthy();
    expect(screen.getByText("Compatibility & provenance")).toBeTruthy();
    expect(screen.getByText(/Codex · Supported/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Search capabilities"), "missing");
    expect(screen.getAllByText("Web Search")).toHaveLength(1);
  });

  it("adds a ready capability to the originating chat context", async () => {
    const { activate } = installApi("ready");
    render(<MemoryRouter initialEntries={[{ pathname: "/capabilities", state: { runId: "run-1" } }]}><Capabilities /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Add to chat" }));
    expect(activate).toHaveBeenCalledWith({ runId: "run-1", capabilityId: summary.id });
  });
});
