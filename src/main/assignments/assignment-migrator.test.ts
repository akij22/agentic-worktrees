import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { AssignmentMigrator } from "./assignment-migrator";

describe("AssignmentMigrator", () => {
  let sqlite: BetterSqlite3.Database;
  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:"); sqlite.pragma("foreign_keys = ON"); sqlite.exec(bootstrapSchemaSql);
    sqlite.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);
      INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/tmp/w','main','primary','ready',1,1);`);
  });
  afterEach(() => sqlite.close());

  it("creates one deterministic empty revision-zero baseline and reruns idempotently", () => {
    const migrator = new AssignmentMigrator(sqlite);
    expect(migrator.runInitialMigration(new Date("2026-09-15T10:00:00.000Z"))).toEqual({ kind: "migrated", worktreeCount: 1, generationCount: 1, resourceVersionCount: 0 });
    expect(sqlite.prepare("SELECT revision,phase,desired_generation_id desired,verified_generation_id verified FROM worktree_assignments WHERE worktree_id='wt'").get()).toMatchObject({ revision: 0, phase: "stable", desired: "worktree-resource-assignment-v1:wt", verified: "worktree-resource-assignment-v1:wt" });
    expect(sqlite.prepare("SELECT status,worktree_count worktreeCount,generation_count generationCount FROM worktree_assignment_migrations").get()).toEqual({ status: "verified", worktreeCount: 1, generationCount: 1 });
    expect(migrator.runInitialMigration()).toEqual({ kind: "already_verified", worktreeCount: 1, generationCount: 1, resourceVersionCount: 0 });
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignment_generations").get()).toEqual({ count: 1 });
    const outbox = sqlite.prepare("SELECT revision,projection_sequence sequence,safe_payload_json payload FROM worktree_assignment_outbox").get() as { revision: number; sequence: number; payload: string };
    expect(outbox).toMatchObject({ revision: 0, sequence: 0 });
    expect(JSON.parse(outbox.payload)).toMatchObject({ worktreeId: "wt", revision: "0", projectionSequence: "0", phase: "stable", resources: [] });
  });

  it("migrates the exact union of active Capabilities and deduplicates overlapping sessions", () => {
    const hex = (character: string) => `sha256:${character.repeat(64)}`;
    sqlite.prepare("INSERT INTO capability_installations (capability_id,version,permission_digest,configured,created_at,updated_at) VALUES ('search','1',?,1,1,1)").run(hex("a"));
    const insertRun = sqlite.prepare("INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES (?,'repo','wt','t','legacy prompt','running','idle',0,1,1)");
    insertRun.run("run-1"); insertRun.run("run-2");
    const insertCapability = sqlite.prepare("INSERT INTO session_capabilities (id,run_id,capability_id,version,status,created_at,updated_at) VALUES (?,?,'search','1','active',1,1)");
    insertCapability.run("sc-1", "run-1"); insertCapability.run("sc-2", "run-2");
    const catalog = { resolve: () => ({ resourceKind: "capability" as const, resourceId: "search", name: "Search", description: "Search capability", version: "1", contentDigest: hex("b"), securityDigest: hex("c"), permissionDigest: hex("a"), configurationDigest: hex("d"), invocationPolicyDigest: hex("e"), providers: [
      { agentKind: "codex" as const, availability: "compatible" as const, skillIsolation: "not_applicable" as const, qualificationDigest: hex("f"), expectedStateDigest: hex("1") },
      { agentKind: "opencode" as const, availability: "compatible" as const, skillIsolation: "not_applicable" as const, qualificationDigest: hex("2"), expectedStateDigest: hex("3") },
    ] }) };
    expect(new AssignmentMigrator(sqlite, catalog).runInitialMigration()).toMatchObject({ kind: "migrated", resourceVersionCount: 1 });
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignment_generation_resources").get()).toEqual({ count: 1 });
    const payload = sqlite.prepare("SELECT safe_payload_json payload FROM worktree_assignment_outbox").get() as { payload: string };
    expect(JSON.parse(payload.payload).resources).toMatchObject([{ kind: "capability", id: "search", desired: true, verified: true, skillIsolation: "not_applicable" }]);
    expect(payload.payload).not.toContain("legacy prompt");
  });

  it("materializes usable Skills through exact canonical descriptors", () => {
    const hex = (character: string) => `sha256:${character.repeat(64)}`;
    sqlite.prepare(`INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,codex_compatibility,opencode_compatibility,automatic_invocation,state,created_at,updated_at) VALUES ('skill','1','official','ref',?,'Skill','Description','supported','unsupported',0,'installed',1,1)`).run(hex("a"));
    const catalog = { resolve: () => ({ resourceKind: "skill" as const, resourceId: "skill", name: "Skill", description: "Description", version: "1", contentDigest: hex("a"), securityDigest: hex("b"), configurationDigest: hex("c"), invocationPolicyDigest: hex("d"), providers: [
      { agentKind: "codex" as const, availability: "compatible" as const, skillIsolation: "not_enforced" as const, qualificationDigest: hex("e"), expectedStateDigest: hex("f") },
      { agentKind: "opencode" as const, availability: "unavailable" as const, skillIsolation: "enforced" as const, qualificationDigest: hex("1"), expectedStateDigest: hex("2") },
    ] }) };
    expect(new AssignmentMigrator(sqlite, catalog).runInitialMigration()).toMatchObject({ kind: "migrated", resourceVersionCount: 1 });
    expect(sqlite.prepare("SELECT resource_kind resourceKind,resource_id resourceId,version FROM resource_versions").get()).toEqual({ resourceKind: "skill", resourceId: "skill", version: "1" });
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignment_generation_resources").get()).toEqual({ count: 1 });
    expect(sqlite.prepare("SELECT agent_kind agentKind,availability,skill_isolation skillIsolation FROM worktree_assignment_generation_resource_providers ORDER BY agent_kind").all()).toEqual([
      { agentKind: "codex", availability: "compatible", skillIsolation: "not_enforced" },
      { agentKind: "opencode", availability: "unavailable", skillIsolation: "enforced" },
    ]);
  });

  it("resumes deterministically after interruption following the applying journal", () => {
    const interrupted = new AssignmentMigrator(sqlite, undefined, () => { throw new Error("simulated crash"); });
    expect(() => interrupted.runInitialMigration(new Date("2026-09-15T10:00:00.000Z"))).toThrow(/simulated crash/);
    expect(sqlite.prepare("SELECT status FROM worktree_assignment_migrations").get()).toEqual({ status: "applying" });
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignments").get()).toEqual({ count: 0 });
    expect(new AssignmentMigrator(sqlite).runInitialMigration(new Date("2026-09-15T10:01:00.000Z"))).toMatchObject({ kind: "migrated" });
    expect(sqlite.prepare("SELECT status FROM worktree_assignment_migrations").get()).toEqual({ status: "verified" });
  });

  it("fails globally before creating authoritative aggregates when legacy Resources need preflight", () => {
    sqlite.exec(`INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,codex_compatibility,opencode_compatibility,automatic_invocation,state,created_at,updated_at) VALUES ('skill','1','official','ref','sha256:test','Skill','Description','compatible','compatible',0,'installed',1,1)`);
    expect(() => new AssignmentMigrator(sqlite).runInitialMigration()).toThrow(/preflight/i);
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignments").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT status,failure_code failureCode FROM worktree_assignment_migrations").get()).toEqual({ status: "failed", failureCode: "migration_skill_metadata_invalid" });
  });

  it("fails closed while a legacy Capability is in a transitional state", () => {
    sqlite.exec(`INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','legacy prompt','running','idle',0,1,1);
      INSERT INTO session_capabilities (id,run_id,capability_id,version,status,created_at,updated_at) VALUES ('session-cap','run','search','1','pending_activation',1,1);`);
    expect(() => new AssignmentMigrator(sqlite).runInitialMigration()).toThrow(/migration_capability_transitional/);
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignments").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT failure_code failureCode FROM worktree_assignment_migrations").get()).toEqual({ failureCode: "migration_capability_transitional" });
  });
});
