import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
	ConflictParticipantSide,
	GitConflictFile,
	GitConflictStage,
	MergeSimulationResult,
} from "./types";
import { createGitProcess, GitCommandError, type GitProcess } from "./git-process";

export interface SyntheticSnapshotResult {
	originalHeadSha: string;
	mergeBaseSha: string;
	syntheticCommitSha: string;
	syntheticRef: string;
	statusFingerprintBefore: string;
	statusFingerprintAfter: string;
}

export interface IntegrationWorktreeResult {
	path: string;
	branch: string;
}

export interface IntegrationGitAdapter {
	resolveRef(repositoryPath: string, ref: string): Promise<string>;
	captureFingerprint(worktreePath: string): Promise<string>;
	createSyntheticSnapshot(input: {
		repositoryPath: string;
		worktreePath: string;
		targetCommitSha: string;
		sessionId: string;
		side: ConflictParticipantSide;
	}): Promise<SyntheticSnapshotResult>;
	createIntegrationWorktree(input: {
		repositoryPath: string;
		targetCommitSha: string;
		sessionId: string;
	}): Promise<IntegrationWorktreeResult>;
	mergeSynthetic(integrationPath: string, syntheticRef: string): Promise<MergeSimulationResult>;
	inspectConflicts(integrationPath: string): Promise<GitConflictFile[]>;
	removeIntegrationWorktree(input: {
		repositoryPath: string;
		path: string;
		branch: string;
	}): Promise<void>;
	deleteSyntheticRef(repositoryPath: string, syntheticRef: string): Promise<void>;
}

const safeSessionId = (value: string): string => {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid integration session ID: ${value}`);
	return value;
};

const indexPathFor = async (git: GitProcess, worktreePath: string): Promise<string> => {
	const value = (await git.run({ cwd: worktreePath, args: ["rev-parse", "--git-path", "index"] })).stdout.trim();
	return isAbsolute(value) ? value : resolve(worktreePath, value);
};

const markerRanges = async (path: string): Promise<GitConflictFile["markerRanges"]> => {
	try {
		const lines = (await readFile(path, "utf8")).split("\n");
		const ranges: GitConflictFile["markerRanges"] = [];
		let start: number | null = null;
		for (let index = 0; index < lines.length; index += 1) {
			if (lines[index]?.startsWith("<<<<<<<")) start = index + 1;
			if (start !== null && lines[index]?.startsWith(">>>>>>>")) {
				const count = index + 1 - start + 1;
				ranges.push({ oldStart: start, oldLines: count, newStart: start, newLines: count });
				start = null;
			}
		}
		return ranges;
	} catch {
		return [];
	}
};

const parseUnmerged = (output: string): Map<string, GitConflictStage[]> => {
	const files = new Map<string, GitConflictStage[]>();
	for (const record of output.split("\0")) {
		if (!record) continue;
		const match = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/.exec(record);
		if (!match) continue;
		const [, mode, objectId, rawStage, path] = match;
		if (!mode || !objectId || !rawStage || !path) continue;
		const stage = Number(rawStage) as 1 | 2 | 3;
		const values = files.get(path) ?? [];
		values.push({ stage, mode, objectId, path });
		files.set(path, values);
	}
	return files;
};

export const createIntegrationGitAdapter = ({
	integrationRoot,
	git = createGitProcess(),
}: {
	integrationRoot: string;
	git?: GitProcess;
}): IntegrationGitAdapter => {
	const root = resolve(integrationRoot);
	const sessionDirectory = (sessionId: string): string => {
		const path = resolve(root, safeSessionId(sessionId));
		if (path !== root && !path.startsWith(`${root}/`)) throw new Error("Integration path escapes its root.");
		return path;
	};

	return {
		async resolveRef(repositoryPath, ref) {
			await git.assertSafeRef(ref);
			return (await git.run({ cwd: repositoryPath, args: ["rev-parse", "--verify", `${ref}^{commit}`] })).stdout.trim();
		},
		async captureFingerprint(worktreePath) {
			const [{ stdout: head }, { stdout: status }, indexPath] = await Promise.all([
				git.run({ cwd: worktreePath, args: ["rev-parse", "HEAD"] }),
				git.run({ cwd: worktreePath, args: ["status", "--porcelain=v2", "-z", "--untracked-files=all"] }),
				indexPathFor(git, worktreePath),
			]);
			const index = existsSync(indexPath) ? await readFile(indexPath) : Buffer.alloc(0);
			return createHash("sha256").update(head).update("\0").update(status).update("\0").update(index).digest("hex");
		},
		async createSyntheticSnapshot({ repositoryPath, worktreePath, targetCommitSha, sessionId, side }) {
			const directory = sessionDirectory(sessionId);
			const indexPath = join(directory, "indexes", `${side}.index`);
			await mkdir(dirname(indexPath), { recursive: true });
			await rm(indexPath, { force: true });
			const statusFingerprintBefore = await this.captureFingerprint(worktreePath);
			const originalHeadSha = (await git.run({ cwd: worktreePath, args: ["rev-parse", "HEAD"] })).stdout.trim();
			const mergeBaseSha = (await git.run({ cwd: repositoryPath, args: ["merge-base", targetCommitSha, originalHeadSha] })).stdout.trim();
			const env = { GIT_INDEX_FILE: indexPath };
			try {
				await git.run({ cwd: worktreePath, args: ["read-tree", originalHeadSha], env });
				await git.run({ cwd: worktreePath, args: ["add", "-A", "--", "."], env });
				const tree = (await git.run({ cwd: worktreePath, args: ["write-tree"], env })).stdout.trim();
				const syntheticCommitSha = (await git.run({
					cwd: repositoryPath,
					args: ["commit-tree", tree, "-p", originalHeadSha, "-m", `Agentic Worktrees integration snapshot ${sessionId}/${side}`],
					env: {
						GIT_AUTHOR_NAME: "Agentic Worktrees",
						GIT_AUTHOR_EMAIL: "integration@agentic-worktrees.local",
						GIT_COMMITTER_NAME: "Agentic Worktrees",
						GIT_COMMITTER_EMAIL: "integration@agentic-worktrees.local",
					},
				})).stdout.trim();
				const syntheticRef = `refs/agentic-worktrees/integration/${safeSessionId(sessionId)}/${side}`;
				await git.run({ cwd: repositoryPath, args: ["update-ref", syntheticRef, syntheticCommitSha] });
				const statusFingerprintAfter = await this.captureFingerprint(worktreePath);
				if (statusFingerprintAfter !== statusFingerprintBefore) {
					throw new Error(`Original worktree changed while capturing ${side} snapshot.`);
				}
				return {
					originalHeadSha,
					mergeBaseSha,
					syntheticCommitSha,
					syntheticRef,
					statusFingerprintBefore,
					statusFingerprintAfter,
				};
			} finally {
				await rm(indexPath, { force: true });
			}
		},
		async createIntegrationWorktree({ repositoryPath, targetCommitSha, sessionId }) {
			const directory = sessionDirectory(sessionId);
			const path = join(directory, "worktree");
			const branch = `agentic/integration/${safeSessionId(sessionId)}`;
			await mkdir(directory, { recursive: true });
			await git.run({ cwd: repositoryPath, args: ["worktree", "add", "-b", branch, path, targetCommitSha] });
			return { path, branch };
		},
		async mergeSynthetic(integrationPath, syntheticRef) {
			await git.assertSafeRef(syntheticRef);
			try {
				await git.run({ cwd: integrationPath, args: ["merge", "--no-ff", "--no-edit", syntheticRef] });
				const mergeCommitSha = (await git.run({ cwd: integrationPath, args: ["rev-parse", "HEAD"] })).stdout.trim();
				return { kind: "clean", files: [], mergeCommitSha };
			} catch (error) {
				if (!(error instanceof GitCommandError)) throw error;
				const files = await this.inspectConflicts(integrationPath);
				if (files.length === 0) throw error;
				return { kind: "conflict", files };
			}
		},
		async inspectConflicts(integrationPath) {
			const output = (await git.run({ cwd: integrationPath, args: ["ls-files", "-u", "-z"] })).stdout;
			const parsed = parseUnmerged(output);
			return Promise.all([...parsed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(async ([path, stages]) => ({
				path,
				stages: [...stages].sort((left, right) => left.stage - right.stage),
				markerRanges: await markerRanges(join(integrationPath, path)),
			})));
		},
		async removeIntegrationWorktree({ repositoryPath, path, branch }) {
			if (!resolve(path).startsWith(`${root}/`)) throw new Error("Integration cleanup path escapes its root.");
			if (existsSync(path)) await git.run({ cwd: repositoryPath, args: ["worktree", "remove", "--force", path] });
			try {
				await git.run({ cwd: repositoryPath, args: ["branch", "-D", branch] });
			} catch (error) {
				if (!(error instanceof GitCommandError) || !error.stderr.includes("not found")) throw error;
			}
			await rm(dirname(path), { recursive: true, force: true });
		},
		async deleteSyntheticRef(repositoryPath, syntheticRef) {
			await git.assertSafeRef(syntheticRef);
			try {
				await git.run({ cwd: repositoryPath, args: ["update-ref", "-d", syntheticRef] });
			} catch (error) {
				if (!(error instanceof GitCommandError)) throw error;
			}
		},
	};
};
