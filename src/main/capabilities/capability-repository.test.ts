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

  it("persists installation and settings in one transaction", () => {
    const installation = { capabilityId: "agentic-worktrees.web-search", version: "0.1.0", permissionDigest: "digest", configured: true };
    repository.saveConfiguration(installation, [{ key: "resultLimit", value: 5 }, { key: "exaApiKey", secretRef: "opaque" }]);
    expect(repository.getSettings(installation.capabilityId)).toEqual([{ key: "exaApiKey", secretRef: "opaque" }, { key: "resultLimit", value: 5 }]);
    expect(repository.getInstallation(installation.capabilityId)).toMatchObject({ configured: true });
  });

  it("rolls back the installation when replacing settings fails", () => {
    const capabilityId = "agentic-worktrees.web-search";
    repository.saveConfiguration({ capabilityId, version: "0.1.0", permissionDigest: "old", configured: false }, [{ key: "providerMode", value: "auto" }]);
    sqlite.exec(`CREATE TRIGGER reject_result_limit BEFORE INSERT ON capability_settings WHEN NEW.key = 'resultLimit' BEGIN SELECT RAISE(ABORT, 'rejected'); END;`);
    expect(() => repository.saveConfiguration(
      { capabilityId, version: "0.2.0", permissionDigest: "new", configured: true },
      [{ key: "resultLimit", value: 5 }],
    )).toThrow();
    expect(repository.getInstallation(capabilityId)).toMatchObject({ version: "0.1.0", permissionDigest: "old", configured: false });
    expect(repository.getSettings(capabilityId)).toEqual([{ key: "providerMode", value: "auto" }]);
  });

  it("rejects corrupt stored setting JSON with a safe error", () => {
    repository.upsertInstallation({ capabilityId: "agentic-worktrees.web-search", version: "0.1.0", permissionDigest: "digest", configured: true });
    sqlite.prepare("INSERT INTO capability_settings (id, capability_id, key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("bad-setting", "agentic-worktrees.web-search", "resultLimit", "{sensitive-corrupt-value", Date.now(), Date.now());
    expect(() => repository.getSettings("agentic-worktrees.web-search")).toThrow("Stored capability settings are invalid.");
    try {
      repository.getSettings("agentic-worktrees.web-search");
    } catch (error) {
      expect(String(error)).not.toContain("sensitive-corrupt-value");
    }
  });

  it("rejects stored setting JSON with a non-scalar value", () => {
    repository.upsertInstallation({ capabilityId: "agentic-worktrees.web-search", version: "0.1.0", permissionDigest: "digest", configured: true });
    sqlite.prepare("INSERT INTO capability_settings (id, capability_id, key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("object-setting", "agentic-worktrees.web-search", "resultLimit", "{}", Date.now(), Date.now());
    expect(() => repository.getSettings("agentic-worktrees.web-search")).toThrow("Stored capability settings are invalid.");
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
