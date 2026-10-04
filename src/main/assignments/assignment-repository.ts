import type BetterSqlite3 from "better-sqlite3";
import { assignmentErrorCodeSchema, assignmentProjectionSchema, type AssignmentProjectionDto } from "../../shared/assignments";
import { getSqlite } from "../database/client";

export type AssignmentAggregateRecord = {
  worktreeId: string;
  revision: string;
  projectionSequence: string;
  phase: string;
  desiredGenerationId: string;
  verifiedGenerationId: string | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AggregateRow = Omit<AssignmentAggregateRecord, "revision" | "projectionSequence" | "createdAt" | "updatedAt"> & {
  revision: bigint;
  projectionSequence: bigint;
  createdAt: bigint;
  updatedAt: bigint;
};

type TerminalAttemptInput = {
  attemptId: string;
  eventId: string;
  failureCode: string;
  now: Date;
  projection: AssignmentProjectionDto;
};

type ParticipantTransitionInput = {
  attemptId: string;
  agentKind: "codex" | "opencode";
  runtimeGeneration: string;
  expectedState: "planned" | "staged" | "activated" | "rollback_started";
  nextState: "staged" | "activated" | "verified" | "rollback_started" | "rolled_back";
  now: Date;
};

type RuntimeAttestationInput = {
  worktreeId: string;
  agentKind: "codex" | "opencode";
  runtimeGeneration: string;
  assignmentGenerationId: string;
  catalogGenerationId: string;
  providerVersion: string;
  effectiveStateDigest: string;
  verifiedAt: Date;
};

export type StartupReconciliationRecord = {
  worktreeId: string;
  phase: string;
  revision: string;
  desiredGenerationId: string;
  verifiedGenerationId: string | null;
  attemptId: string | null;
  attemptStatus: string | null;
  sideEffectBoundary: string | null;
  unpublishedEvents: string;
};

type CommitVerifiedGenerationInput = {
  attemptId: string;
  eventId: string;
  now: Date;
  projection: AssignmentProjectionDto;
};

type AdvanceAttemptInput = {
  attemptId: string;
  expectedStatus: "preparing" | "waiting_for_idle" | "applying" | "rolling_back";
  nextStatus: "waiting_for_idle" | "applying" | "rolling_back";
  expectedBoundary: "none" | "staged" | "activated" | "commit_pending";
  nextBoundary: "none" | "staged" | "activated" | "commit_pending";
  eventId: string;
  now: Date;
  projection: AssignmentProjectionDto;
};

type CompareAndSetDesiredInput = {
  worktreeId: string;
  expectedRevision: string;
  targetGenerationId: string;
  attemptId: string;
  eventId: string;
  now: Date;
  projection: AssignmentProjectionDto;
};

export type CompareAndSetDesiredResult =
  | { kind: "updated"; aggregate: AssignmentAggregateRecord }
  | { kind: "unchanged"; aggregate: AssignmentAggregateRecord }
  | { kind: "conflict"; aggregate: AssignmentAggregateRecord };

export type AssignmentOutboxRecord = {
  eventId: string;
  worktreeId: string;
  revision: string;
  projectionSequence: string;
  projection: AssignmentProjectionDto;
  createdAt: Date;
};

type OutboxRow = {
  eventId: string;
  worktreeId: string;
  revision: bigint;
  projectionSequence: bigint;
  safePayloadJson: string;
  createdAt: bigint;
};

const selectAggregate = `SELECT worktree_id worktreeId, revision, projection_sequence projectionSequence,
  phase, desired_generation_id desiredGenerationId, verified_generation_id verifiedGenerationId,
  failure_code failureCode, created_at createdAt, updated_at updatedAt FROM worktree_assignments`;

const fromRow = (row: AggregateRow): AssignmentAggregateRecord => ({
  ...row,
  revision: row.revision.toString(),
  projectionSequence: row.projectionSequence.toString(),
  createdAt: new Date(Number(row.createdAt)),
  updatedAt: new Date(Number(row.updatedAt)),
});

export class AssignmentRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database = getSqlite()) {}

  getAggregate(worktreeId: string): AssignmentAggregateRecord | undefined {
    const row = this.sqlite.prepare(`${selectAggregate} WHERE worktree_id = ?`).safeIntegers().get(worktreeId) as AggregateRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getProjection(worktreeId: string): AssignmentProjectionDto | undefined {
    const row = this.sqlite.prepare(`SELECT safe_payload_json safePayloadJson FROM worktree_assignment_outbox
      WHERE worktree_id=? ORDER BY projection_sequence DESC LIMIT 1`).get(worktreeId) as { safePayloadJson: string } | undefined;
    return row ? assignmentProjectionSchema.parse(JSON.parse(row.safePayloadJson)) : undefined;
  }

  listPendingOutbox(limit = 100): AssignmentOutboxRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Invalid outbox limit.");
    const rows = this.sqlite.prepare(`SELECT event_id eventId,worktree_id worktreeId,revision,
      projection_sequence projectionSequence,safe_payload_json safePayloadJson,created_at createdAt
      FROM worktree_assignment_outbox WHERE published_at IS NULL
      ORDER BY worktree_id,projection_sequence LIMIT ?`).safeIntegers().all(limit) as OutboxRow[];
    return rows.map((row) => ({
      eventId: row.eventId, worktreeId: row.worktreeId, revision: row.revision.toString(),
      projectionSequence: row.projectionSequence.toString(),
      projection: assignmentProjectionSchema.parse(JSON.parse(row.safePayloadJson)),
      createdAt: new Date(Number(row.createdAt)),
    }));
  }

  markOutboxPublished(eventId: string, publishedAt: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare("UPDATE worktree_assignment_outbox SET published_at=? WHERE event_id=? AND published_at IS NULL").run(publishedAt.getTime(), eventId);
      if (result.changes !== 1) throw new Error("Outbox event is missing or already published.");
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  recordParticipantTransition(input: ParticipantTransitionInput): void {
    const legal = new Set(["planned:staged", "staged:activated", "activated:verified", "staged:rollback_started", "activated:rollback_started", "rollback_started:rolled_back"]);
    if (!legal.has(`${input.expectedState}:${input.nextState}`)) throw new Error("Illegal participant transition.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare(`UPDATE worktree_assignment_attempt_participants SET state=?,updated_at=?
        WHERE attempt_id=? AND agent_kind=? AND runtime_generation=? AND state=?`).run(input.nextState, input.now.getTime(), input.attemptId, input.agentKind, input.runtimeGeneration, input.expectedState);
      if (result.changes !== 1) throw new Error("Participant transition lost its compare-and-set.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  registerRuntimeAttestation(input: RuntimeAttestationInput): void {
    if (!/^sha256:[a-f0-9]{64}$/.test(input.effectiveStateDigest)) throw new Error("Invalid effective-state digest.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const lineage = this.sqlite.prepare(`SELECT 1 FROM worktree_runtime_catalog_generations c JOIN worktree_assignments a ON a.worktree_id=c.worktree_id
        WHERE c.id=? AND c.worktree_id=? AND c.agent_kind=? AND c.assignment_generation_id=? AND c.provider_version=? AND a.verified_generation_id=?`).get(
        input.catalogGenerationId,input.worktreeId,input.agentKind,input.assignmentGenerationId,input.providerVersion,input.assignmentGenerationId,
      );
      if (!lineage) throw new Error("Runtime attestation lineage mismatch.");
      this.sqlite.prepare(`INSERT INTO worktree_runtime_assignment_attestations
        (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at,invalidated_at,invalidation_code)
        VALUES (?,?,?,?,?,?,?,?,NULL,NULL)
        ON CONFLICT(worktree_id,agent_kind,runtime_generation) DO UPDATE SET assignment_generation_id=excluded.assignment_generation_id,catalog_generation_id=excluded.catalog_generation_id,provider_version=excluded.provider_version,effective_state_digest=excluded.effective_state_digest,verified_at=excluded.verified_at,invalidated_at=NULL,invalidation_code=NULL`).run(
        input.worktreeId,input.agentKind,input.runtimeGeneration,input.assignmentGenerationId,input.catalogGenerationId,input.providerVersion,input.effectiveStateDigest,input.verifiedAt.getTime(),
      );
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  invalidateRuntimeAttestation(worktreeId: string, agentKind: "codex" | "opencode", runtimeGeneration: string, failureCode: string, now: Date): void {
    const code = assignmentErrorCodeSchema.parse(failureCode);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare(`UPDATE worktree_runtime_assignment_attestations SET invalidated_at=?,invalidation_code=?
        WHERE worktree_id=? AND agent_kind=? AND runtime_generation=? AND invalidated_at IS NULL`).run(now.getTime(),code,worktreeId,agentKind,runtimeGeneration);
      if (result.changes !== 1) throw new Error("Runtime attestation is missing or already invalidated.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  listStartupReconciliation(): StartupReconciliationRecord[] {
    const rows = this.sqlite.prepare(`SELECT a.worktree_id worktreeId,a.phase,a.revision,a.desired_generation_id desiredGenerationId,
      a.verified_generation_id verifiedGenerationId,t.id attemptId,t.status attemptStatus,t.side_effect_boundary sideEffectBoundary,
      (SELECT count(*) FROM worktree_assignment_outbox o WHERE o.worktree_id=a.worktree_id AND o.published_at IS NULL) unpublishedEvents
      FROM worktree_assignments a LEFT JOIN worktree_assignment_attempts t ON t.worktree_id=a.worktree_id
        AND t.status IN ('preparing','waiting_for_idle','applying','rolling_back','recovery_required')
      WHERE a.phase<>'stable' OR t.id IS NOT NULL OR EXISTS (SELECT 1 FROM worktree_assignment_outbox o WHERE o.worktree_id=a.worktree_id AND o.published_at IS NULL)
      ORDER BY a.worktree_id`).safeIntegers().all() as Array<Omit<StartupReconciliationRecord,"revision"|"unpublishedEvents"> & { revision: bigint; unpublishedEvents: bigint }>;
    return rows.map((row) => ({ ...row, revision: row.revision.toString(), unpublishedEvents: row.unpublishedEvents.toString() }));
  }

  commitVerifiedRollback(input: TerminalAttemptInput): AssignmentAggregateRecord {
    return this.finishFailedAttempt(input, "failed_rolled_back", true);
  }

  markRecoveryRequired(input: TerminalAttemptInput): AssignmentAggregateRecord {
    return this.finishFailedAttempt(input, "recovery_required", false);
  }

  private finishFailedAttempt(input: TerminalAttemptInput, phase: "failed_rolled_back" | "recovery_required", requireRolledBack: boolean): AssignmentAggregateRecord {
    const projection = assignmentProjectionSchema.parse(input.projection);
    const failureCode = assignmentErrorCodeSchema.parse(input.failureCode);
    if (projection.phase !== phase) throw new Error("Failure projection phase mismatch.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const expectedStatus = requireRolledBack ? "rolling_back" : null;
      const attempt = this.sqlite.prepare(`SELECT worktree_id worktreeId,target_revision targetRevision,target_generation_id targetGenerationId,status
        FROM worktree_assignment_attempts WHERE id=?`).safeIntegers().get(input.attemptId) as { worktreeId: string; targetRevision: bigint; targetGenerationId: string; status: string } | undefined;
      if (!attempt || (expectedStatus ? attempt.status !== expectedStatus : !["preparing", "waiting_for_idle", "applying", "rolling_back"].includes(attempt.status))) throw new Error("Attempt is not eligible for failure transition.");
      if (requireRolledBack) {
        const incomplete = this.sqlite.prepare("SELECT count(*) count FROM worktree_assignment_attempt_participants WHERE attempt_id=? AND state<>'rolled_back'").safeIntegers().get(input.attemptId) as { count: bigint };
        if (incomplete.count !== 0n) throw new Error("Attempt participants are not rolled back.");
      } else {
        this.sqlite.prepare("UPDATE worktree_assignment_attempt_participants SET state='unknown',updated_at=? WHERE attempt_id=? AND state NOT IN ('rolled_back','verified')").run(input.now.getTime(), input.attemptId);
      }
      const aggregate = this.getAggregate(attempt.worktreeId);
      if (!aggregate || aggregate.revision !== attempt.targetRevision.toString() || aggregate.desiredGenerationId !== attempt.targetGenerationId) throw new Error("Attempt no longer matches Assignment aggregate.");
      const sequence = (BigInt(aggregate.projectionSequence) + 1n).toString();
      if (projection.worktreeId !== attempt.worktreeId || projection.revision !== aggregate.revision || projection.projectionSequence !== sequence) throw new Error("Failure projection lineage mismatch.");
      const now = input.now.getTime();
      const completion = requireRolledBack ? now : null;
      const attemptUpdate = this.sqlite.prepare("UPDATE worktree_assignment_attempts SET status=?,failure_code=?,updated_at=?,completed_at=? WHERE id=? AND status=?").run(phase, failureCode, now, completion, input.attemptId, attempt.status);
      if (attemptUpdate.changes !== 1) throw new Error("Failure transition lost its attempt compare-and-set.");
      this.sqlite.prepare(`UPDATE worktree_runtime_assignment_attestations SET invalidated_at=?,invalidation_code=?
        WHERE worktree_id=? AND assignment_generation_id=? AND invalidated_at IS NULL`).run(now, failureCode, attempt.worktreeId, attempt.targetGenerationId);
      const aggregateUpdate = this.sqlite.prepare("UPDATE worktree_assignments SET phase=?,failure_code=?,projection_sequence=?,updated_at=? WHERE worktree_id=? AND revision=? AND desired_generation_id=?").run(phase, failureCode, BigInt(sequence), now, attempt.worktreeId, attempt.targetRevision, attempt.targetGenerationId);
      if (aggregateUpdate.changes !== 1) throw new Error("Failure transition lost its aggregate compare-and-set.");
      this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at)
        VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(input.eventId, attempt.worktreeId, attempt.targetRevision, BigInt(sequence), JSON.stringify(projection), now);
      const updated = this.getAggregate(attempt.worktreeId);
      if (!updated) throw new Error("Assignment aggregate disappeared during failure transition.");
      this.sqlite.exec("COMMIT");
      return updated;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  commitVerifiedGeneration(input: CommitVerifiedGenerationInput): AssignmentAggregateRecord {
    const projection = assignmentProjectionSchema.parse(input.projection);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const attempt = this.sqlite.prepare(`SELECT worktree_id worktreeId,target_revision targetRevision,target_generation_id targetGenerationId
        FROM worktree_assignment_attempts WHERE id=? AND status='applying' AND side_effect_boundary='commit_pending'`).safeIntegers().get(input.attemptId) as { worktreeId: string; targetRevision: bigint; targetGenerationId: string } | undefined;
      if (!attempt) throw new Error("Attempt is not ready for verified commit.");
      const unverified = this.sqlite.prepare("SELECT count(*) count FROM worktree_assignment_attempt_participants WHERE attempt_id=? AND state<>'verified'").safeIntegers().get(input.attemptId) as { count: bigint };
      if (unverified.count !== 0n) throw new Error("Attempt participants are not verified.");
      const aggregate = this.getAggregate(attempt.worktreeId);
      if (!aggregate || aggregate.revision !== attempt.targetRevision.toString() || aggregate.desiredGenerationId !== attempt.targetGenerationId) throw new Error("Attempt no longer matches Assignment aggregate.");
      const sequence = (BigInt(aggregate.projectionSequence) + 1n).toString();
      if (projection.worktreeId !== attempt.worktreeId || projection.revision !== aggregate.revision || projection.projectionSequence !== sequence || projection.phase !== "stable") throw new Error("Verified projection lineage mismatch.");
      const now = input.now.getTime();
      const attemptUpdate = this.sqlite.prepare("UPDATE worktree_assignment_attempts SET status='verified',updated_at=?,completed_at=? WHERE id=? AND status='applying' AND side_effect_boundary='commit_pending'").run(now, now, input.attemptId);
      if (attemptUpdate.changes !== 1) throw new Error("Verified commit lost its attempt compare-and-set.");
      const aggregateUpdate = this.sqlite.prepare(`UPDATE worktree_assignments SET verified_generation_id=desired_generation_id,phase='stable',failure_code=NULL,projection_sequence=?,updated_at=?
        WHERE worktree_id=? AND revision=? AND desired_generation_id=?`).run(BigInt(sequence), now, attempt.worktreeId, attempt.targetRevision, attempt.targetGenerationId);
      if (aggregateUpdate.changes !== 1) throw new Error("Verified commit lost its aggregate compare-and-set.");
      this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at)
        VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(input.eventId, attempt.worktreeId, attempt.targetRevision, BigInt(sequence), JSON.stringify(projection), now);
      const updated = this.getAggregate(attempt.worktreeId);
      if (!updated) throw new Error("Assignment aggregate disappeared during verified commit.");
      this.sqlite.exec("COMMIT");
      return updated;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  advanceAttempt(input: AdvanceAttemptInput): AssignmentAggregateRecord {
    const projection = assignmentProjectionSchema.parse(input.projection);
    const legal = new Set(["preparing:waiting_for_idle:none:none", "waiting_for_idle:applying:none:staged", "applying:applying:staged:activated", "applying:applying:activated:commit_pending", "applying:rolling_back:staged:staged", "applying:rolling_back:activated:activated"]);
    if (!legal.has(`${input.expectedStatus}:${input.nextStatus}:${input.expectedBoundary}:${input.nextBoundary}`)) throw new Error("Illegal Assignment attempt transition.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const attempt = this.sqlite.prepare(`SELECT worktree_id worktreeId,target_revision targetRevision,target_generation_id targetGenerationId
        FROM worktree_assignment_attempts WHERE id=? AND status=? AND side_effect_boundary=?`).safeIntegers().get(input.attemptId, input.expectedStatus, input.expectedBoundary) as { worktreeId: string; targetRevision: bigint; targetGenerationId: string } | undefined;
      if (!attempt) throw new Error("Attempt state changed or attempt is missing.");
      const aggregate = this.getAggregate(attempt.worktreeId);
      if (!aggregate || aggregate.revision !== attempt.targetRevision.toString() || aggregate.desiredGenerationId !== attempt.targetGenerationId) throw new Error("Attempt no longer matches Assignment aggregate.");
      const sequence = (BigInt(aggregate.projectionSequence) + 1n).toString();
      if (projection.worktreeId !== attempt.worktreeId || projection.revision !== aggregate.revision || projection.projectionSequence !== sequence || projection.phase !== input.nextStatus) throw new Error("Assignment projection transition mismatch.");
      const now = input.now.getTime();
      const attemptUpdate = this.sqlite.prepare("UPDATE worktree_assignment_attempts SET status=?,side_effect_boundary=?,updated_at=? WHERE id=? AND status=? AND side_effect_boundary=?").run(input.nextStatus, input.nextBoundary, now, input.attemptId, input.expectedStatus, input.expectedBoundary);
      if (attemptUpdate.changes !== 1) throw new Error("Attempt transition lost its compare-and-set.");
      const aggregateUpdate = this.sqlite.prepare("UPDATE worktree_assignments SET phase=?,projection_sequence=?,updated_at=? WHERE worktree_id=? AND revision=? AND desired_generation_id=?").run(input.nextStatus, BigInt(sequence), now, attempt.worktreeId, attempt.targetRevision, attempt.targetGenerationId);
      if (aggregateUpdate.changes !== 1) throw new Error("Assignment aggregate changed during attempt transition.");
      this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at)
        VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(input.eventId, attempt.worktreeId, attempt.targetRevision, BigInt(sequence), JSON.stringify(projection), now);
      const updated = this.getAggregate(attempt.worktreeId);
      if (!updated) throw new Error("Assignment aggregate disappeared during transition.");
      this.sqlite.exec("COMMIT");
      return updated;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  compareAndSetDesired(input: CompareAndSetDesiredInput): CompareAndSetDesiredResult {
    const parsedProjection = assignmentProjectionSchema.parse(input.projection);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getAggregate(input.worktreeId);
      if (!current) throw new Error("Assignment aggregate not found.");
      if (current.revision !== input.expectedRevision) {
        this.sqlite.exec("COMMIT");
        return { kind: "conflict", aggregate: current };
      }
      if (current.desiredGenerationId === input.targetGenerationId) {
        this.sqlite.exec("COMMIT");
        return { kind: "unchanged", aggregate: current };
      }
      const generation = this.sqlite.prepare("SELECT worktree_id worktreeId FROM worktree_assignment_generations WHERE id = ?").get(input.targetGenerationId) as { worktreeId: string } | undefined;
      if (!generation || generation.worktreeId !== input.worktreeId) throw new Error("Assignment generation ownership mismatch.");

      const revision = (BigInt(current.revision) + 1n).toString();
      const projectionSequence = (BigInt(current.projectionSequence) + 1n).toString();
      if (parsedProjection.worktreeId !== input.worktreeId || parsedProjection.revision !== revision || parsedProjection.projectionSequence !== projectionSequence) {
        throw new Error("Assignment projection lineage mismatch.");
      }
      const now = input.now.getTime();
      const update = this.sqlite.prepare(`UPDATE worktree_assignments SET revision=?, projection_sequence=?, phase='waiting_for_idle', desired_generation_id=?, failure_code=NULL, updated_at=? WHERE worktree_id=? AND revision=?`).run(BigInt(revision), BigInt(projectionSequence), input.targetGenerationId, now, input.worktreeId, BigInt(input.expectedRevision));
      if (update.changes !== 1) throw new Error("Assignment revision changed during update.");
      this.sqlite.prepare(`INSERT INTO worktree_assignment_attempts
        (id,worktree_id,kind,target_revision,target_generation_id,prior_verified_generation_id,status,side_effect_boundary,started_at,updated_at)
        VALUES (?,?,'assignment_apply',?,?,?,'waiting_for_idle','none',?,?)`).run(
        input.attemptId, input.worktreeId, BigInt(revision), input.targetGenerationId,
        current.verifiedGenerationId, now, now,
      );
      this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox
        (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at)
        VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(
        input.eventId, input.worktreeId, BigInt(revision), BigInt(projectionSequence), JSON.stringify(parsedProjection), now,
      );
      const aggregate = this.getAggregate(input.worktreeId);
      if (!aggregate) throw new Error("Assignment aggregate disappeared during update.");
      this.sqlite.exec("COMMIT");
      return { kind: "updated", aggregate };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
