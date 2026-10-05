import Database from "better-sqlite3";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CapabilityRepository } from "../capabilities/capability-repository";
import { bootstrapSchemaSql } from "./bootstrap";
import { resolveCompatibleDatabasePath } from "./compatibility";

let root: string;
let source: Database.Database;
let sourcePath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "database-compatibility-"));
  await mkdir(path.join(root, "data"));
  sourcePath = path.join(root, "data", "app.db");
  source = new Database(sourcePath);
  source.pragma("journal_mode = WAL");
  source.exec(bootstrapSchemaSql);
  source.exec(`INSERT INTO repositories (id, github_repo_id, owner_login, name, full_name, is_private, is_archived, clone_url, html_url, local_clone_status, created_at, updated_at)
    VALUES ('repo', 1, 'o', 'r', 'o/r', 0, 0, '', '', 'ready', 1, 1);
    INSERT INTO worktrees (id, repository_id, name, path, branch_name, status, created_at, updated_at)
    VALUES ('wt', 'repo', 'wt', '/tmp/wt', 'main', 'ready', 1, 1);`);
  source.exec(`INSERT INTO runs (id, repository_id, worktree_id, title, prompt, status, created_at, updated_at)
    VALUES ('run-1', 'repo', 'wt', 'Saved chat', '', 'idle', 1, 1)`);
});

afterEach(async () => {
  source.close();
  await rm(root, { recursive: true, force: true });
});

const installCutoverGuards = () => {
  source.exec(`CREATE TABLE worktree_assignment_migrations (migration_key TEXT PRIMARY KEY, status TEXT);
    INSERT INTO worktree_assignment_migrations VALUES ('worktree-resource-release-v1', 'verified');`);
  for (const table of ["session_capabilities", "worktree_capabilities", "skill_invocations"]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      source.exec(`CREATE TRIGGER ${table}_resource_read_only_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table}
        WHEN EXISTS (SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1' AND status='verified')
        BEGIN SELECT RAISE(ABORT,'legacy_resource_read_only'); END`);
    }
  }
};

const activation = { runId: "run-1", capabilityId: "search", version: "1", to: "pending_activation" as const };

it("uses the existing database when it has no resource cutover guards", async () => {
  expect(await resolveCompatibleDatabasePath(root)).toBe(sourcePath);
});

it("keeps the default path for a fresh installation", async () => {
  expect(await resolveCompatibleDatabasePath(path.join(root, "new-installation")))
    .toBe(path.join(root, "new-installation", "data", "app.db"));
});

it("activates and deactivates capabilities in a preserved snapshot of a cutover database", async () => {
  installCutoverGuards();
  const original = new CapabilityRepository(source);
  expect(() => original.transitionSessionCapability(activation)).toThrow("legacy_resource_read_only");

  const compatiblePath = await resolveCompatibleDatabasePath(root);
  expect(compatiblePath).not.toBe(sourcePath);
  const compatible = new Database(compatiblePath);
  try {
    expect(compatible.prepare("SELECT title FROM runs WHERE id='run-1'").get()).toEqual({ title: "Saved chat" });
    const repository = new CapabilityRepository(compatible);
    expect(repository.transitionSessionCapability(activation).status).toBe("pending_activation");
    expect(repository.transitionSessionCapability({ ...activation, to: "active" }).status).toBe("active");
    repository.transitionSessionCapability({ ...activation, to: "pending_deactivation" });
    expect(repository.transitionSessionCapability({ ...activation, to: "inactive" }).status).toBe("inactive");
    repository.restoreSessionCapabilities({ capabilityId: "search", records: [] });
    expect(repository.listSessionCapabilities("run-1")).toEqual([]);
    expect(() => original.transitionSessionCapability(activation)).toThrow("legacy_resource_read_only");
    expect(source.prepare("SELECT status FROM worktree_assignment_migrations").get()).toEqual({ status: "verified" });
    expect(compatible.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).toEqual([]);
  } finally {
    compatible.close();
  }
});

it("reuses the compatible database without overwriting later changes", async () => {
  installCutoverGuards();
  const firstPath = await resolveCompatibleDatabasePath(root);
  const compatible = new Database(firstPath);
  compatible.prepare("UPDATE runs SET title='Edited chat' WHERE id='run-1'").run();
  compatible.close();
  expect(await resolveCompatibleDatabasePath(root)).toBe(firstPath);
  const reopened = new Database(firstPath);
  try {
    expect(reopened.prepare("SELECT title FROM runs WHERE id='run-1'").get()).toEqual({ title: "Edited chat" });
    expect(source.prepare("SELECT title FROM runs WHERE id='run-1'").get()).toEqual({ title: "Saved chat" });
  } finally {
    reopened.close();
  }
});

it("preserves unrelated database constraints in the compatible snapshot", async () => {
  installCutoverGuards();
  source.exec("CREATE TRIGGER unrelated_guard BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT,'unrelated_constraint'); END");
  const compatible = new Database(await resolveCompatibleDatabasePath(root));
  try {
    expect(() => compatible.exec("UPDATE runs SET title='Changed'")).toThrow("unrelated_constraint");
    expect(() => new CapabilityRepository(compatible).transitionSessionCapability(activation)).not.toThrow();
  } finally {
    compatible.close();
  }
});

it("publishes one complete snapshot when startup requests overlap", async () => {
  installCutoverGuards();
  const [first, second] = await Promise.all([
    resolveCompatibleDatabasePath(root),
    resolveCompatibleDatabasePath(root),
  ]);
  expect(first).toBe(second);
  const compatible = new Database(first);
  try {
    expect(() => new CapabilityRepository(compatible).transitionSessionCapability(activation)).not.toThrow();
    expect(() => new CapabilityRepository(source).transitionSessionCapability(activation)).toThrow("legacy_resource_read_only");
  } finally {
    compatible.close();
  }
});
