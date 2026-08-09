import { describe, expect, it, vi } from "vitest";
import type { OverlapTarget } from "../intelligence/types";
import type { IntegrationGitAdapter, SyntheticSnapshotResult } from "./integration-git-adapter";
import { createIntegrationWorktreeService } from "./integration-worktree-service";

const snapshot = (side: "left" | "right"): SyntheticSnapshotResult => ({
	originalHeadSha: `${side}-head`,
	mergeBaseSha: "base",
	syntheticCommitSha: `${side}-snapshot`,
	syntheticRef: `refs/agentic-worktrees/integration/session/${side}`,
	statusFingerprintBefore: `${side}-fingerprint`,
	statusFingerprintAfter: `${side}-fingerprint`,
});

const adapter = (): IntegrationGitAdapter => ({
	resolveRef: vi.fn().mockResolvedValue("target-sha"),
	captureFingerprint: vi.fn(),
	createSyntheticSnapshot: vi.fn()
		.mockResolvedValueOnce(snapshot("left"))
		.mockResolvedValueOnce(snapshot("right")),
	createIntegrationWorktree: vi.fn().mockResolvedValue({ path: "/integration/session", branch: "agentic/integration/session" }),
	mergeSynthetic: vi.fn()
		.mockResolvedValueOnce({ kind: "clean", files: [], mergeCommitSha: "left-merge" })
		.mockResolvedValueOnce({ kind: "clean", files: [], mergeCommitSha: "right-merge" }),
	inspectConflicts: vi.fn(),
	removeIntegrationWorktree: vi.fn().mockResolvedValue(undefined),
	deleteSyntheticRef: vi.fn().mockResolvedValue(undefined),
});

const target = (reasonCode: string, risk: "high" | "medium"): OverlapTarget => ({
	type: reasonCode === "same-symbol" ? "symbol" : "file",
	path: "src/session.ts",
	symbol: reasonCode === "same-symbol" ? "createSession" : null,
	leftFilePath: "src/session.ts",
	rightFilePath: "src/session.ts",
	reasonCode,
	risk,
});

const input = (targets: OverlapTarget[] = [target("same-file", "medium")]) => ({
	sessionId: "session",
	repository: { id: "repository", path: "/repo" },
	targetBranch: "main",
	participants: [
		{ side: "left" as const, repositoryId: "repository", worktreeId: "left", runId: "left-run", task: "Left", agentName: "Codex", branch: "feat/left", path: "/left" },
		{ side: "right" as const, repositoryId: "repository", worktreeId: "right", runId: "right-run", task: "Right", agentName: "OpenCode", branch: "feat/right", path: "/right" },
	] as const,
	targets,
});

describe("IntegrationWorktreeService", () => {
	it("removes disposable Git state after a safe merge", async () => {
		const git = adapter();
		const result = await createIntegrationWorktreeService({ git }).prepare(input());

		expect(result.classification).toBe("safe");
		expect(result.retained).toBe(false);
		expect(git.removeIntegrationWorktree).toHaveBeenCalledOnce();
		expect(git.deleteSyntheticRef).toHaveBeenCalledTimes(2);
	});

	it("retains a clean sandbox when semantic evidence requires review", async () => {
		const git = adapter();
		const result = await createIntegrationWorktreeService({ git }).prepare(input([target("same-symbol", "high")]));

		expect(result.classification).toBe("review_required");
		expect(result.retained).toBe(true);
		expect(result.integrationPath).toBe("/integration/session");
		expect(git.removeIntegrationWorktree).not.toHaveBeenCalled();
	});

	it("retains the real conflicted sandbox and normalized Git stages", async () => {
		const git = adapter();
		vi.mocked(git.mergeSynthetic)
			.mockReset()
			.mockResolvedValueOnce({ kind: "clean", files: [], mergeCommitSha: "left-merge" })
			.mockResolvedValueOnce({ kind: "conflict", files: [{
				path: "src/session.ts",
				stages: [{ stage: 1, mode: "100644", objectId: "base", path: "src/session.ts" }],
				markerRanges: [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 4 }],
			}] });

		const result = await createIntegrationWorktreeService({ git }).prepare(input());

		expect(result.classification).toBe("conflict");
		expect(result.retained).toBe(true);
		expect(result.files[0]).toMatchObject({ path: "src/session.ts", kind: "git_conflict" });
		expect(git.removeIntegrationWorktree).not.toHaveBeenCalled();
	});

	it("rejects participants outside the repository before Git operations", async () => {
		const git = adapter();
		const valid = input();
		const invalid = {
			...valid,
			participants: [valid.participants[0], { ...valid.participants[1], repositoryId: "other" }] as const,
		};

		await expect(createIntegrationWorktreeService({ git }).prepare(invalid)).rejects.toThrow(/same repository/);
		expect(git.resolveRef).not.toHaveBeenCalled();
	});

	it("cleans partial resources after a failed merge", async () => {
		const git = adapter();
		vi.mocked(git.mergeSynthetic).mockReset().mockRejectedValue(new Error("merge crashed"));

		await expect(createIntegrationWorktreeService({ git }).prepare(input())).rejects.toThrow("merge crashed");
		expect(git.removeIntegrationWorktree).toHaveBeenCalledOnce();
		expect(git.deleteSyntheticRef).toHaveBeenCalledTimes(2);
	});
});
