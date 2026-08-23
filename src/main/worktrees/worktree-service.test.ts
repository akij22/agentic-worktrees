import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
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
	getWorktreeById,
	listAllWorktrees,
	listWorktreesForRepository,
} from "./worktree-service";

let sqlite: BetterSqlite3.Database;

beforeEach(() => {
	sqlite = new BetterSqlite3(":memory:");
	sqlite.exec(bootstrapSchemaSql);
	mocks.database = drizzle(sqlite, { schema });
	const now = new Date(0);
	mocks.database
		.insert(repositories)
		.values({
			id: "repository-1",
			githubRepoId: 1,
			ownerLogin: "owner",
			name: "repository",
			fullName: "owner/repository",
			defaultBranch: "main",
			isPrivate: false,
			isArchived: false,
			cloneUrl: "file:///repository",
			sshUrl: null,
			htmlUrl: "",
			localRootPath: "/repository",
			localCloneStatus: "cloned",
			lastLocalScanAt: now,
			createdAt: now,
			updatedAt: now,
			lastSyncedAt: now,
		})
		.run();
	mocks.database
		.insert(worktrees)
		.values([
			{
				id: "primary-1",
				repositoryId: "repository-1",
				name: "Main checkout",
				path: "/repository",
				branchName: "main",
				kind: "primary",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "linked-1",
				repositoryId: "repository-1",
				name: "feature",
				path: "/repository.worktrees/feature",
				branchName: "feature",
				kind: "linked",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			},
		])
		.run();
});

afterEach(() => {
	mocks.database = null;
	sqlite.close();
});

describe("worktree service", () => {
	it("keeps primary workspaces out of linked-worktree lists", () => {
		expect(listAllWorktrees().map(({ id }) => id)).toEqual(["linked-1"]);
		expect(
			listWorktreesForRepository("repository-1").map(({ id }) => id),
		).toEqual(["linked-1"]);
		expect(getWorktreeById("primary-1")?.kind).toBe("primary");
	});
});
