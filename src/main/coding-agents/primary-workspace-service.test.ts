import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../shared/db/schema";
import { repositories, worktrees } from "../../shared/db/schema";
import { bootstrapSchemaSql } from "../database/bootstrap";

type AppDatabase = BetterSQLite3Database<typeof schema>;

const mocks = vi.hoisted(() => ({ database: null as AppDatabase | null }));

vi.mock("../database/client", () => ({
	getDatabase: () => {
		if (!mocks.database) throw new Error("Test database is not initialized.");
		return mocks.database;
	},
}));

import {
	getPrimaryWorkspaceId,
	revalidatePrimaryWorkspace,
	synchronizePrimaryWorkspaces,
} from "./primary-workspace-service";

let sqlite: BetterSqlite3.Database;
let repositoryPath: string;

const seedRepository = (localRootPath: string): void => {
	const now = new Date(0);
	mocks.database?.insert(repositories).values({
		id: "repository-1",
		githubRepoId: 1,
		ownerLogin: "owner",
		name: "repository",
		fullName: "owner/repository",
		defaultBranch: "main",
		isPrivate: false,
		isArchived: false,
		cloneUrl: `file://${localRootPath}`,
		sshUrl: null,
		htmlUrl: "",
		localRootPath,
		localCloneStatus: "cloned",
		lastLocalScanAt: now,
		createdAt: now,
		updatedAt: now,
		lastSyncedAt: now,
	}).run();
};

beforeEach(async () => {
	sqlite = new BetterSqlite3(":memory:");
	sqlite.exec(bootstrapSchemaSql);
	mocks.database = drizzle(sqlite, { schema });
	repositoryPath = realpathSync(
		mkdtempSync(path.join(tmpdir(), "primary-workspace-")),
	);
	const git = simpleGit(repositoryPath);
	await git.init(["--initial-branch=main"]);
	await git.addConfig("user.name", "Test User");
	await git.addConfig("user.email", "test@example.com");
	writeFileSync(path.join(repositoryPath, "README.md"), "test\n");
	await git.add("README.md");
	await git.commit("initial");
});

afterEach(() => {
	mocks.database = null;
	sqlite.close();
	rmSync(repositoryPath, { recursive: true, force: true });
});

describe("primary workspace service", () => {
	it("persists and refreshes one primary workspace for a valid checkout", async () => {
		seedRepository(repositoryPath);

		const first = await synchronizePrimaryWorkspaces();
		expect(first[0]?.worktree).toMatchObject({
			id: getPrimaryWorkspaceId("repository-1"),
			kind: "primary",
			name: "Main checkout",
			path: repositoryPath,
			branchName: "main",
		});

		await simpleGit(repositoryPath).checkoutLocalBranch("feature/direct-chat");
		const second = await synchronizePrimaryWorkspaces();
		expect(second[0]?.worktree.branchName).toBe("feature/direct-chat");
		expect(
			mocks.database?.select().from(worktrees).all(),
		).toHaveLength(1);
	});

	it("omits invalid repository paths", async () => {
		seedRepository(path.join(repositoryPath, "missing"));
		expect(await synchronizePrimaryWorkspaces()).toEqual([]);
	});

	it("rejects a primary checkout that becomes unavailable", async () => {
		seedRepository(repositoryPath);
		const [context] = await synchronizePrimaryWorkspaces();
		if (!context) throw new Error("Primary workspace fixture is unavailable.");
		rmSync(repositoryPath, { recursive: true, force: true });

		await expect(
			revalidatePrimaryWorkspace(context.worktree.id),
		).rejects.toThrow("Primary checkout is unavailable for repository: repository-1");
	});
});
