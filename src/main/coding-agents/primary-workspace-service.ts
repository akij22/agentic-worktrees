import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { simpleGit } from "simple-git";
import { repositories, worktrees } from "../../shared/db/schema";
import { getDatabase } from "../database/client";

export interface AgentWorktreeContext {
	worktree: typeof worktrees.$inferSelect;
	repository: typeof repositories.$inferSelect;
}

type Repository = typeof repositories.$inferSelect;

type PrimaryWorkspaceMetadata = {
	path: string;
	branchName: string;
	headCommitSha: string | null;
};

export const getPrimaryWorkspaceId = (repositoryId: string): string =>
	`primary:${repositoryId}`;

const inspectPrimaryWorkspace = async (
	repository: Repository,
): Promise<PrimaryWorkspaceMetadata | null> => {
	if (!repository.localRootPath) return null;

	const configuredPath = path.resolve(repository.localRootPath);
	if (!existsSync(configuredPath)) return null;

	try {
		const repositoryPath = realpathSync(configuredPath);
		const git = simpleGit(repositoryPath);
		const [insideWorkTree, bareRepository, topLevel] = await Promise.all([
			git.revparse(["--is-inside-work-tree"]),
			git.revparse(["--is-bare-repository"]),
			git.revparse(["--show-toplevel"]),
		]);
		if (
			insideWorkTree.trim() !== "true" ||
			bareRepository.trim() === "true" ||
			realpathSync(path.resolve(topLevel.trim())) !== repositoryPath
		) {
			return null;
		}

		let branch: string;
		try {
			branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
		} catch {
			branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
		}
		let headCommitSha: string | null = null;
		try {
			headCommitSha = (await git.revparse(["HEAD"])).trim() || null;
		} catch {
			// A newly initialized checkout can be valid before its first commit.
		}

		return {
			path: repositoryPath,
			branchName: branch === "HEAD" ? "Detached HEAD" : branch,
			headCommitSha,
		};
	} catch {
		return null;
	}
};

const persistPrimaryWorkspace = (
	repository: Repository,
	metadata: PrimaryWorkspaceMetadata,
): AgentWorktreeContext => {
	const database = getDatabase();
	const now = new Date();
	const id = getPrimaryWorkspaceId(repository.id);
	database
		.insert(worktrees)
		.values({
			id,
			repositoryId: repository.id,
			name: "Main checkout",
			path: metadata.path,
			branchName: metadata.branchName,
			kind: "primary",
			baseBranchName: repository.defaultBranch,
			headCommitSha: metadata.headCommitSha,
			status: "ready",
			activeRunId: null,
			createdAt: now,
			updatedAt: now,
			lastSyncedAt: now,
		})
		.onConflictDoUpdate({
			target: worktrees.id,
			set: {
				path: metadata.path,
				branchName: metadata.branchName,
				kind: "primary",
				baseBranchName: repository.defaultBranch,
				headCommitSha: metadata.headCommitSha,
				status: "ready",
				updatedAt: now,
				lastSyncedAt: now,
			},
		})
		.run();

	const worktree = database
		.select()
		.from(worktrees)
		.where(eq(worktrees.id, id))
		.get();
	if (!worktree) {
		throw new Error(`Primary checkout could not be persisted: ${repository.id}`);
	}
	return { worktree, repository };
};

export const synchronizePrimaryWorkspaces = async (): Promise<
	AgentWorktreeContext[]
> => {
	const repositoryRows = getDatabase()
		.select()
		.from(repositories)
		.where(
			and(
				eq(repositories.isArchived, false),
				isNotNull(repositories.localRootPath),
			),
		)
		.all();
	const contexts: AgentWorktreeContext[] = [];

	for (const repository of repositoryRows) {
		const metadata = await inspectPrimaryWorkspace(repository);
		if (metadata) contexts.push(persistPrimaryWorkspace(repository, metadata));
	}

	return contexts;
};

export const revalidatePrimaryWorkspace = async (
	worktreeId: string,
): Promise<AgentWorktreeContext> => {
	const database = getDatabase();
	const row = database
		.select({ worktree: worktrees, repository: repositories })
		.from(worktrees)
		.innerJoin(repositories, eq(repositories.id, worktrees.repositoryId))
		.where(eq(worktrees.id, worktreeId))
		.get();
	if (!row || row.worktree.kind !== "primary") {
		throw new Error(`Primary checkout not found: ${worktreeId}`);
	}

	const metadata = await inspectPrimaryWorkspace(row.repository);
	if (!metadata) {
		throw new Error(
			`Primary checkout is unavailable for repository: ${row.repository.id}`,
		);
	}

	return persistPrimaryWorkspace(row.repository, metadata);
};
