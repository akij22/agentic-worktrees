import { describe, expect, it } from "vitest";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import {
  buildRepositoryFilters,
  buildThreadEntries,
  filterThreadEntries,
  getSessionStatusPresentation,
  groupThreadEntries,
  isDraftSession,
} from "./thread-list";
import type { SessionGridDetail } from "../types";

const contextFor = (
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

const sessionFor = (
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

const detail: SessionGridDetail = {
  lastActivity: undefined,
  isProcessing: false,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
};

describe("buildThreadEntries", () => {
  it("flattens sessions across repositories, newest first", () => {
    const entries = buildThreadEntries(
      [
        contextFor("repo-a", "agentic-worktrees", "wt-1", "feature/mvp"),
        contextFor("repo-b", "Atoll", "wt-2", "main"),
      ],
      [
        sessionFor({
          id: "old",
          worktreeId: "wt-1",
          updatedAt: new Date("2026-09-01"),
        }),
        sessionFor({
          id: "new",
          worktreeId: "wt-2",
          updatedAt: new Date("2026-09-20"),
        }),
      ],
      new Map(),
    );

    expect(entries.map((entry) => entry.session.id)).toEqual(["new", "old"]);
  });

  it("carries repository and branch as row metadata", () => {
    const entries = buildThreadEntries(
      [contextFor("repo-a", "agentic-worktrees", "wt-1", "feature/mvp")],
      [sessionFor({ id: "one", worktreeId: "wt-1", updatedAt: new Date() })],
      new Map([["one", detail]]),
    );

    expect(entries[0]).toMatchObject({
      repositoryId: "repo-a",
      repositoryName: "agentic-worktrees",
      branchName: "feature/mvp",
    });
    expect(entries[0]?.detail).toBe(detail);
  });

  it("falls back to a readable repository name when the context is gone", () => {
    const entries = buildThreadEntries(
      [],
      [
        sessionFor({
          id: "orphan",
          worktreeId: "missing",
          repositoryId: "repo-x",
          updatedAt: new Date(),
        }),
      ],
      new Map(),
    );

    expect(entries[0]?.context).toBeUndefined();
    expect(entries[0]?.repositoryName).toBe("Unavailable project");
    expect(entries[0]?.branchName).toBeUndefined();
  });
});

describe("isDraftSession", () => {
  it("treats an idle session with no title as a draft", () => {
    expect(
      isDraftSession(
        sessionFor({
          id: "d",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          title: "  ",
        }),
      ),
    ).toBe(true);
  });

  it("does not treat a titled or busy session as a draft", () => {
    expect(
      isDraftSession(
        sessionFor({ id: "d", worktreeId: "wt-1", updatedAt: new Date() }),
      ),
    ).toBe(false);
    expect(
      isDraftSession(
        sessionFor({
          id: "d",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          title: "  ",
          status: "busy",
        }),
      ),
    ).toBe(false);
  });
});

describe("groupThreadEntries", () => {
  const now = new Date("2026-09-29T12:00:00");

  it("puts drafts first under a single Drafts heading", () => {
    const entries = buildThreadEntries(
      [contextFor("repo-a", "agentic-worktrees", "wt-1", "main")],
      [
        sessionFor({
          id: "draft",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          title: "",
        }),
        sessionFor({ id: "live", worktreeId: "wt-1", updatedAt: now }),
      ],
      new Map(),
    );

    const groups = groupThreadEntries(entries, now);
    expect(groups[0]).toMatchObject({ kind: "drafts", label: "Drafts" });
    expect(groups[0]?.entries.map((entry) => entry.session.id)).toEqual([
      "draft",
    ]);
  });

  it("buckets recent threads by day and keeps the order they arrived in", () => {
    const entries = buildThreadEntries(
      [contextFor("repo-a", "agentic-worktrees", "wt-1", "main")],
      [
        sessionFor({
          id: "today-2",
          worktreeId: "wt-1",
          updatedAt: new Date("2026-09-29T09:00:00"),
        }),
        sessionFor({
          id: "today-1",
          worktreeId: "wt-1",
          updatedAt: new Date("2026-09-29T07:00:00"),
        }),
        sessionFor({
          id: "yesterday",
          worktreeId: "wt-1",
          updatedAt: new Date("2026-09-28T18:00:00"),
        }),
        sessionFor({
          id: "older",
          worktreeId: "wt-1",
          updatedAt: new Date("2026-08-01T12:00:00"),
        }),
      ],
      new Map(),
    );

    const groups = groupThreadEntries(entries, now);
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Older",
    ]);
    expect(groups[0]?.entries.map((entry) => entry.session.id)).toEqual([
      "today-2",
      "today-1",
    ]);
  });

  it("omits the Drafts heading when there are no drafts", () => {
    const entries = buildThreadEntries(
      [contextFor("repo-a", "agentic-worktrees", "wt-1", "main")],
      [sessionFor({ id: "one", worktreeId: "wt-1", updatedAt: now })],
      new Map(),
    );

    expect(
      groupThreadEntries(entries, now).map((group) => group.label),
    ).toEqual(["Today"]);
  });
});

describe("repository filters", () => {
  const entries = buildThreadEntries(
    [
      contextFor("repo-a", "agentic-worktrees", "wt-1", "main"),
      contextFor("repo-b", "Atoll", "wt-2", "main"),
    ],
    [
      sessionFor({ id: "a1", worktreeId: "wt-1", updatedAt: new Date(1) }),
      sessionFor({ id: "a2", worktreeId: "wt-1", updatedAt: new Date(2) }),
      sessionFor({ id: "b1", worktreeId: "wt-2", updatedAt: new Date(3) }),
    ],
    new Map(),
  );

  it("counts threads per repository and sorts them by name", () => {
    expect(buildRepositoryFilters(entries)).toEqual([
      { id: "repo-a", name: "agentic-worktrees", count: 2 },
      { id: "repo-b", name: "Atoll", count: 1 },
    ]);
  });

  it("narrows the list to one repository and restores it when cleared", () => {
    expect(
      filterThreadEntries(entries, "repo-a").map((entry) => entry.session.id),
    ).toEqual(["a2", "a1"]);
    expect(filterThreadEntries(entries, undefined)).toHaveLength(3);
  });

  it("returns nothing for a repository with no threads", () => {
    expect(filterThreadEntries(entries, "repo-missing")).toEqual([]);
  });
});

describe("getSessionStatusPresentation", () => {
  it("keeps the four established status labels", () => {
    const at = (status: string) =>
      getSessionStatusPresentation(
        sessionFor({
          id: "s",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          status,
        }),
      ).label;

    expect(at("busy")).toBe("Working");
    expect(at("creating")).toBe("Working");
    expect(at("aborting")).toBe("Working");
    expect(at("waiting_permission")).toBe("Needs attention");
    expect(at("error")).toBe("Error");
    expect(at("idle")).toBe("Ready");
  });
});
