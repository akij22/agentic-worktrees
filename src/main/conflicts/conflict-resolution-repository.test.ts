import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../shared/db/schema";
import { bootstrapSchemaSql } from "../database/bootstrap";
import type { PreparedConflictSession } from "./types";
import { createConflictResolutionRepository } from "./conflict-resolution-repository";

const now = 1_700_000_000_000;
const session = (): PreparedConflictSession => ({
	id: "session-1",
	repositoryId: "repository-1",
	snapshotId: "snapshot-1",
	overlapId: "overlap-1",
	targetBranch: "main",
	targetCommitSha: "target-sha",
	state: "simulating",
	classification: null,
	currentStage: "Simulating merge",
	integrationBranch: "agentic/integration/session-1",
	integrationPath: "/integration/session-1",
	retained: false,
	cleanupPending: false,
	errorMessage: null,
	participants: [
		{
			side: "left",
			worktreeId: "worktree-left",
			runId: "run-left",
			task: "Left task",
			agentName: "Codex",
			branch: "feat/left",
			originalHeadSha: "left-head",
			mergeBaseSha: "base",
			syntheticCommitSha: "left-snapshot",
			syntheticRef: "refs/agentic-worktrees/integration/session-1/left",
			statusFingerprintBefore: "before",
			statusFingerprintAfter: "before",
		},
	],
	files: [
		{
			path: "src/session.ts",
			kind: "semantic_overlap",
			risk: "high",
			reasonCode: "same-symbol",
			leftPath: "src/session.ts",
			rightPath: "src/session.ts",
			symbol: "createSession",
			staticRanges: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 }],
			gitStages: [],
			markerRanges: [],
		},
	],
	operations: [
		{
			id: "operation-1",
			sequence: 1,
			stage: "simulating",
			kind: "merge-left",
			commandSummary: "git merge synthetic-left",
			status: "succeeded",
			startedAt: now,
			completedAt: now + 1,
			outputSummary: "clean",
			errorMessage: null,
		},
	],
	createdAt: now,
	updatedAt: now + 1,
	completedAt: null,
});

let sqlite: BetterSqlite3.Database;

beforeEach(() => {
	sqlite = new BetterSqlite3(":memory:");
	sqlite.pragma("foreign_keys = ON");
	sqlite.exec(bootstrapSchemaSql);
	sqlite
		.prepare(`INSERT INTO repositories (
		id, github_repo_id, owner_login, name, full_name, default_branch,
		is_private, is_archived, clone_url, ssh_url, html_url,
		local_root_path, local_clone_status, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(
			"repository-1",
			1,
			"local",
			"repo",
			"local/repo",
			"main",
			0,
			0,
			"",
			null,
			"",
			"/repo",
			"ready",
			now,
			now,
		);
});

afterEach(() => sqlite.close());

describe("conflict resolution repository", () => {
	it("round trips normalized participants, files, and operations", () => {
		const repository = createConflictResolutionRepository(
			drizzle(sqlite, { schema }),
		);
		repository.createSession(session());

		expect(repository.getSession("session-1")).toEqual(session());
		expect(repository.listSessions("repository-1")).toEqual([session()]);
		expect(repository.findActive("repository-1", "overlap-1", "main")?.id).toBe(
			"session-1",
		);
	});

	it("rolls back a hierarchy replacement when a child insert fails", () => {
		const repository = createConflictResolutionRepository(
			drizzle(sqlite, { schema }),
		);
		repository.createSession(session());
		const invalid = session();
		invalid.currentStage = "Changed";
		invalid.operations = [
			invalid.operations[0],
			{ ...invalid.operations[0], id: "operation-2" },
		];

		expect(() => repository.saveSession(invalid)).toThrow();
		expect(repository.getSession("session-1")?.currentStage).toBe(
			"Simulating merge",
		);
	});
});
