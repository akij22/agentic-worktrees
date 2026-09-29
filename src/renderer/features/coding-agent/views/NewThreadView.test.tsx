// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CodingAgentInstallationStatusDto } from "../../../../shared/ipc/schemas";
import { NewThreadView } from "./NewThreadView";

const context = {
  repository: {
    id: "repo-a",
    githubRepoId: 1,
    ownerLogin: "owner",
    name: "agentic-worktrees",
    fullName: "owner/agentic-worktrees",
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: "/Users/example/agentic-worktrees",
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: "wt-1",
    repositoryId: "repo-a",
    name: "codex-ui",
    path: "/Users/example/agentic-worktrees/.worktrees/codex-ui",
    branchName: "feat/codex-ui",
    kind: "linked" as const,
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready" as const,
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
};

const installation: CodingAgentInstallationStatusDto = {
  kind: "opencode",
  name: "OpenCode",
  configured: true,
  version: "1.0.0",
  executablePath: "/usr/local/bin/opencode",
  running: true,
  error: null,
};

const createSession = vi.fn();
const listWorktree = vi.fn();
const listCapabilities = vi.fn();
const capabilityChanged = vi.fn();
const locationProbe = vi.fn();

const LocationProbe = () => {
  locationProbe(useLocation().pathname);
  return null;
};

const renderLanding = (
  props: Partial<React.ComponentProps<typeof NewThreadView>> = {},
) =>
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <NewThreadView
                contexts={[context]}
                installations={[installation]}
                sessions={[]}
                {...props}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  createSession.mockReset();
  locationProbe.mockReset();
  createSession.mockResolvedValue({ id: "run-new", worktreeId: "wt-1" });
  listWorktree.mockReset();
  listWorktree.mockResolvedValue([]);
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
  capabilityChanged.mockReset();
  capabilityChanged.mockReturnValue(() => undefined);
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      codingAgent: { createSession },
      capabilities: {
        listWorktree,
        list: listCapabilities,
        onChanged: capabilityChanged,
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("NewThreadView", () => {
  it("writes into a worktree before any session exists", () => {
    renderLanding();

    expect(
      screen.getByRole("heading", {
        name: /What should we build in feat\/codex-ui/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Message to agent" }),
    ).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
    expect(locationProbe).not.toHaveBeenCalledWith(
      expect.stringContaining("/chat/wt-1/"),
    );
  });

  it("creates the session on the first send and opens the thread", async () => {
    renderLanding();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Make the sidebar denser" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith({
      agentKind: "opencode",
      worktreeId: "wt-1",
      title: "codex-ui",
    });
    await waitFor(() =>
      expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-new"),
    );
  });

  it("reuses an existing draft on the same worktree instead of creating another", async () => {
    renderLanding({
      sessions: [
        {
          id: "run-draft",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          isDraft: true,
        },
      ],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Message to agent" }), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-draft"),
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not reuse a draft belonging to another worktree", async () => {
    renderLanding({
      sessions: [
        {
          id: "run-other",
          worktreeId: "wt-other",
          updatedAt: new Date(),
          isDraft: true,
        },
      ],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Message to agent" }), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      worktreeId: "wt-1",
    });
  });

  it("honours a worktree requested through the query string", () => {
    renderLanding({ initialWorktreeId: "wt-1" });
    expect(
      screen.getByRole("button", { name: "Current checkout" }).textContent,
    ).toContain("codex-ui");
  });

  it("keeps the draft and reports the failure when creation is rejected", async () => {
    createSession.mockRejectedValue(new Error("Codex server stopped."));
    renderLanding();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Make the sidebar denser" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Codex server stopped.",
      ),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message to agent",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Make the sidebar denser");
  });

  it("creates with the harness chosen in the chip, not the default one", async () => {
    const codex: CodingAgentInstallationStatusDto = {
      kind: "codex",
      name: "Codex",
      configured: true,
      version: "1.0.0",
      executablePath: "/usr/local/bin/codex",
      running: true,
      error: null,
    };
    renderLanding({ installations: [installation, codex] });

    fireEvent.click(screen.getByRole("button", { name: "Coding agent" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message to agent" }), {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      agentKind: "codex",
    });
  });

  it("keeps the browsing of the harness chip on the landing", () => {
    renderLanding({
      installations: [
        installation,
        {
          kind: "codex",
          name: "Codex",
          configured: true,
          version: "1.0.0",
          executablePath: "/usr/local/bin/codex",
          running: true,
          error: null,
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Coding agent" }));
    expect(screen.getByRole("listbox", { name: "Coding agent" })).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /What should we build in/ }),
    ).toBeTruthy();
  });

  it("sends to Worktrees when there is no repository to work in", () => {
    renderLanding({ contexts: [] });

    expect(
      screen.getByRole("heading", { name: "No repositories yet" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Worktrees" }));
    expect(locationProbe).toHaveBeenCalledWith("/worktrees");
  });

  it("sends to Settings when no coding agent is configured", () => {
    renderLanding({
      installations: [{ ...installation, configured: false }],
    });

    expect(
      screen.getByRole("heading", { name: "Configure a coding agent first" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Message to agent" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(locationProbe).toHaveBeenCalledWith("/settings");
  });
});
