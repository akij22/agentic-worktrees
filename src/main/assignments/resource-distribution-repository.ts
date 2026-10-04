import type BetterSqlite3 from "better-sqlite3";
import { assignmentProjectionSchema, type AssignmentProjectionDto } from "../../shared/assignments";
import { getSqlite } from "../database/client";

type FrozenParticipant = { worktreeId: string; observedRevision: string; priorGenerationId: string; targetGenerationId: string; attemptId: string; applyOrder: number };
type CreateOperationInput = { operationId: string; resourceKind: "capability" | "skill"; resourceId: string; targetResourceVersionId: string | null; participants: FrozenParticipant[]; now: Date };
type CommitProjection = { worktreeId: string; eventId: string; projection: AssignmentProjectionDto };

export class ResourceDistributionRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database = getSqlite()) {}

  createFrozenOperation(input: CreateOperationInput): void {
    const ids = [...input.participants].sort((a,b) => a.worktreeId.localeCompare(b.worktreeId));
    if (ids.some((item,index) => item.applyOrder !== index) || new Set(ids.map((item) => item.worktreeId)).size !== ids.length) throw new Error("Distribution participants must have stable unique apply order.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.prepare(`INSERT INTO resource_distribution_operations (id,resource_kind,resource_id,target_resource_version_id,status,side_effect_boundary,started_at,updated_at)
        VALUES (?,?,?,?,'applying','gates_acquired',?,?)`).run(input.operationId,input.resourceKind,input.resourceId,input.targetResourceVersionId,input.now.getTime(),input.now.getTime());
      const insert = this.sqlite.prepare(`INSERT INTO resource_distribution_operation_worktrees
        (operation_id,worktree_id,apply_order,observed_revision,prior_generation_id,target_generation_id,attempt_id,state,updated_at) VALUES (?,?,?,?,?,?,?,'gate_acquired',?)`);
      for (const participant of ids) {
        const aggregate = this.sqlite.prepare("SELECT revision,desired_generation_id desired,verified_generation_id verified FROM worktree_assignments WHERE worktree_id=?").safeIntegers().get(participant.worktreeId) as { revision: bigint; desired: string; verified: string | null } | undefined;
        if (!aggregate || aggregate.revision.toString() !== participant.observedRevision || aggregate.desired !== participant.priorGenerationId || aggregate.verified !== participant.priorGenerationId) throw new Error("Distribution participant snapshot mismatch.");
        const linked = this.sqlite.prepare("UPDATE worktree_assignment_attempts SET distribution_operation_id=? WHERE id=? AND worktree_id=? AND distribution_operation_id IS NULL").run(input.operationId,participant.attemptId,participant.worktreeId);
        if (linked.changes !== 1) throw new Error("Distribution child attempt could not be linked.");
        insert.run(input.operationId,participant.worktreeId,participant.applyOrder,BigInt(participant.observedRevision),participant.priorGenerationId,participant.targetGenerationId,participant.attemptId,input.now.getTime());
      }
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  recordWorktreeTransition(operationId: string, worktreeId: string, expectedState: "gate_acquired" | "staged" | "activated", nextState: "staged" | "activated" | "commit_ready", now: Date): void {
    const legal = new Set(["gate_acquired:staged","staged:activated","activated:commit_ready"]);
    if (!legal.has(`${expectedState}:${nextState}`)) throw new Error("Illegal distribution participant transition.");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare("UPDATE resource_distribution_operation_worktrees SET state=?,updated_at=? WHERE operation_id=? AND worktree_id=? AND state=?").run(nextState,now.getTime(),operationId,worktreeId,expectedState);
      if (result.changes !== 1) throw new Error("Distribution participant transition lost its compare-and-set.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  cancelBeforeEffects(operationId: string, projections: CommitProjection[], now: Date): void {
    const parsed = new Map(projections.map((item) => [item.worktreeId,{...item,projection:assignmentProjectionSchema.parse(item.projection)}]));
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const parent = this.sqlite.prepare("SELECT 1 FROM resource_distribution_operations WHERE id=? AND status IN ('preparing','waiting_for_idle','applying') AND side_effect_boundary IN ('none','gates_acquired')").get(operationId);
      if (!parent) throw new Error("Distribution operation cannot be cancelled after effects.");
      const participants = this.sqlite.prepare("SELECT worktree_id worktreeId,observed_revision observedRevision,prior_generation_id priorGenerationId,attempt_id attemptId FROM resource_distribution_operation_worktrees WHERE operation_id=? AND state IN ('planned','gate_acquired') ORDER BY apply_order").safeIntegers().all(operationId) as Array<{worktreeId:string;observedRevision:bigint;priorGenerationId:string;attemptId:string|null}>;
      if (participants.length!==parsed.size) throw new Error("Distribution cancellation projection set mismatch.");
      for (const participant of participants) {
        const item=parsed.get(participant.worktreeId); const aggregate=this.sqlite.prepare("SELECT projection_sequence sequence,desired_generation_id desired,verified_generation_id verified FROM worktree_assignments WHERE worktree_id=? AND revision=?").safeIntegers().get(participant.worktreeId,participant.observedRevision) as {sequence:bigint;desired:string;verified:string|null}|undefined;
        const sequence=(aggregate?.sequence ?? -1n)+1n;
        if (!item || !aggregate || aggregate.desired!==participant.priorGenerationId || aggregate.verified!==participant.priorGenerationId || item.projection.revision!==participant.observedRevision.toString() || item.projection.projectionSequence!==sequence.toString() || item.projection.phase!=="stable") throw new Error("Distribution cancellation lineage mismatch.");
        const updated=this.sqlite.prepare("UPDATE worktree_assignments SET phase='stable',projection_sequence=?,failure_code=NULL,updated_at=? WHERE worktree_id=? AND revision=?").run(sequence,now.getTime(),participant.worktreeId,participant.observedRevision);
        if(updated.changes!==1) throw new Error("Distribution cancellation lost a Worktree revision.");
        if(participant.attemptId) this.sqlite.prepare("UPDATE worktree_assignment_attempts SET status='cancelled',failure_code='operation_cancelled',completed_at=?,updated_at=? WHERE id=? AND status IN ('preparing','waiting_for_idle','applying')").run(now.getTime(),now.getTime(),participant.attemptId);
        this.sqlite.prepare("UPDATE resource_distribution_operation_worktrees SET state='rolled_back',updated_at=? WHERE operation_id=? AND worktree_id=?").run(now.getTime(),operationId,participant.worktreeId);
        this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at) VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(item.eventId,participant.worktreeId,participant.observedRevision,sequence,JSON.stringify(item.projection),now.getTime());
      }
      const cancelled=this.sqlite.prepare("UPDATE resource_distribution_operations SET status='cancelled',failure_code='operation_cancelled',completed_at=?,updated_at=? WHERE id=? AND side_effect_boundary IN ('none','gates_acquired')").run(now.getTime(),now.getTime(),operationId);
      if(cancelled.changes!==1) throw new Error("Distribution cancellation lost parent compare-and-set.");
      this.sqlite.exec("COMMIT");
    } catch(error){this.sqlite.exec("ROLLBACK");throw error;}
  }

  markCommitPending(operationId: string, now: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const incomplete = this.sqlite.prepare("SELECT count(*) count FROM resource_distribution_operation_worktrees WHERE operation_id=? AND state<>'commit_ready'").safeIntegers().get(operationId) as { count: bigint };
      if (incomplete.count !== 0n) throw new Error("Distribution participants are not commit-ready.");
      const result = this.sqlite.prepare("UPDATE resource_distribution_operations SET status='commit_pending',side_effect_boundary='commit_pending',updated_at=? WHERE id=? AND status='applying'").run(now.getTime(),operationId);
      if (result.changes !== 1) throw new Error("Distribution operation is not applying.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  commitGlobally(operationId: string, projections: CommitProjection[], now: Date): void {
    const parsed = new Map(projections.map((item) => [item.worktreeId, { ...item, projection: assignmentProjectionSchema.parse(item.projection) }]));
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const operation = this.sqlite.prepare("SELECT 1 FROM resource_distribution_operations WHERE id=? AND status='commit_pending' AND side_effect_boundary='commit_pending'").get(operationId);
      if (!operation) throw new Error("Distribution operation is not commit-pending.");
      const participants = this.sqlite.prepare(`SELECT worktree_id worktreeId,observed_revision observedRevision,target_generation_id targetGenerationId,attempt_id attemptId
        FROM resource_distribution_operation_worktrees WHERE operation_id=? AND state='commit_ready' ORDER BY apply_order`).safeIntegers().all(operationId) as Array<{ worktreeId: string; observedRevision: bigint; targetGenerationId: string; attemptId: string }>;
      if (participants.length === 0 || participants.length !== parsed.size) throw new Error("Distribution commit projection set mismatch.");
      for (const participant of participants) {
        const aggregate = this.sqlite.prepare("SELECT projection_sequence sequence FROM worktree_assignments WHERE worktree_id=? AND revision=?").safeIntegers().get(participant.worktreeId,participant.observedRevision) as { sequence: bigint } | undefined;
        const item = parsed.get(participant.worktreeId); const nextRevision = participant.observedRevision + 1n; const nextSequence = (aggregate?.sequence ?? -1n) + 1n;
        if (!aggregate || !item || item.projection.revision !== nextRevision.toString() || item.projection.projectionSequence !== nextSequence.toString() || item.projection.phase !== "stable") throw new Error("Distribution commit lineage mismatch.");
      }
      for (const participant of participants) {
        const item = parsed.get(participant.worktreeId); const revision = participant.observedRevision + 1n;
        if (!item) throw new Error("Distribution commit projection disappeared.");
        const sequence = BigInt(item.projection.projectionSequence);
        const updated = this.sqlite.prepare(`UPDATE worktree_assignments SET revision=?,projection_sequence=?,phase='stable',desired_generation_id=?,verified_generation_id=?,failure_code=NULL,updated_at=? WHERE worktree_id=? AND revision=?`).run(revision,sequence,participant.targetGenerationId,participant.targetGenerationId,now.getTime(),participant.worktreeId,participant.observedRevision);
        if (updated.changes !== 1) throw new Error("Distribution commit lost a Worktree revision.");
        const attempt = this.sqlite.prepare("UPDATE worktree_assignment_attempts SET status='verified',side_effect_boundary='commit_pending',completed_at=?,updated_at=? WHERE id=? AND status='applying' AND side_effect_boundary='commit_pending'").run(now.getTime(),now.getTime(),participant.attemptId);
        if (attempt.changes !== 1) throw new Error("Distribution child attempt is not commit-ready.");
        const child = this.sqlite.prepare("UPDATE resource_distribution_operation_worktrees SET state='committed',updated_at=? WHERE operation_id=? AND worktree_id=? AND state='commit_ready'").run(now.getTime(),operationId,participant.worktreeId);
        if (child.changes !== 1) throw new Error("Distribution participant lost its compare-and-set.");
        this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at) VALUES (?,?,?,?,'assignment.changed',1,?,?)`).run(item.eventId,participant.worktreeId,revision,sequence,JSON.stringify(item.projection),now.getTime());
      }
      const parent = this.sqlite.prepare("UPDATE resource_distribution_operations SET status='verified',completed_at=?,updated_at=? WHERE id=? AND status='commit_pending'").run(now.getTime(),now.getTime(),operationId);
      if (parent.changes !== 1) throw new Error("Distribution parent commit lost its compare-and-set.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
