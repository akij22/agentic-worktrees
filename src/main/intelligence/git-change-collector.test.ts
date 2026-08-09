import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitChangeCollector } from "./git-change-collector";

const write = async (
	root: string,
	relativePath: string,
	content: string | Buffer,
) => {
	const absolutePath = path.join(root, relativePath);
	await mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content);
};

describe("Git change collector", () => {
	let root: string;
	let git: SimpleGit;

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "agentic-intelligence-"));
		git = simpleGit(root);
		await git.init();
		await git.addConfig("user.name", "Intelligence Test");
		await git.addConfig("user.email", "intelligence@example.com");
		await write(root, "src/a.ts", "export const a = 1;\n");
		await write(root, "src/b.ts", "export const b = 1;\n");
		await write(
			root,
			"src/old.ts",
			"export const stable = true;\nexport const oldName = 1;\nexport const tail = true;\n",
		);
		await git.add(["."]);
		await git.commit("initial");
		await git.branch(["-M", "main"]);
		await git.checkoutLocalBranch("feat/intelligence");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const collect = () =>
		createGitChangeCollector().collect({
			worktreeId: "worktree-1",
			repositoryId: "repository-1",
			worktreePath: root,
			branchName: "feat/intelligence",
			baseBranchName: "main",
		});

	it("collects committed, staged, unstaged, and untracked task changes", async () => {
		await write(root, "src/a.ts", "export const a = 2;\n");
		await git.add(["src/a.ts"]);
		await git.commit("change a");

		await write(root, "src/b.ts", "export const b = 2;\n");
		await git.add(["src/b.ts"]);
		await write(root, "src/a.ts", "export const a = 3;\n");
		await write(root, "src/new.ts", "export const created = true;\n");

		const result = await collect();

		expect(result.files.map(({ path: filePath }) => filePath).sort()).toEqual([
			"src/a.ts",
			"src/b.ts",
			"src/new.ts",
		]);
		expect(
			result.files.find(({ path: filePath }) => filePath === "src/new.ts"),
		).toMatchObject({
			changeType: "added",
			previousPath: null,
			deletions: 0,
			binary: false,
			modulePath: "src",
		});
		expect(
			result.files.find(({ path: filePath }) => filePath === "src/a.ts"),
		).toMatchObject({ changeType: "modified", additions: 1, deletions: 1 });
		expect(result.mergeBase).toMatch(/^[0-9a-f]{40}$/);
		expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);
	});

	it("retains rename source and destination paths", async () => {
		await git.mv("src/old.ts", "src/new-name.ts");
		await write(
			root,
			"src/new-name.ts",
			"export const stable = true;\nexport const newName = 2;\nexport const tail = true;\n",
		);

		const result = await collect();

		expect(result.files).toContainEqual(
			expect.objectContaining({
				changeType: "renamed",
				previousPath: "src/old.ts",
				path: "src/new-name.ts",
			}),
		);
	});

	it("returns file metadata but no patch for binary changes", async () => {
		await write(root, "assets/image.bin", Buffer.from([0, 1, 2, 3, 255]));
		await git.add(["assets/image.bin"]);

		const result = await collect();
		const binary = result.files.find(
			({ path: filePath }) => filePath === "assets/image.bin",
		);

		expect(binary).toMatchObject({
			changeType: "added",
			binary: true,
			patch: null,
			afterContent: null,
		});
	});

	it("rejects a missing base branch with worktree context", async () => {
		await expect(
			createGitChangeCollector().collect({
				worktreeId: "broken-worktree",
				repositoryId: "repository-1",
				worktreePath: root,
				branchName: "feat/intelligence",
				baseBranchName: "missing-base",
			}),
		).rejects.toThrow(/broken-worktree.*merge base/i);
	});
});
