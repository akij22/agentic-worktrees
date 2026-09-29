// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import { CapabilityPanel } from "./CapabilityPanel";

const context: CodingAgentWorktreeContextDto = {
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
    kind: "linked",
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready",
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
};

const libraryEntry = (id: string, name: string, installationState = "installed") => ({
  id,
  name,
  version: "1.0.0",
  description: `${name} description`,
  category: "tools",
  compatibility: { codex: "supported" as const, opencode: "supported" as const },
  state: "ready" as const,
  secretConfigured: false,
  installationState,
  source: "bundled" as const,
  trust: "built-in" as const,
  reviewStatus: "bundled-reviewed" as const,
});

const assignment = (capabilityId: string, state: string) => ({
  worktreeId: "wt-1",
  capabilityId,
  name: capabilityId,
  version: "1.0.0",
  state,
});

const listWorktree = vi.fn();
const list = vi.fn();
const assignWorktree = vi.fn();
const revokeWorktree = vi.fn();

beforeEach(() => {
  for (const mock of [listWorktree, list, assignWorktree, revokeWorktree]) {
    mock.mockReset();
  }
  listWorktree.mockResolvedValue([]);
  list.mockResolvedValue([]);
  assignWorktree.mockResolvedValue(assignment("web-search", "pending_activation"));
  revokeWorktree.mockResolvedValue(assignment("web-search", "deactivated"));
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      capabilities: {
        listWorktree,
        list,
        assignWorktree,
        revokeWorktree,
        onChanged: () => () => undefined,
      },
    },
  });
});

afterEach(cleanup);

const renderPanel = (onClose = vi.fn()) => {
  render(<CapabilityPanel context={context} onClose={onClose} />);
  return { onClose };
};

describe("CapabilityPanel", () => {
  it("names the worktree the assignments belong to", async () => {
    renderPanel();
    expect(
      screen.getByRole("dialog", { name: "Capabilities for this worktree" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/agentic-worktrees · codex-ui/)).toBeTruthy(),
    );
  });

  it("reads assignments by worktree, not by session", async () => {
    renderPanel();
    await waitFor(() => expect(listWorktree).toHaveBeenCalledWith({ worktreeId: "wt-1" }));
  });

  it("shows an enabled assignment in the verified vocabulary", async () => {
    listWorktree.mockResolvedValue([assignment("web-search", "active")]);
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Enabled")).toBeTruthy());
  });

  it("keeps an unproven assignment as applying rather than enabled", async () => {
    listWorktree.mockResolvedValue([assignment("web-search", "pending_activation")]);
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Applying")).toBeTruthy());
    expect(screen.queryByText("Enabled")).toBeNull();
  });

  it("surfaces a failed assignment with its error state", async () => {
    listWorktree.mockResolvedValue([assignment("web-search", "activation_failed")]);
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Failed")).toBeTruthy());
  });

  it("assigns an installed capability to the worktree", async () => {
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(assignWorktree).toHaveBeenCalledWith({
        worktreeId: "wt-1",
        capabilityId: "web-search",
      }),
    );
    expect(revokeWorktree).not.toHaveBeenCalled();
  });

  it("revokes an assigned capability from the worktree", async () => {
    listWorktree.mockResolvedValue([assignment("web-search", "active")]);
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(revokeWorktree).toHaveBeenCalledWith({
        worktreeId: "wt-1",
        capabilityId: "web-search",
      }),
    );
  });

  it("cannot assign a capability that is not configured", async () => {
    list.mockResolvedValue([
      libraryEntry("web-search", "Web Search", "needs_setup"),
    ]);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Not configured for this installation.")).toBeTruthy();
  });

  it("reports a rejected change instead of silently reverting", async () => {
    list.mockResolvedValue([libraryEntry("web-search", "Web Search")]);
    assignWorktree.mockRejectedValue(new Error("Review and configure it first."));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Review and configure it first.",
      ),
    );
  });

  it("closes on Escape and returns focus to its own close control", async () => {
    const { onClose } = renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Close capabilities")).toBeTruthy(),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Close capabilities"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps an assignment whose capability was uninstalled visible", async () => {
    listWorktree.mockResolvedValue([assignment("gone", "active")]);
    list.mockResolvedValue([]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Enabled")).toBeTruthy());
    expect(screen.getByText("gone")).toBeTruthy();
  });
});
