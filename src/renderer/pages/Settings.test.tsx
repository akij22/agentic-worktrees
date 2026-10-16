// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentStatusDto } from "../../shared/ipc/schemas";
import { Settings } from "./Settings";

const auth = vi.hoisted(() => ({
  state: { status: { profile: { name: "Test Developer", login: "developer" } } },
  actionError: null,
  logout: vi.fn().mockResolvedValue(undefined),
  startLogin: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../features/auth/useGitHubAuth", () => ({ useGitHubAuth: () => auth }));

const agentStatus: CodingAgentStatusDto = {
  installations: [
    { kind: "opencode", name: "OpenCode", configured: true, executablePath: "/usr/local/bin/opencode", version: "1.0.0", running: true, error: null },
    { kind: "codex", name: "Codex", configured: false, executablePath: null, version: null, running: false, error: null },
  ],
};
const getStatus = vi.fn();
const selectExecutable = vi.fn();
const renderSettings = () => render(<MemoryRouter><Settings /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockResolvedValue(agentStatus);
  selectExecutable.mockResolvedValue(null);
  Object.defineProperty(window, "api", { configurable: true, value: { codingAgent: { getStatus, selectExecutable } } });
});
afterEach(() => cleanup());

describe("Settings", () => {
  it("groups accounts and coding agents under keyboard-accessible categories", async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.getAllByRole("heading", { name: "Settings" })).toHaveLength(1);
    expect(screen.getByText("Test Developer · @developer")).toBeTruthy();
    expect(screen.queryByText("OpenCode")).toBeNull();
    const categories = screen.getByRole("navigation", { name: "Settings categories" });
    const agents = within(categories).getByRole("button", { name: "Coding agents" });
    agents.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.getByText("/usr/local/bin/opencode")).toBeTruthy();
    expect(agents.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("GitHub account")).toBeNull();
  });

  it("selects the executable for the requested agent and updates its status", async () => {
    const user = userEvent.setup();
    selectExecutable.mockResolvedValue({ installations: [
      agentStatus.installations[0],
      { ...agentStatus.installations[1], configured: true, executablePath: "/opt/bin/codex", version: "2.0.0" },
    ] });
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Coding agents" }));
    await user.click(await screen.findByRole("button", { name: "Select executable for Codex" }));
    expect(selectExecutable).toHaveBeenCalledWith({ agentKind: "codex" });
    expect(await screen.findByText("/opt/bin/codex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change path for Codex" })).toBeTruthy();
  });

  it("shows selection failures next to the affected agent and allows retry", async () => {
    const user = userEvent.setup();
    selectExecutable.mockRejectedValueOnce(new Error("Executable could not be opened."));
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Coding agents" }));
    const action = await screen.findByRole("button", { name: "Change path for OpenCode" });
    await user.click(action);
    expect((await screen.findByRole("alert")).textContent).toContain("Executable could not be opened.");
    await user.click(action);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(selectExecutable).toHaveBeenCalledTimes(2);
  });

  it("keeps executable selection pending until the native dialog closes", async () => {
    const user = userEvent.setup();
    let resolveSelection: (value: null) => void = () => undefined;
    selectExecutable.mockImplementation(() => new Promise<null>((resolve) => { resolveSelection = resolve; }));
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Coding agents" }));
    await user.click(await screen.findByRole("button", { name: "Change path for OpenCode" }));
    expect(screen.getByRole("button", { name: "Change path for OpenCode" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Select executable for Codex" }).hasAttribute("disabled")).toBe(true);
    resolveSelection(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "Change path for OpenCode" }).hasAttribute("disabled")).toBe(false));
  });

  it("shows loading failures with a working retry", async () => {
    const user = userEvent.setup();
    getStatus.mockRejectedValueOnce(new Error("Agents are temporarily unavailable."));
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Coding agents" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Agents are temporarily unavailable.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("OpenCode")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("requires confirmation before disconnecting GitHub", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(auth.logout).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(auth.logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
  });
});
