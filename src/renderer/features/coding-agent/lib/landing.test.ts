import { describe, expect, it } from "vitest";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import {
  findReusableDraft,
  readLandingSubmission,
  includeSubmittedMessage,
  resolveDefaultWorktreeId,
  resolveLandingPrompt,
} from "./landing";

const context = (
  id: string,
  branchName: string,
  kind: "primary" | "linked" = "linked",
): CodingAgentWorktreeContextDto => ({
  repository: {
    id: `repo-${id}`,
    githubRepoId: 1,
    ownerLogin: "owner",
    name: id,
    fullName: `owner/${id}`,
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: `/Users/example/${id}`,
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id,
    repositoryId: `repo-${id}`,
    name: id,
    path: `/Users/example/${id}`,
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

describe("resolveLandingPrompt", () => {
  it("names the branch the composer will write into", () => {
    expect(resolveLandingPrompt(context("wt-1", "feature/mvp"))).toBe(
      "What should we build in feature/mvp?",
    );
  });

  it("falls back to a branch-less prompt when nothing is selected", () => {
    expect(resolveLandingPrompt(undefined)).toBe("What should we build?");
  });
});

describe("resolveDefaultWorktreeId", () => {
  const contexts = [context("wt-old", "main"), context("wt-new", "main")];

  it("prefers the worktree of the most recently updated session", () => {
    expect(
      resolveDefaultWorktreeId(contexts, [
        { worktreeId: "wt-old", updatedAt: new Date("2026-09-01") },
        { worktreeId: "wt-new", updatedAt: new Date("2026-09-20") },
      ]),
    ).toBe("wt-new");
  });

  it("prefers the primary checkout when there is no session history", () => {
    expect(
      resolveDefaultWorktreeId([context("wt-1", "main"), context("main-checkout", "main", "primary")], []),
    ).toBe("main-checkout");
  });

  it("ignores sessions whose worktree is no longer available", () => {
    expect(
      resolveDefaultWorktreeId(contexts, [
        { worktreeId: "wt-removed", updatedAt: new Date("2026-09-29") },
      ]),
    ).toBe("wt-old");
  });

  it("returns nothing when no worktree exists", () => {
    expect(resolveDefaultWorktreeId([], [])).toBeUndefined();
  });
});

describe("findReusableDraft", () => {
  const entries = [
    { worktreeId: "wt-1", isDraft: true, id: "a" },
    { worktreeId: "wt-2", isDraft: true, id: "b" },
    { worktreeId: "wt-1", isDraft: false, id: "c" },
  ];

  it("reuses a draft only on the selected worktree", () => {
    expect(findReusableDraft(entries, "wt-2")?.id).toBe("b");
  });

  it("does not reuse a non-draft thread on the same worktree", () => {
    expect(findReusableDraft(entries, "wt-1")?.id).toBe("a");
  });

  it("reuses nothing when no worktree is selected", () => {
    expect(findReusableDraft(entries, undefined)).toBeUndefined();
  });
});

describe("landing message handoff", () => {
  const message = { id: "pending", role: "user" as const, content: "Hello", reasoning: "", tools: [], createdAt: 1, completedAt: null };
  const submission = { runId: "run-1", agentName: "Codex", message };

  it("reads only valid submissions for the current thread", () => {
    expect(readLandingSubmission({ landingSubmission: submission }, "run-1")).toEqual(submission);
    expect(readLandingSubmission({ landingSubmission: submission }, "run-2")).toBeUndefined();
    expect(readLandingSubmission(null, "run-1")).toBeUndefined();
    expect(readLandingSubmission({ landingSubmission: { runId: "run-1" } }, "run-1")).toBeUndefined();
  });

  it("keeps the local message visible until the server copy arrives without duplicating it", () => {
    expect(includeSubmittedMessage([], message)).toEqual([message]);
    const confirmed = { ...message, id: "server-message" };
    expect(includeSubmittedMessage([confirmed], message)).toEqual([confirmed]);
    const response = { ...message, id: "response", role: "assistant" as const };
    expect(includeSubmittedMessage([response], message)).toEqual([message, response]);
  });
});
