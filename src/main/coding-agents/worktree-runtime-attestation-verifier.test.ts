import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { DatabaseRuntimeAttestationVerifier } from "./worktree-runtime-attestation-verifier";

describe("DatabaseRuntimeAttestationVerifier", () => {
  const databases: BetterSqlite3.Database[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  it("accepts only a non-invalidated attestation matching the current verified Assignment", async () => {
    const database = new BetterSqlite3(":memory:");
    databases.push(database);
    database.pragma("foreign_keys = ON");
    database.exec(bootstrapSchemaSql);
    database.exec(`
      INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at)
      VALUES ('repo',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1);
      INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at)
      VALUES ('worktree','repo','main','/tmp/repo','main','primary','ready',1,1);
      INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at)
      VALUES ('assignment','worktree',0,'digest',1);
      INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at)
      VALUES ('worktree',0,0,'stable','assignment','assignment',1,1);
      INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at)
      VALUES ('catalog','worktree','codex','assignment','1.0.0',1,'digest',1);
      INSERT INTO worktree_runtime_assignment_attestations
      (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at)
      VALUES ('worktree','codex','runtime-1','assignment','catalog','1.0.0','digest',1);
    `);
    const verifier = new DatabaseRuntimeAttestationVerifier(database);
    const exact = {
      agentKind: "codex" as const,
      worktreeId: "worktree",
      runtimeGeneration: "runtime-1",
      providerVersion: "1.0.0",
      assignmentGenerationId: "assignment",
      catalogGenerationId: "catalog",
    };

    await expect(verifier.verify(exact)).resolves.toBe(true);
    await expect(verifier.verify({ ...exact, catalogGenerationId: "other" })).resolves.toBe(false);
    database.prepare("UPDATE worktree_assignments SET phase='recovery_required'").run();
    await expect(verifier.verify(exact)).resolves.toBe(false);
    database.prepare("UPDATE worktree_assignments SET phase='stable'").run();
    verifier.invalidate({ worktreeId: "worktree", agentKind: "codex", runtimeGeneration: "runtime-1" });
    await expect(verifier.verify(exact)).resolves.toBe(false);
  });
});
