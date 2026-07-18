import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";
import { buildSecondarySessionOptions } from "../lib/secondary-session-options";
import { CodingAgentLayoutControls } from "./CodingAgentLayoutControls";
import { SecondarySessionSelector } from "./SecondarySessionSelector";

const createSession = (
  id: string,
  worktreeId: string,
  title: string,
  overrides: Partial<CodingAgentSessionDto> = {},
): CodingAgentSessionDto => ({
  id,
  worktreeId,
  repositoryId: "repository",
  title,
  status: "idle",
  errorMessage: null,
  providerId: "provider",
  modelId: "model",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const createContext = (
  worktreeId: string,
  branchName: string,
): CodingAgentWorktreeContextDto => ({
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
    localRootPath: "/workspace/agentic-worktrees",
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: worktreeId,
    repositoryId: "repository",
    name: worktreeId,
    path: `/workspace/${worktreeId}`,
    branchName,
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready",
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
});

describe("coding agent layout components", () => {
  it("renders accessible single and dual layout controls", () => {
    const markup = renderToStaticMarkup(
      <CodingAgentLayoutControls
        mode="dual"
        onModeChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Single chat view"');
    expect(markup).toContain('aria-label="Dual chat view"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it("excludes the primary session and orders alternatives by most recent update", () => {
    const sessions = [
      createSession("primary", "worktree-primary", "Primary work"),
      createSession("older", "worktree-older", "Older work", {
        updatedAt: new Date("2026-07-17T10:00:00Z"),
      }),
      createSession("newer", "worktree-newer", "Newer work", {
        updatedAt: new Date("2026-07-18T10:00:00Z"),
      }),
    ];
    const contexts = [
      createContext("worktree-primary", "feature/primary"),
      createContext("worktree-older", "feature/older"),
      createContext("worktree-newer", "feature/newer"),
    ];
    const options = buildSecondarySessionOptions({
      primaryRunId: "primary",
      sessions,
      contexts,
      sessionDetails: new Map(),
      query: "",
    });

    expect(options.map((option) => option.session.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it.each([
    ["secondary work", "title"],
    ["owner/agentic", "repository"],
    ["feature/secondary", "branch"],
    ["provider/model", "model"],
    ["running focused tests", "activity"],
  ])("filters by %s in the %s metadata", (query) => {
    const session = createSession(
      "secondary",
      "worktree-secondary",
      "Secondary work",
    );
    const detail: SessionGridDetail = {
      lastActivity: "Running focused tests",
      isProcessing: true,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    };
    const options = buildSecondarySessionOptions({
      primaryRunId: "primary",
      sessions: [session],
      contexts: [createContext("worktree-secondary", "feature/secondary")],
      sessionDetails: new Map([[session.id, detail]]),
      query,
    });

    expect(options).toHaveLength(1);
    expect(options[0]?.activity).toBe("Running focused tests");
  });

  it("returns no options when the search does not match session metadata", () => {
    const options = buildSecondarySessionOptions({
      primaryRunId: "primary",
      sessions: [
        createSession("secondary", "worktree-secondary", "Secondary work"),
      ],
      contexts: [createContext("worktree-secondary", "feature/secondary")],
      sessionDetails: new Map(),
      query: "no matching session",
    });

    expect(options).toEqual([]);
  });

  it("renders complete session metadata as selectable rows", () => {
    const secondary = createSession(
      "secondary",
      "worktree-secondary",
      "Secondary work",
      { status: "busy" },
    );
    const sessionDetails = new Map<string, SessionGridDetail>([
      [
        secondary.id,
        {
          lastActivity: "Running focused tests",
          isProcessing: true,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
        },
      ],
    ]);

    const markup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={[secondary]}
        contexts={[
          createContext("worktree-secondary", "feature/secondary"),
        ]}
        sessionDetails={sessionDetails}
        loading={false}
        onSelect={() => undefined}
      />,
    );

    expect(markup).not.toContain("Primary work");
    expect(markup).toContain("Secondary work");
    expect(markup).toContain("owner/agentic-worktrees");
    expect(markup).toContain("feature/secondary");
    expect(markup).toContain("provider/model");
    expect(markup).toContain("Running focused tests");
    expect(markup).toContain("Working");
    expect(markup).toContain('aria-label="Search coding agent chats"');
  });

  it("renders loading, empty, and error states clearly", () => {
    const loadingMarkup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={[]}
        contexts={[]}
        sessionDetails={new Map()}
        loading
        onSelect={() => undefined}
      />,
    );
    const emptyMarkup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={[]}
        contexts={[]}
        sessionDetails={new Map()}
        loading={false}
        onSelect={() => undefined}
      />,
    );
    const errorMarkup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={[]}
        contexts={[]}
        sessionDetails={new Map()}
        loading={false}
        error="Could not load coding sessions."
        onSelect={() => undefined}
      />,
    );

    expect(loadingMarkup).toContain("Loading coding agent chats");
    expect(emptyMarkup).toContain("No other chats available");
    expect(errorMarkup).toContain("Could not load coding sessions.");
  });

  it("renders permission, error, and ready session states", () => {
    const sessions = [
      createSession("permission", "worktree-permission", "Permission work", {
        status: "waiting_permission",
      }),
      createSession("error", "worktree-error", "Error work", {
        status: "error",
        errorMessage: "Agent failed",
      }),
      createSession("ready", "worktree-ready", "Ready work"),
    ];
    const markup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={sessions}
        contexts={[
          createContext("worktree-permission", "feature/permission"),
          createContext("worktree-error", "feature/error"),
          createContext("worktree-ready", "feature/ready"),
        ]}
        sessionDetails={new Map()}
        loading={false}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Permission required");
    expect(markup).toContain("Error");
    expect(markup).toContain("Ready");
  });

  it("does not show Working when a stale busy session is no longer processing", () => {
    const session = createSession(
      "stale-busy",
      "worktree-stale-busy",
      "Completed work",
      { status: "busy" },
    );
    const markup = renderToStaticMarkup(
      <SecondarySessionSelector
        primaryRunId="primary"
        sessions={[session]}
        contexts={[
          createContext("worktree-stale-busy", "feature/completed"),
        ]}
        sessionDetails={
          new Map([
            [
              session.id,
              {
                lastActivity: "The requested change is complete.",
                isProcessing: false,
                additions: 1,
                deletions: 0,
                changedFiles: 1,
              },
            ],
          ])
        }
        loading={false}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Ready");
    expect(markup).not.toContain("Working");
  });
});
