// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import { WorktreeRow } from "./WorktreeRow";

const context = (
  repositoryId: string,
  repositoryName: string,
  worktreeId: string,
  branchName: string,
  kind: "primary" | "linked" = "linked",
): CodingAgentWorktreeContextDto => ({
  repository: {
    id: repositoryId,
    githubRepoId: 1,
    ownerLogin: "owner",
    name: repositoryName,
    fullName: `owner/${repositoryName}`,
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: `/Users/example/${repositoryName}`,
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: worktreeId,
    repositoryId,
    name: worktreeId,
    path: `/Users/example/${repositoryName}/.worktrees/${worktreeId}`,
    branchName,
    kind,
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready",
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
});

afterEach(cleanup);

describe("WorktreeRow", () => {
  it("names the selected worktree and its branch", () => {
    render(
      <WorktreeRow
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp")]}
        selectedWorktreeId="wt-1"
        activeCapabilityCount={0}
        onSelectWorktree={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Current checkout" });
    expect(trigger.textContent).toContain("wt-1");
    expect(trigger.textContent).not.toContain("feature/mvp");
    expect(screen.getByText("feature/mvp")).toBeTruthy();
  });

  it("switches workspace without leaving the row", () => {
    const onSelectWorktree = vi.fn();
    render(
      <WorktreeRow
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
          context("repo-a", "agentic-worktrees", "wt-2", "chore/theme"),
        ]}
        selectedWorktreeId="wt-1"
        activeCapabilityCount={0}
        onSelectWorktree={onSelectWorktree}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Current checkout" }));
    fireEvent.click(screen.getByRole("option", { name: /wt-2/ }));
    expect(onSelectWorktree).toHaveBeenCalledWith("wt-2");
  });

  it("warns that a primary checkout is shared", () => {
    render(
      <WorktreeRow
        contexts={[context("repo-a", "agentic-worktrees", "main", "main", "primary")]}
        selectedWorktreeId="main"
        activeCapabilityCount={0}
        onSelectWorktree={vi.fn()}
      />,
    );

    expect(screen.getByText(/Shared checkout/)).toBeTruthy();
  });

  it("shows the active capability count beside the trigger", () => {
    render(
      <WorktreeRow
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        selectedWorktreeId="wt-1"
        activeCapabilityCount={3}
        onSelectWorktree={vi.fn()}
        onOpenCapabilities={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Capabilities/ });
    expect(trigger.textContent).toContain("3");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("can disable the capability trigger", () => {
    render(
      <WorktreeRow
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        selectedWorktreeId="wt-1"
        activeCapabilityCount={0}
        onSelectWorktree={vi.fn()}
        onOpenCapabilities={vi.fn()}
        capabilitiesDisabled
      />,
    );

    expect(
      (screen.getByRole("button", { name: /Capabilities/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders nothing when no worktree is available", () => {
    const { container } = render(
      <WorktreeRow
        contexts={[]}
        activeCapabilityCount={0}
        onSelectWorktree={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
