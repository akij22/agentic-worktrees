import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "./bootstrap";
import { applyDatabaseUpgrades } from "./index";

describe("database upgrades", () => {
	let sqlite: BetterSqlite3.Database;

	beforeEach(() => {
		sqlite = new BetterSqlite3(":memory:");
	});

	afterEach(() => {
		sqlite.close();
	});

	it("bootstraps normalized intelligence and conflict-resolution tables", () => {
		sqlite.exec(bootstrapSchemaSql);

		const tables = sqlite
			.prepare(
				`SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND (name LIKE 'intelligence_%' OR name LIKE 'conflict_resolution_%')`,
			)
			.all() as Array<{ name: string }>;
		expect(tables.map(({ name }) => name).sort()).toEqual([
			"conflict_resolution_files",
			"conflict_resolution_operations",
			"conflict_resolution_participants",
			"conflict_resolution_sessions",
			"intelligence_changed_files",
			"intelligence_changed_symbols",
			"intelligence_overlap_targets",
			"intelligence_overlaps",
			"intelligence_snapshots",
			"intelligence_worktrees",
		]);
	});

	it("bootstraps capability configuration and session tables", () => {
		sqlite.exec(bootstrapSchemaSql);
		const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'capability%' OR name LIKE 'session_capabilit%') ORDER BY name`).all() as Array<{ name: string }>;
		expect(tables.map(({ name }) => name)).toEqual([
			"capability_installations",
			"capability_settings",
			"session_capabilities",
		]);
	});

	it("bootstraps Assignment and Resource activity persistence tables", () => {
		sqlite.exec(bootstrapSchemaSql);
		const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND (
			name LIKE 'resource_%' OR name LIKE 'worktree_assignment_%' OR name LIKE 'worktree_runtime_%'
		) ORDER BY name`).all() as Array<{ name: string }>;
		expect(tables.map(({ name }) => name)).toEqual([
			"resource_activity",
			"resource_activity_evidence",
			"resource_activity_outbox",
			"resource_activity_session_routes",
			"resource_activity_streams",
			"resource_distribution_operation_worktrees",
			"resource_distribution_operations",
			"resource_evidence_coverage",
			"resource_versions",
			"worktree_assignment_attempt_participants",
			"worktree_assignment_attempts",
			"worktree_assignment_generation_resource_providers",
			"worktree_assignment_generation_resources",
			"worktree_assignment_generations",
			"worktree_assignment_migrations",
			"worktree_assignment_outbox",
			"worktree_assignments",
			"worktree_runtime_assignment_attestations",
			"worktree_runtime_catalog_generations",
		]);
	});

	it("rejects invalid Assignment lifecycle enums at the database boundary", () => {
		sqlite.exec(bootstrapSchemaSql);
		expect(() => sqlite.prepare(`INSERT INTO resource_distribution_operations
			(id,resource_kind,resource_id,status,side_effect_boundary,started_at,updated_at)
			VALUES ('operation-1','capability','search','invented','none',1,1)`).run()).toThrow();
		expect(() => sqlite.prepare(`INSERT INTO worktree_assignment_migrations
			(migration_key,status,source_fingerprint,worktree_count,resource_version_count,generation_count)
			VALUES ('migration-1','invented','sha256:test',0,0,0)`).run()).toThrow();
	});

	it("enforces one active distribution operation per Resource", () => {
		sqlite.exec(bootstrapSchemaSql);
		const insert = sqlite.prepare(`INSERT INTO resource_distribution_operations
			(id,resource_kind,resource_id,status,side_effect_boundary,started_at,updated_at,completed_at)
			VALUES (?,?,?,?,?,?,?,?)`);
		insert.run("operation-1", "capability", "search", "applying", "staged", 1, 1, null);
		expect(() => insert.run("operation-2", "capability", "search", "waiting_for_idle", "none", 1, 1, null)).toThrow();
		insert.run("operation-3", "skill", "search", "verified", "commit_pending", 1, 1, 2);
		insert.run("operation-4", "skill", "search", "verified", "commit_pending", 1, 1, 2);
	});

	it("bootstraps managed package lifecycle tables and indexes", () => {
		sqlite.exec(bootstrapSchemaSql);
		const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'managed_package_%' ORDER BY name`).all() as Array<{ name: string }>;
		expect(tables.map(({ name }) => name)).toEqual([
			"managed_package_installations",
			"managed_package_operations",
			"managed_package_removal_recoveries",
			"managed_package_update_recoveries",
		]);
		const indexes = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'managed_package_%' ORDER BY name`).all() as Array<{ name: string }>;
		expect(indexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
			"managed_package_installations_item_unique",
			"managed_package_operations_stage_idx",
			"managed_package_operations_status_idx",
		]));
	});

	it("adds managed package tables to databases that predate migrations", () => {
		sqlite.exec("CREATE TABLE worktrees (id TEXT PRIMARY KEY NOT NULL)");
		applyDatabaseUpgrades(sqlite);
		expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_package_installations'`).get()).toEqual({ name: "managed_package_installations" });
	});

	it("adds last_viewed_at to an existing coding-agent session table", () => {
		sqlite.exec(`
      CREATE TABLE coding_agent_sessions (
        run_id TEXT PRIMARY KEY NOT NULL
      );
      INSERT INTO coding_agent_sessions (run_id) VALUES ('run-1');
    `);

		applyDatabaseUpgrades(sqlite);

		const columns = sqlite
			.prepare("PRAGMA table_info(coding_agent_sessions)")
			.all() as Array<{ name: string }>;
		expect(columns.map(({ name }) => name)).toContain("last_viewed_at");
		expect(
			sqlite
				.prepare(
					"SELECT run_id, last_viewed_at FROM coding_agent_sessions WHERE run_id = ?",
				)
				.get("run-1"),
		).toEqual({ run_id: "run-1", last_viewed_at: null });
	});

	it("marks existing worktrees as linked when adding the kind column", () => {
		sqlite.exec(`
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY NOT NULL
      );
      INSERT INTO worktrees (id) VALUES ('worktree-1');
    `);

		applyDatabaseUpgrades(sqlite);

		expect(
			sqlite.prepare("SELECT id, kind FROM worktrees WHERE id = ?").get("worktree-1"),
		).toEqual({ id: "worktree-1", kind: "linked" });
	});
});
