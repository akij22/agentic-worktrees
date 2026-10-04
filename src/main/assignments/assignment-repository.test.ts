import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { AssignmentRepository } from "./assignment-repository";

const projection = (revision: string, sequence: string) => ({
  worktreeId: "worktree-1", revision, projectionSequence: sequence,
  phase: "waiting_for_idle" as const, currentAgentKind: "codex" as const,
  resources: [], blockers: [], progress: null,
  admission: { canCreateSession: false, canResumeSession: false, canSend: false, reason: "assignment_busy" as const, message: "Resource changes are waiting." },
  allowedActions: ["cancel_pending" as const], failure: null,
  updatedAt: "2026-09-15T10:00:00.000Z",
});

describe("AssignmentRepository.compareAndSetDesired", () => {
  let sqlite: BetterSqlite3.Database;
  let repository: AssignmentRepository;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(bootstrapSchemaSql);
    sqlite.prepare(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo-1',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1)`).run();
    sqlite.prepare(`INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('worktree-1','repo-1','main','/tmp/repo','main','primary','ready',1,1)`).run();
    const insertGeneration = sqlite.prepare(`INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,?,?,1)`);
    insertGeneration.run("generation-1", "worktree-1", 0, "sha256:one");
    insertGeneration.run("generation-2", "worktree-1", 1, "sha256:two");
    sqlite.prepare(`INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES ('worktree-1',0,0,'stable','generation-1','generation-1',1,1)`).run();
    repository = new AssignmentRepository(sqlite);
  });

  afterEach(() => sqlite.close());

  it("atomically persists the desired generation, attempt, and ordered outbox event", () => {
    const result = repository.compareAndSetDesired({
      worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2",
      attemptId: "attempt-1", eventId: "event-1", now: new Date("2026-09-15T10:00:00.000Z"),
      projection: projection("1", "1"),
    });
    expect(result.kind).toBe("updated");
    expect(repository.getAggregate("worktree-1")).toMatchObject({ revision: "1", projectionSequence: "1", phase: "waiting_for_idle", desiredGenerationId: "generation-2", verifiedGenerationId: "generation-1" });
    expect(sqlite.prepare("SELECT id,status,side_effect_boundary sideEffectBoundary FROM worktree_assignment_attempts").get()).toEqual({ id: "attempt-1", status: "waiting_for_idle", sideEffectBoundary: "none" });
    expect(sqlite.prepare("SELECT event_id eventId,revision,projection_sequence projectionSequence FROM worktree_assignment_outbox").get()).toEqual({ eventId: "event-1", revision: 1, projectionSequence: 1 });
  });

  it("returns the current aggregate without writes for stale revision or identical desired state", () => {
    expect(repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "9", targetGenerationId: "generation-2", attemptId: "unused", eventId: "unused", now: new Date(), projection: projection("1", "1") }).kind).toBe("conflict");
    expect(repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-1", attemptId: "unused", eventId: "unused", now: new Date(), projection: projection("0", "0") }).kind).toBe("unchanged");
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignment_attempts").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT count(*) count FROM worktree_assignment_outbox").get()).toEqual({ count: 0 });
  });

  it("records participant transitions with exact runtime-generation compare-and-set", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-participant", eventId: "event", now: new Date(), projection: projection("1", "1") });
    sqlite.prepare(`INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('catalog-participant','worktree-1','codex','generation-2','1',1,'digest',1)`).run();
    sqlite.prepare(`INSERT INTO worktree_assignment_attempt_participants (attempt_id,agent_kind,runtime_generation,provider_version,target_catalog_generation_id,apply_order,state,target_effective_state_digest,updated_at) VALUES ('attempt-participant','codex','runtime','1','catalog-participant',0,'planned','digest',1)`).run();
    repository.recordParticipantTransition({ attemptId: "attempt-participant", agentKind: "codex", runtimeGeneration: "runtime", expectedState: "planned", nextState: "staged", now: new Date() });
    expect(sqlite.prepare("SELECT state FROM worktree_assignment_attempt_participants").get()).toEqual({ state: "staged" });
    expect(() => repository.recordParticipantTransition({ attemptId: "attempt-participant", agentKind: "codex", runtimeGeneration: "other", expectedState: "staged", nextState: "activated", now: new Date() })).toThrow(/compare-and-set/i);
  });

  it("registers and invalidates only attestations with exact verified lineage", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    sqlite.prepare(`INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('catalog-attestation','worktree-1','codex','generation-1','1',1,'digest',1)`).run();
    repository.registerRuntimeAttestation({ worktreeId: "worktree-1", agentKind: "codex", runtimeGeneration: "runtime", assignmentGenerationId: "generation-1", catalogGenerationId: "catalog-attestation", providerVersion: "1", effectiveStateDigest: digest, verifiedAt: new Date() });
    repository.invalidateRuntimeAttestation("worktree-1", "codex", "runtime", "runtime_unavailable", new Date());
    expect(sqlite.prepare("SELECT invalidation_code invalidationCode FROM worktree_runtime_assignment_attestations").get()).toEqual({ invalidationCode: "runtime_unavailable" });
    expect(() => repository.invalidateRuntimeAttestation("worktree-1", "codex", "runtime", "runtime_unavailable", new Date())).toThrow(/already invalidated/i);
  });

  it("lists unstable assignments and unpublished outbox work for startup reconciliation", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-startup", eventId: "event-startup", now: new Date(), projection: projection("1", "1") });
    expect(repository.listStartupReconciliation()).toMatchObject([{ worktreeId: "worktree-1", phase: "waiting_for_idle", attemptId: "attempt-startup", attemptStatus: "waiting_for_idle", unpublishedEvents: "1" }]);
  });

  it("commits a verified rollback while retaining the prior verified generation", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-rollback", eventId: "event-desired", now: new Date(), projection: projection("1", "1") });
    sqlite.prepare("UPDATE worktree_assignment_attempts SET status='rolling_back',side_effect_boundary='activated' WHERE id='attempt-rollback'").run();
    const failed = { ...projection("1", "2"), phase: "failed_rolled_back" as const, failure: { code: "assignment_apply_failed" as const, message: "Resources could not be applied." }, allowedActions: ["retry" as const, "revert_desired" as const] };
    expect(repository.commitVerifiedRollback({ attemptId: "attempt-rollback", eventId: "event-rollback", failureCode: "assignment_apply_failed", now: new Date(), projection: failed })).toMatchObject({ phase: "failed_rolled_back", desiredGenerationId: "generation-2", verifiedGenerationId: "generation-1" });
    expect(sqlite.prepare("SELECT status,completed_at completedAt FROM worktree_assignment_attempts WHERE id='attempt-rollback'").get()).toMatchObject({ status: "failed_rolled_back", completedAt: expect.any(Number) });
  });

  it("marks ambiguous effects recovery-required without guessing provider state", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-recovery", eventId: "event-desired", now: new Date(), projection: projection("1", "1") });
    sqlite.prepare("UPDATE worktree_assignment_attempts SET status='applying',side_effect_boundary='activated' WHERE id='attempt-recovery'").run();
    const recovery = { ...projection("1", "2"), phase: "recovery_required" as const, failure: { code: "assignment_recovery_required" as const, message: "Resource state requires recovery." }, allowedActions: ["retry_recovery" as const, "recreate_affected_runtimes" as const] };
    expect(repository.markRecoveryRequired({ attemptId: "attempt-recovery", eventId: "event-recovery", failureCode: "assignment_recovery_required", now: new Date(), projection: recovery })).toMatchObject({ phase: "recovery_required", verifiedGenerationId: "generation-1" });
    expect(sqlite.prepare("SELECT status,completed_at completedAt FROM worktree_assignment_attempts WHERE id='attempt-recovery'").get()).toEqual({ status: "recovery_required", completedAt: null });
  });

  it("commits a fully verified generation atomically", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-commit", eventId: "event-desired", now: new Date(), projection: projection("1", "1") });
    sqlite.prepare("UPDATE worktree_assignment_attempts SET status='applying',side_effect_boundary='commit_pending' WHERE id='attempt-commit'").run();
    sqlite.prepare("UPDATE worktree_assignments SET phase='applying' WHERE worktree_id='worktree-1'").run();
    const stable = { ...projection("1", "2"), phase: "stable" as const, admission: { canCreateSession: true, canResumeSession: true, canSend: true, reason: null, message: null }, allowedActions: [] };
    expect(repository.commitVerifiedGeneration({ attemptId: "attempt-commit", eventId: "event-verified", now: new Date(), projection: stable })).toMatchObject({ phase: "stable", desiredGenerationId: "generation-2", verifiedGenerationId: "generation-2", revision: "1", projectionSequence: "2" });
    expect(sqlite.prepare("SELECT status,completed_at completedAt FROM worktree_assignment_attempts WHERE id='attempt-commit'").get()).toMatchObject({ status: "verified", completedAt: expect.any(Number) });
    expect(repository.listPendingOutbox()).toHaveLength(2);
  });

  it("refuses verified commit while any participant is not verified", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-blocked", eventId: "event-desired", now: new Date(), projection: projection("1", "1") });
    sqlite.prepare("UPDATE worktree_assignment_attempts SET status='applying',side_effect_boundary='commit_pending' WHERE id='attempt-blocked'").run();
    sqlite.prepare(`INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('catalog','worktree-1','codex','generation-2','1',1,'digest',1)`).run();
    sqlite.prepare(`INSERT INTO worktree_assignment_attempt_participants (attempt_id,agent_kind,runtime_generation,provider_version,target_catalog_generation_id,apply_order,state,target_effective_state_digest,updated_at) VALUES ('attempt-blocked','codex','runtime','1','catalog',0,'activated','digest',1)`).run();
    const stable = { ...projection("1", "2"), phase: "stable" as const };
    expect(() => repository.commitVerifiedGeneration({ attemptId: "attempt-blocked", eventId: "event-verified", now: new Date(), projection: stable })).toThrow(/not verified/i);
    expect(repository.getAggregate("worktree-1")).toMatchObject({ verifiedGenerationId: "generation-1", projectionSequence: "1" });
  });

  it("advances an attempt and its renderer projection atomically without changing revision", () => {
    repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2", attemptId: "attempt-transition", eventId: "event-1", now: new Date(), projection: projection("1", "1") });
    const applying = { ...projection("1", "2"), phase: "applying" as const };
    expect(repository.advanceAttempt({ attemptId: "attempt-transition", expectedStatus: "waiting_for_idle", nextStatus: "applying", expectedBoundary: "none", nextBoundary: "staged", eventId: "event-2", now: new Date(), projection: applying })).toMatchObject({ revision: "1", projectionSequence: "2", phase: "applying" });
    expect(() => repository.advanceAttempt({ attemptId: "attempt-transition", expectedStatus: "waiting_for_idle", nextStatus: "applying", expectedBoundary: "none", nextBoundary: "staged", eventId: "event-3", now: new Date(), projection: { ...applying, projectionSequence: "3" } })).toThrow(/state changed/i);
    expect(repository.listPendingOutbox()).toHaveLength(2);
  });

  it("replays safe projections in sequence and acknowledges each event once", () => {
    repository.compareAndSetDesired({
      worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "generation-2",
      attemptId: "attempt-outbox", eventId: "event-outbox", now: new Date("2026-09-15T10:00:00.000Z"),
      projection: projection("1", "1"),
    });
    expect(repository.getProjection("worktree-1")).toEqual(projection("1", "1"));
    expect(repository.listPendingOutbox()).toMatchObject([{ eventId: "event-outbox", revision: "1", projectionSequence: "1" }]);
    repository.markOutboxPublished("event-outbox", new Date("2026-09-15T10:01:00.000Z"));
    expect(repository.listPendingOutbox()).toEqual([]);
    expect(() => repository.markOutboxPublished("event-outbox", new Date())).toThrow(/already published/i);
  });

  it("roundtrips revisions beyond JavaScript safe integer range without precision loss", () => {
    sqlite.prepare("UPDATE worktree_assignments SET revision=?, projection_sequence=? WHERE worktree_id='worktree-1'").run(9007199254740993n, 9007199254740995n);
    const result = repository.compareAndSetDesired({
      worktreeId: "worktree-1", expectedRevision: "9007199254740993", targetGenerationId: "generation-2",
      attemptId: "attempt-large", eventId: "event-large", now: new Date("2026-09-15T10:00:00.000Z"),
      projection: projection("9007199254740994", "9007199254740996"),
    });
    expect(result.kind).toBe("updated");
    expect(repository.getAggregate("worktree-1")).toMatchObject({ revision: "9007199254740994", projectionSequence: "9007199254740996" });
  });

  it("rejects a generation owned by another Worktree", () => {
    sqlite.prepare(`INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('worktree-2','repo-1','other','/tmp/other','other','linked','ready',1,1)`).run();
    sqlite.prepare(`INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES ('foreign-generation','worktree-2',0,'sha256:foreign',1)`).run();
    expect(() => repository.compareAndSetDesired({ worktreeId: "worktree-1", expectedRevision: "0", targetGenerationId: "foreign-generation", attemptId: "attempt", eventId: "event", now: new Date(), projection: projection("1", "1") })).toThrow(/generation ownership/i);
    expect(repository.getAggregate("worktree-1")?.revision).toBe("0");
  });
});
