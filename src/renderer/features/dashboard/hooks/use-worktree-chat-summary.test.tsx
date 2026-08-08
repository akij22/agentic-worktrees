// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository, Worktree } from "../../../../shared/db/schema";
import type {
	CodingAgentSessionDto,
	CodingAgentSessionSnapshotDto,
} from "../../../../shared/ipc/schemas";
import { useWorktreeChatSummary } from "./use-worktree-chat-summary";

const repository: Repository = {
	id: "repository",
	githubRepoId: 42,
	ownerLogin: "owner",
	name: "repository",
	fullName: "owner/repository",
	defaultBranch: "main",
	isPrivate: true,
	isArchived: false,
	cloneUrl: "https://example.com/repository.git",
	sshUrl: null,
	htmlUrl: "https://example.com/repository",
	localRootPath: "/workspace/repository",
	localCloneStatus: "ready",
	lastLocalScanAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	lastSyncedAt: null,
};

const createWorktree = (id: string): Worktree => ({
	id,
	repositoryId: repository.id,
	name: id,
	path: `/workspace/.worktrees/${id}`,
	branchName: `feat/${id}`,
	baseBranchName: "main",
	headCommitSha: null,
	status: "ready",
	activeRunId: `${id}-run`,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	lastSyncedAt: null,
});

const createSession = (worktree: Worktree): CodingAgentSessionDto => ({
	id: `${worktree.id}-run`,
	agentKind: "opencode",
	agentName: "OpenCode",
	worktreeId: worktree.id,
	repositoryId: repository.id,
	title: `${worktree.name} session`,
	status: "idle",
	errorMessage: null,
	hasUnviewedChanges: false,
	providerId: "provider",
	modelId: "model",
	createdAt: new Date(0),
	updatedAt: new Date(0),
});

const createSnapshot = (worktree: Worktree): CodingAgentSessionSnapshotDto => ({
	session: createSession(worktree),
	context: { worktree, repository },
	messages: [
		{
			id: `${worktree.id}-message`,
			role: "assistant",
			content: `${worktree.name} summary`,
			reasoning: "",
			createdAt: 0,
			completedAt: 0,
		},
	],
	diff: [],
	turnDiff: [],
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useWorktreeChatSummary", () => {
	it("preloads worktree summaries so selection changes use cached content", async () => {
		const firstWorktree = createWorktree("first");
		const secondWorktree = createWorktree("second");
		const sessions = new Map([
			[firstWorktree.id, createSession(firstWorktree)],
			[secondWorktree.id, createSession(secondWorktree)],
		]);
		const snapshots = new Map([
			[`${firstWorktree.id}-run`, createSnapshot(firstWorktree)],
			[`${secondWorktree.id}-run`, createSnapshot(secondWorktree)],
		]);

		Object.defineProperty(window, "api", {
			configurable: true,
			value: {
				codingAgent: {
					listSessions: vi.fn(
						async ({ worktreeId }: { worktreeId?: string }) => {
							const session = worktreeId ? sessions.get(worktreeId) : undefined;
							return session ? [session] : [];
						},
					),
					getSession: vi.fn(async ({ runId }: { runId: string }) => {
						const snapshot = snapshots.get(runId);
						if (!snapshot) throw new Error(`Missing snapshot for ${runId}`);
						return snapshot;
					}),
					onEvent: vi.fn(() => () => undefined),
				},
			},
		});

		const { result, rerender } = renderHook(
			({ selectedWorktree }: { selectedWorktree: Worktree }) =>
				useWorktreeChatSummary(selectedWorktree, [
					firstWorktree,
					secondWorktree,
				]),
			{ initialProps: { selectedWorktree: firstWorktree } },
		);

		await waitFor(() =>
			expect(window.api.codingAgent.getSession).toHaveBeenCalledTimes(2),
		);
		await waitFor(() => expect(result.current.status).toBe("ready"));

		act(() => rerender({ selectedWorktree: secondWorktree }));

		expect(result.current).toEqual({
			status: "ready",
			snapshot: snapshots.get("second-run"),
		});
	});
});
