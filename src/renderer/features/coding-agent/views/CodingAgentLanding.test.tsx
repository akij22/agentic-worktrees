// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";

const mocks = vi.hoisted(() => ({
  useCodingAgentSessions: vi.fn(),
}));

vi.mock("../hooks/useCodingAgentSessions", () => ({
  useCodingAgentSessions: mocks.useCodingAgentSessions,
}));

import { CodingAgentLanding } from "./CodingAgentLanding";
import { CodingAgentProjectSidebar } from "../components/CodingAgentProjectSidebar";

const context: CodingAgentWorktreeContextDto = {
  repository: {
    id: "repository",
    githubRepoId: 42,
    ownerLogin: "owner",
    name: "agentic-worktrees",
    fullName: "owner/agentic-worktrees",
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: "/Users/example/Documents/agentic-worktrees",
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: "worktree",
    repositoryId: "repository",
    name: "codex-ui",
    path: "/Users/example/Documents/agentic-worktrees/.worktrees/codex-ui",
    branchName: "feat/codex-ui",
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready",
    activeRunId: "run",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
};

const session: CodingAgentSessionDto = {
  id: "run",
  agentKind: "codex",
  agentName: "Codex",
  worktreeId: context.worktree.id,
  repositoryId: context.repository.id,
  title: "Refine chat layout",
  status: "busy",
  errorMessage: null,
  hasUnviewedChanges: false,
  providerId: "openai",
  modelId: "gpt-5.6",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const loadedSessionsState = () => ({
  status: {
    installations: [
      {
        kind: "codex" as const,
        name: "Codex",
        configured: true,
        version: "1.0.0",
        executablePath: "/usr/local/bin/codex",
        defaultProviderId: "openai",
        defaultModelId: "gpt-5.6",
      },
    ],
  },
  contexts: [context],
  sessions: [session],
  sessionDetails: new Map(),
  loading: false,
  error: undefined,
  reload: vi.fn(),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Coding Agent project layout", () => {
  it("renders sessions in a project navigation using abbreviated names", () => {
    mocks.useCodingAgentSessions.mockReturnValue(loadedSessionsState());

    render(
      <MemoryRouter>
        <CodingAgentLanding />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("navigation", { name: "Coding agent projects" }),
    ).toBeTruthy();
    expect(screen.getByText("agentic-worktrees")).toBeTruthy();
    expect(screen.getByText("Refine chat layout")).toBeTruthy();
    expect(screen.getByText("feat/codex-ui")).toBeTruthy();
    expect(screen.queryByText("owner/agentic-worktrees")).toBeNull();
    expect(screen.queryByText(context.worktree.path)).toBeNull();
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("resizes the project sidebar within its minimum and maximum widths", () => {
    mocks.useCodingAgentSessions.mockReturnValue(loadedSessionsState());
    render(
      <MemoryRouter>
        <CodingAgentLanding />
      </MemoryRouter>,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize project sidebar",
    });
    expect(separator.getAttribute("aria-valuemin")).toBe("240");
    expect(separator.getAttribute("aria-valuemax")).toBe("420");
    expect(separator.getAttribute("aria-valuenow")).toBe("240");

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
    }
    expect(separator.getAttribute("aria-valuenow")).toBe("240");

    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(separator, { key: "ArrowRight" });
    }
    expect(separator.getAttribute("aria-valuenow")).toBe("420");
  });

  it("clamps pointer resizing to the project sidebar bounds", () => {
    mocks.useCodingAgentSessions.mockReturnValue(loadedSessionsState());
    render(
      <MemoryRouter>
        <CodingAgentLanding />
      </MemoryRouter>,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize project sidebar",
    });
    Object.defineProperty(separator.parentElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 100 }),
    });

    fireEvent.pointerDown(separator);
    fireEvent.pointerMove(window, { clientX: 200 });
    expect(separator.getAttribute("aria-valuenow")).toBe("240");

    fireEvent.pointerMove(window, { clientX: 700 });
    expect(separator.getAttribute("aria-valuenow")).toBe("420");
    fireEvent.pointerUp(window);
  });

  it("expands the first project after asynchronously loaded sessions arrive", () => {
    const props = {
      activeRunId: undefined,
      error: undefined,
      onNewSession: vi.fn(),
      onOpenSession: vi.fn(),
    };
    const { rerender } = render(
      <CodingAgentProjectSidebar
        {...props}
        contexts={[]}
        sessions={[]}
        width={320}
        loading
      />,
    );

    rerender(
      <CodingAgentProjectSidebar
        {...props}
        contexts={[context]}
        sessions={[session]}
        width={320}
        loading={false}
      />,
    );

    expect(screen.getByText("Refine chat layout")).toBeTruthy();
  });
});
