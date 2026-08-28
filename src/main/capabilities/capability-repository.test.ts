import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { CapabilityRepository } from "./capability-repository";

describe("CapabilityRepository", () => {
  let sqlite: BetterSqlite3.Database;
  let repository: CapabilityRepository;
  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(bootstrapSchemaSql);
    const now = Date.now();
    sqlite.prepare(`INSERT INTO repositories (id, github_repo_id, owner_login, name, full_name, is_private, is_archived, clone_url, html_url, local_clone_status, created_at, updated_at) VALUES ('repo', 1, 'o', 'r', 'o/r', 0, 0, '', '', 'ready', ?, ?)` ).run(now, now);
    sqlite.prepare(`INSERT INTO worktrees (id, repository_id, name, path, branch_name, status, created_at, updated_at) VALUES ('wt', 'repo', 'wt', '/tmp/wt', 'main', 'ready', ?, ?)` ).run(now, now);
    sqlite.prepare(`INSERT INTO runs (id, repository_id, worktree_id, title, prompt, status, created_at, updated_at) VALUES ('run-1', 'repo', 'wt', 'Run', '', 'idle', ?, ?)` ).run(now, now);
    repository = new CapabilityRepository(sqlite);
  });
  afterEach(() => sqlite.close());

  it("persists configuration and replaces settings transactionally", () => {
    repository.upsertInstallation({ capabilityId: "agentic-worktrees.web-search", version: "0.1.0", permissionDigest: "digest", configured: true });
    expect(repository.replaceSettings("agentic-worktrees.web-search", [{ key: "resultLimit", value: 5 }, { key: "exaApiKey", secretRef: "opaque" }])).toEqual([{ key: "exaApiKey", secretRef: "opaque" }, { key: "resultLimit", value: 5 }]);
    expect(repository.getInstallation("agentic-worktrees.web-search")).toMatchObject({ configured: true });
  });

  it("guards session transitions and lists interrupted records", () => {
    const pending = repository.transitionSessionCapability({ runId: "run-1", capabilityId: "agentic-worktrees.web-search", version: "0.1.0", to: "pending_activation" });
    expect(pending.status).toBe("pending_activation");
    expect(repository.listInterruptedSessionCapabilities()).toHaveLength(1);
    const active = repository.transitionSessionCapability({ runId: "run-1", capabilityId: "agentic-worktrees.web-search", version: "0.1.0", to: "active" });
    expect(active.activatedAt).toBeInstanceOf(Date);
    expect(repository.listActiveSessionCapabilities()).toHaveLength(1);
    expect(() => repository.transitionSessionCapability({ runId: "run-1", capabilityId: "agentic-worktrees.web-search", version: "0.1.0", to: "inactive" })).toThrow("active -> inactive");
  });

  it("cascades session capability rows with runs", () => {
    repository.transitionSessionCapability({ runId: "run-1", capabilityId: "agentic-worktrees.web-search", version: "0.1.0", to: "pending_activation" });
    sqlite.prepare("DELETE FROM runs WHERE id = 'run-1'").run();
    expect(repository.listSessionCapabilities("run-1")).toEqual([]);
  });
});
