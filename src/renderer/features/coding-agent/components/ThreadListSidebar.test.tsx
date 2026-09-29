// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { ThreadListSidebar } from "./ThreadListSidebar";

const context = (
  repositoryId: string,
  repositoryName: string,
  worktreeId: string,
  branchName: string,
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
    kind: "linked",
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready",
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
});

const session = (
  overrides: Partial<CodingAgentSessionDto> &
    Pick<CodingAgentSessionDto, "id" | "worktreeId" | "updatedAt">,
): CodingAgentSessionDto => ({
  agentKind: "opencode",
  agentName: "OpenCode",
  repositoryId: "repo-a",
  title: "A thread",
  status: "idle",
  errorMessage: null,
  hasUnviewedChanges: false,
  providerId: "opencode",
  modelId: "space-bunny-free",
  createdAt: new Date(0),
  ...overrides,
});

const baseProps = {
  width: 320,
  loading: false,
  error: undefined,
  hasConfiguredHarness: true,
  onNewSession: vi.fn(),
  onOpenSession: vi.fn(),
  sessionDetails: new Map(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadListSidebar", () => {
  it("lists every thread flat with repository and branch on the row", () => {
    const onOpenSession = vi.fn();
    render(
      <ThreadListSidebar
        {...baseProps}
        onOpenSession={onOpenSession}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Coding agent threads" }),
    ).toBeTruthy();
    const row = screen.getByRole("button", { name: /A thread/ });
    expect(row.textContent).toContain("OpenCode");
    expect(row.textContent).toContain("agentic-worktrees");
    expect(row.textContent).toContain("feature/mvp");

    fireEvent.click(row);
    expect(onOpenSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "one" }),
    );
  });

  it("does not nest threads under expandable repository groups", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
          context("repo-b", "Atoll", "wt-2", "main"),
        ]}
        sessions={[
          session({
            id: "one",
            worktreeId: "wt-1",
            updatedAt: new Date(),
            title: "Sidebar work",
          }),
          session({
            id: "two",
            worktreeId: "wt-2",
            updatedAt: new Date(0),
            title: "Checkout work",
          }),
        ]}
      />,
    );

    // Repository names survive only as filter chips and row metadata, never as
    // an expandable group heading that would hide its threads behind a click.
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    expect(screen.getByRole("button", { name: /Sidebar work/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Checkout work/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /All 2/ })).toBeTruthy();
  });

  it("offers repository filter chips only when more than one repository is present", () => {
    const { rerender } = render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /All 1/ })).toBeNull();

    rerender(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "main"),
          context("repo-b", "Atoll", "wt-2", "main"),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
          session({ id: "two", worktreeId: "wt-2", updatedAt: new Date(0) }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /All 2/ })).toBeTruthy();
  });

  it("narrows the list to the chosen repository and clears on a second press", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "main"),
          context("repo-b", "Atoll", "wt-2", "main"),
        ]}
        sessions={[
          session({
            id: "aw",
            worktreeId: "wt-1",
            updatedAt: new Date(2),
            title: "Refine sidebar",
          }),
          session({
            id: "at",
            worktreeId: "wt-2",
            updatedAt: new Date(1),
            title: "Tidy migrations",
          }),
        ]}
      />,
    );

    const chip = screen.getByRole("button", { name: /^Atoll/ });
    fireEvent.click(chip);
    expect(screen.queryByRole("button", { name: /Refine sidebar/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Tidy migrations/ }),
    ).toBeTruthy();

    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: /Refine sidebar/ })).toBeTruthy();
  });

  it("shows a distinct empty state when a filter matches nothing", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "main"),
          context("repo-b", "Atoll", "wt-2", "main"),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search threads" }),
      {
        target: { value: "nothing-matches-this" },
      },
    );
    expect(screen.getByText("No threads match this filter.")).toBeTruthy();
  });

  it("collects untitled idle sessions under a Drafts heading", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[
          session({
            id: "draft",
            worktreeId: "wt-1",
            updatedAt: new Date(),
            title: "",
          }),
          session({
            id: "live",
            worktreeId: "wt-1",
            updatedAt: new Date(0),
            title: "Real work",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Drafts" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Untitled thread/ }),
    ).toBeTruthy();
  });

  it("reveals the thread dossier on hover and hides it again", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
        sessionDetails={
          new Map([
            [
              "one",
              {
                lastActivity: undefined,
                isProcessing: false,
                additions: 0,
                deletions: 0,
                changedFiles: 0,
                activeCapabilities: [{ id: "web-search", name: "Web Search" }],
              },
            ],
          ])
        }
      />,
    );

    const row = screen.getByRole("button", { name: /A thread/ });
    const card = document.getElementById("thread-dossier-one");
    expect(card?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.mouseEnter(row.parentElement as HTMLElement);
    expect(card?.getAttribute("aria-hidden")).toBe("false");
    expect(card?.textContent).toContain("owner/agentic-worktrees");
    expect(card?.textContent).toContain("feature/mvp");
    expect(card?.textContent).toContain("Web Search");

    fireEvent.mouseLeave(row.parentElement as HTMLElement);
    expect(card?.getAttribute("aria-hidden")).toBe("true");
  });

  it("disables the new-thread button until a harness is configured", () => {
    const { rerender } = render(
      <ThreadListSidebar
        {...baseProps}
        hasConfiguredHarness={false}
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[]}
      />,
    );
    const button = screen.getByRole("button", {
      name: "New coding agent chat",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toContain("Settings");

    rerender(
      <ThreadListSidebar
        {...baseProps}
        hasConfiguredHarness
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[]}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "New coding agent chat",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("tells the user there is nothing yet instead of rendering an empty rail", () => {
    render(<ThreadListSidebar {...baseProps} contexts={[]} sessions={[]} />);
    expect(
      screen.getByText("No threads yet. Start one from the composer."),
    ).toBeTruthy();
  });

  it("identifies the coding agent by its logo rather than by text", () => {
    const { rerender } = render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[
          session({
            id: "codex-run",
            worktreeId: "wt-1",
            updatedAt: new Date(),
            agentKind: "codex",
          }),
        ]}
      />,
    );

    const logo = document.querySelector(
      "img[src*='openai']",
    ) as HTMLImageElement | null;
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute("alt")).toBe("");
    // The name stays available to assistive technology.
    expect(
      screen.getByRole("button", { name: /A thread, Codex/ }),
    ).toBeTruthy();

    rerender(
      <ThreadListSidebar
        {...baseProps}
        contexts={[context("repo-a", "agentic-worktrees", "wt-1", "main")]}
        sessions={[
          session({
            id: "opencode-run",
            worktreeId: "wt-1",
            updatedAt: new Date(),
            agentKind: "opencode",
          }),
        ]}
      />,
    );

    expect(document.querySelector("img[src*='opencode']")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /A thread, OpenCode/ }),
    ).toBeTruthy();
  });

  it("gives the project and the branch a line each so neither is truncated", () => {
    const longBranch = "feat/a-very-long-branch-name-that-used-to-be-cut-off";
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", longBranch),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
      />,
    );

    const row = screen.getByRole("button", { name: /A thread/ });
    const project = within(row).getByText("agentic-worktrees");
    const branch = within(row).getByText(longBranch);

    // Separate elements, so neither can squeeze the other out of existence.
    expect(project).not.toBe(branch);
    expect(branch.className).toContain("break-all");
    expect(branch.className).not.toContain("truncate");
  });

  it("distinguishes the project from the branch by typography", () => {
    render(
      <ThreadListSidebar
        {...baseProps}
        contexts={[
          context("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
        ]}
        sessions={[
          session({ id: "one", worktreeId: "wt-1", updatedAt: new Date() }),
        ]}
      />,
    );

    // The project reads as a name, the branch as code.
    const row = screen.getByRole("button", { name: /A thread/ });
    expect(within(row).getByText("agentic-worktrees").className).not.toContain(
      "font-mono",
    );
    expect(within(row).getByText("feature/mvp").className).toContain(
      "font-mono",
    );
  });
});
