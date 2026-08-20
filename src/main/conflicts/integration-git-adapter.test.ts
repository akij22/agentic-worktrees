import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIntegrationGitAdapter } from "./integration-git-adapter";

const git = (cwd: string, ...args: string[]): string =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const roots: string[] = [];
const setup = () => {
	const root = mkdtempSync(join(tmpdir(), "agentic-conflict-"));
	roots.push(root);
	const repositoryPath = join(root, "repo");
	mkdirSync(repositoryPath);
	git(repositoryPath, "init", "-b", "main");
	git(repositoryPath, "config", "user.name", "Test User");
	git(repositoryPath, "config", "user.email", "test@example.com");
	writeFileSync(join(repositoryPath, "shared.txt"), "base\n");
	writeFileSync(join(repositoryPath, "delete.txt"), "delete me\n");
	writeFileSync(join(repositoryPath, "rename.txt"), "rename me\n");
	git(repositoryPath, "add", ".");
	git(repositoryPath, "commit", "-m", "base");
	const targetCommitSha = git(repositoryPath, "rev-parse", "HEAD");
	return { root, repositoryPath, targetCommitSha };
};

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("IntegrationGitAdapter", () => {
	it("captures the complete dirty state without modifying the original worktree", async () => {
		const { root, repositoryPath, targetCommitSha } = setup();
		const worktreePath = join(root, "left");
		git(
			repositoryPath,
			"worktree",
			"add",
			"-b",
			"feat/left",
			worktreePath,
			"main",
		);
		writeFileSync(join(worktreePath, "committed.txt"), "committed\n");
		git(worktreePath, "add", "committed.txt");
		git(worktreePath, "commit", "-m", "participant commit");
		writeFileSync(join(worktreePath, "staged.txt"), "staged\n");
		git(worktreePath, "add", "staged.txt");
		writeFileSync(join(worktreePath, "shared.txt"), "unstaged\n");
		writeFileSync(join(worktreePath, "untracked.txt"), "untracked\n");
		rmSync(join(worktreePath, "delete.txt"));
		writeFileSync(
			join(worktreePath, "renamed.txt"),
			readFileSync(join(worktreePath, "rename.txt")),
		);
		rmSync(join(worktreePath, "rename.txt"));

		const adapter = createIntegrationGitAdapter({
			integrationRoot: join(root, "integration"),
		});
		const before = await adapter.captureFingerprint(worktreePath);
		const snapshot = await adapter.createSyntheticSnapshot({
			repositoryPath,
			worktreePath,
			targetCommitSha,
			sessionId: "session",
			side: "left",
		});
		const after = await adapter.captureFingerprint(worktreePath);

		expect(after).toBe(before);
		expect(
			git(repositoryPath, "show", `${snapshot.syntheticCommitSha}:staged.txt`),
		).toBe("staged");
		expect(
			git(repositoryPath, "show", `${snapshot.syntheticCommitSha}:shared.txt`),
		).toBe("unstaged");
		expect(
			git(
				repositoryPath,
				"show",
				`${snapshot.syntheticCommitSha}:untracked.txt`,
			),
		).toBe("untracked");
		expect(() =>
			git(repositoryPath, "show", `${snapshot.syntheticCommitSha}:delete.txt`),
		).toThrow();
		expect(
			git(repositoryPath, "show", `${snapshot.syntheticCommitSha}:renamed.txt`),
		).toBe("rename me");
	});

	it("retains real unmerged stages when synthetic snapshots conflict", async () => {
		const { root, repositoryPath, targetCommitSha } = setup();
		const leftPath = join(root, "left");
		const rightPath = join(root, "right");
		git(repositoryPath, "worktree", "add", "-b", "feat/left", leftPath, "main");
		git(
			repositoryPath,
			"worktree",
			"add",
			"-b",
			"feat/right",
			rightPath,
			"main",
		);
		writeFileSync(join(leftPath, "shared.txt"), "left\n");
		writeFileSync(join(rightPath, "shared.txt"), "right\n");
		const adapter = createIntegrationGitAdapter({
			integrationRoot: join(root, "integration"),
		});
		const left = await adapter.createSyntheticSnapshot({
			repositoryPath,
			worktreePath: leftPath,
			targetCommitSha,
			sessionId: "conflict",
			side: "left",
		});
		const right = await adapter.createSyntheticSnapshot({
			repositoryPath,
			worktreePath: rightPath,
			targetCommitSha,
			sessionId: "conflict",
			side: "right",
		});
		const integration = await adapter.createIntegrationWorktree({
			repositoryPath,
			targetCommitSha,
			sessionId: "conflict",
		});

		expect(
			(await adapter.mergeSynthetic(integration.path, left.syntheticRef)).kind,
		).toBe("clean");
		const result = await adapter.mergeSynthetic(
			integration.path,
			right.syntheticRef,
		);

		expect(result.kind).toBe("conflict");
		if (result.kind === "conflict") {
			expect(result.files.map(({ path }) => path)).toContain("shared.txt");
			expect(
				result.files
					.find(({ path }) => path === "shared.txt")
					?.stages.map(({ stage }) => stage),
			).toEqual([1, 2, 3]);
		}
		expect(
			readFileSync(join(integration.path, "shared.txt"), "utf8"),
		).toContain("<<<<<<<");
	});
});
