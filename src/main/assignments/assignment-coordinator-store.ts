import { createHash, randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  assignmentAggregateSchema,
  assignmentProjectionSchema,
  resourceIdentitySchema,
  type AssignmentAggregate,
  type AssignmentProjectionDto,
  type ResourceAssignmentGeneration,
  type ResourceIdentity,
  type AssignmentParticipantAttestation,
} from "../../shared/assignments";
import { AssignmentRepository } from "./assignment-repository";

export const assignmentDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** Normalized durable aggregate writes used exclusively by the coordinator. */
export class AssignmentCoordinatorStore extends AssignmentRepository {
  constructor(private readonly database: BetterSqlite3.Database) {
    super(database);
  }
  listWorktrees(): string[] {
    return (
      this.database.prepare("SELECT id FROM worktrees ORDER BY id").all() as {
        id: string;
      }[]
    ).map((row) => row.id);
  }
  generation(
    worktreeId: string,
    resources: ResourceIdentity[],
  ): ResourceAssignmentGeneration {
    const digest = assignmentDigest({
      domain: "assignment-set-v1",
      worktreeId,
      resources,
    });
    const existing = this.database
      .prepare(
        "SELECT id FROM worktree_assignment_generations WHERE worktree_id=? AND resource_set_digest=?",
      )
      .get(worktreeId, digest) as { id: string } | undefined;
    return { id: existing?.id ?? `gen:${digest.slice(7)}`, resources };
  }
  loadGeneration(id: string): ResourceAssignmentGeneration {
    const rows = this.database
      .prepare(
        `SELECT m.id memberId,v.resource_kind kind,v.resource_id id,v.version,v.content_digest contentDigest,v.security_digest securityDigest,m.configuration_digest configurationDigest,m.invocation_policy_digest invocationPolicyDigest FROM worktree_assignment_generation_resources m JOIN resource_versions v ON v.id=m.resource_version_id WHERE m.generation_id=? ORDER BY v.resource_kind,v.resource_id`,
      )
      .all(id) as Array<
      Omit<ResourceIdentity, "providerProjections"> & { memberId: string }
    >;
    return {
      id,
      resources: rows.map(({ memberId, ...row }) =>
        resourceIdentitySchema.parse({
          ...row,
          providerProjections: this.database
            .prepare(
              `SELECT agent_kind agentKind,availability,skill_isolation skillIsolation,qualification_digest qualificationDigest,expected_state_digest expectedStateDigest FROM worktree_assignment_generation_resource_providers WHERE generation_resource_id=? ORDER BY agent_kind`,
            )
            .all(memberId),
        }),
      ),
    };
  }
  load(worktreeId: string): AssignmentAggregate | undefined {
    const row = this.getAggregate(worktreeId);
    if (!row) return undefined;
    if (!row.verifiedGenerationId)
      throw new Error(
        "Assignment has no verified generation and requires recovery.",
      );
    const attempt = this.database
      .prepare(
        `SELECT id attemptId,kind,target_revision targetRevision,target_generation_id targetGenerationId,prior_verified_generation_id priorVerifiedGenerationId,status,side_effect_boundary sideEffectBoundary,started_at createdAt FROM worktree_assignment_attempts WHERE worktree_id=? AND status IN ('preparing','waiting_for_idle','applying','rolling_back','recovery_required') ORDER BY started_at DESC LIMIT 1`,
      )
      .safeIntegers()
      .get(worktreeId) as
      | {
          attemptId: string;
          kind: string;
          targetRevision: bigint;
          targetGenerationId: string;
          priorVerifiedGenerationId: string | null;
          status: string;
          sideEffectBoundary: string;
          createdAt: bigint;
        }
      | undefined;
    return assignmentAggregateSchema.parse({
      worktreeId,
      revision: row.revision,
      projectionSequence: row.projectionSequence,
      phase: row.phase,
      desiredGeneration: this.loadGeneration(row.desiredGenerationId),
      verifiedGeneration: this.loadGeneration(row.verifiedGenerationId),
      attempt: attempt
        ? {
            ...attempt,
            targetRevision: attempt.targetRevision.toString(),
            createdAt: new Date(Number(attempt.createdAt)).toISOString(),
          }
        : null,
      participants: (
        this.database
          .prepare(
            `SELECT t.agent_kind agentKind,t.runtime_generation runtimeGenerationId,t.assignment_generation_id assignmentGenerationId,t.catalog_generation_id catalogGenerationId,t.provider_version providerVersion,c.adapter_contract_version adapterContractVersion,t.effective_state_digest effectiveStateDigest,t.verified_at attestedAt FROM worktree_runtime_assignment_attestations t JOIN worktree_runtime_catalog_generations c ON c.id=t.catalog_generation_id WHERE t.worktree_id=? AND t.invalidated_at IS NULL`,
          )
          .all(worktreeId) as Array<
          Omit<
            AssignmentParticipantAttestation,
            "skillIsolation" | "attestedAt"
          > & { attestedAt: number }
        >
      ).map((p) => ({
        ...p,
        attestedAt: new Date(p.attestedAt).toISOString(),
        skillIsolation:
          this.loadGeneration(p.assignmentGenerationId)
            .resources.find((r) => r.kind === "skill")
            ?.providerProjections.find((q) => q.agentKind === p.agentKind)
            ?.skillIsolation ?? "not_applicable",
      })),
      failure: row.failureCode
        ? {
            code: row.failureCode,
            message: "Resource state requires attention.",
          }
        : null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  persist(
    state: AssignmentAggregate,
    projection: AssignmentProjectionDto,
    expectedSequence: string | null,
    terminal?: { id: string; status: string },
  ): void {
    this.transaction(() =>
      this.write(state, projection, expectedSequence, terminal),
    );
  }
  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  targetParticipants(
    attemptId: string,
  ): Array<
    Omit<AssignmentParticipantAttestation, "skillIsolation" | "attestedAt">
  > {
    return this.database
      .prepare(
        `SELECT p.agent_kind agentKind,p.runtime_generation runtimeGenerationId,c.assignment_generation_id assignmentGenerationId,p.target_catalog_generation_id catalogGenerationId,p.provider_version providerVersion,c.adapter_contract_version adapterContractVersion,p.target_effective_state_digest effectiveStateDigest FROM worktree_assignment_attempt_participants p JOIN worktree_runtime_catalog_generations c ON c.id=p.target_catalog_generation_id WHERE p.attempt_id=? ORDER BY p.apply_order`,
      )
      .all(attemptId) as Array<
      Omit<AssignmentParticipantAttestation, "skillIsolation" | "attestedAt">
    >;
  }
  planParticipants(
    attemptId: string,
    participants: readonly AssignmentParticipantAttestation[],
    prior: readonly AssignmentParticipantAttestation[],
    catalogs: readonly { id: string; digest: string }[],
  ): void {
    this.transaction(() => {
      for (const [order, participant] of participants.entries()) {
        this.insertCatalog(
          this.loadAttemptWorktree(attemptId),
          participant,
          catalogs.find((c) => c.id === participant.catalogGenerationId)
            ?.digest,
        );
        const previous = prior.find(
          (p) => p.agentKind === participant.agentKind,
        );
        if (previous)
          this.insertCatalog(
            this.loadAttemptWorktree(attemptId),
            previous,
            catalogs.find((c) => c.id === previous.catalogGenerationId)?.digest,
          );
        this.database
          .prepare(
            `INSERT INTO worktree_assignment_attempt_participants (attempt_id,agent_kind,runtime_generation,provider_version,prior_runtime_generation,prior_catalog_generation_id,target_catalog_generation_id,apply_order,state,prior_effective_state_digest,target_effective_state_digest,updated_at) VALUES (?,?,?,?,?,?,?,?,'planned',?,?,?)`,
          )
          .run(
            attemptId,
            participant.agentKind,
            participant.runtimeGenerationId,
            participant.providerVersion,
            previous?.runtimeGenerationId ?? participant.runtimeGenerationId,
            previous?.catalogGenerationId ?? null,
            participant.catalogGenerationId,
            order,
            previous?.effectiveStateDigest ?? null,
            participant.effectiveStateDigest,
            Date.now(),
          );
      }
    });
  }
  private loadAttemptWorktree(attemptId: string): string {
    const row = this.database
      .prepare(
        "SELECT worktree_id worktreeId FROM worktree_assignment_attempts WHERE id=?",
      )
      .get(attemptId) as { worktreeId: string } | undefined;
    if (!row) throw new Error("Assignment attempt is missing.");
    return row.worktreeId;
  }
  participantProgress(
    attemptId: string,
    participant: AssignmentParticipantAttestation,
    state: string,
  ): void {
    this.transaction(() => {
      const result = this.database
        .prepare(
          "UPDATE worktree_assignment_attempt_participants SET state=?,updated_at=? WHERE attempt_id=? AND agent_kind=? AND runtime_generation=?",
        )
        .run(
          state,
          Date.now(),
          attemptId,
          participant.agentKind,
          participant.runtimeGenerationId,
        );
      if (result.changes !== 1)
        throw new Error("Assignment participant is missing.");
    });
  }
  prepareCatalog(
    worktreeId: string,
    p: AssignmentParticipantAttestation,
    projectionDigest: string,
  ): void {
    this.transaction(() => this.insertCatalog(worktreeId, p, projectionDigest));
  }
  private insertCatalog(
    worktreeId: string,
    p: AssignmentParticipantAttestation,
    projectionDigest?: string,
  ): void {
    const existing = this.database
      .prepare(
        `SELECT worktree_id worktreeId,agent_kind agentKind,assignment_generation_id assignmentGenerationId,provider_version providerVersion,adapter_contract_version adapterContractVersion,projection_digest effectiveStateDigest FROM worktree_runtime_catalog_generations WHERE id=?`,
      )
      .get(p.catalogGenerationId) as
      | {
          worktreeId: string;
          agentKind: string;
          assignmentGenerationId: string;
          providerVersion: string;
          adapterContractVersion: number;
          effectiveStateDigest: string;
        }
      | undefined;
    if (
      existing &&
      (existing.worktreeId !== worktreeId ||
        existing.agentKind !== p.agentKind ||
        existing.assignmentGenerationId !== p.assignmentGenerationId ||
        existing.providerVersion !== p.providerVersion ||
        existing.adapterContractVersion !== p.adapterContractVersion ||
        (projectionDigest !== undefined &&
          existing.effectiveStateDigest !== projectionDigest))
    )
      throw new Error("Catalog identity collision.");
    if (existing) return;
    if (!projectionDigest || !/^sha256:[a-f0-9]{64}$/.test(projectionDigest))
      throw new Error("Catalog projection digest is missing or invalid.");
    this.database
      .prepare(
        `INSERT OR IGNORE INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.catalogGenerationId,
        worktreeId,
        p.agentKind,
        p.assignmentGenerationId,
        p.providerVersion,
        p.adapterContractVersion,
        projectionDigest,
        Date.parse(p.attestedAt),
      );
  }
  removeWorktree(worktreeId: string): void {
    this.transaction(() => {
      // Delete retained lineage first, then the Worktree cascades the aggregate/catalog subtree.
      for (const table of [
        "resource_activity",
        "resource_activity_session_routes",
        "resource_evidence_coverage",
      ])
        this.database
          .prepare(`DELETE FROM ${table} WHERE worktree_id=?`)
          .run(worktreeId);
      const result = this.database
        .prepare("DELETE FROM worktrees WHERE id=?")
        .run(worktreeId);
      if (result.changes !== 1)
        throw new Error("Worktree removal lost its compare-and-set.");
    });
  }
  announceDistribution(
    id: string,
    previous: AssignmentAggregate,
    next: AssignmentAggregate,
    projection: AssignmentProjectionDto,
  ): void {
    this.transaction(() => {
      this.write(next, projection, previous.projectionSequence);
      if (!next.attempt)
        throw new Error("Distribution wait attempt is missing.");
      this.database
        .prepare(
          "UPDATE worktree_assignment_attempts SET distribution_operation_id=? WHERE id=?",
        )
        .run(id, next.attempt.attemptId);
    });
  }
  distributionWorktrees(id: string): string[] {
    return (
      this.database
        .prepare(
          `SELECT worktree_id worktreeId FROM resource_distribution_operation_worktrees WHERE operation_id=? UNION SELECT worktree_id worktreeId FROM worktree_assignment_attempts WHERE distribution_operation_id=? ORDER BY worktreeId`,
        )
        .all(id, id) as { worktreeId: string }[]
    ).map((row) => row.worktreeId);
  }
  activeDistributions(): Array<{
    id: string;
    kind: "skill" | "capability";
    resourceId: string;
    status: string;
    boundary: string;
  }> {
    return this.database
      .prepare(
        `SELECT id,resource_kind kind,resource_id resourceId,status,side_effect_boundary boundary FROM resource_distribution_operations WHERE status IN ('preparing','waiting_for_idle','applying','commit_pending','rolling_back','recovery_required') ORDER BY id`,
      )
      .all() as Array<{
      id: string;
      kind: "skill" | "capability";
      resourceId: string;
      status: string;
      boundary: string;
    }>;
  }
  beginDistribution(
    id: string,
    kind: "skill" | "capability",
    resourceId: string,
    target: ResourceIdentity | null,
  ): void {
    this.transaction(() => {
      const versionId = target ? this.insertVersion(target, Date.now()) : null;
      this.database
        .prepare(
          `INSERT INTO resource_distribution_operations (id,resource_kind,resource_id,target_resource_version_id,status,side_effect_boundary,started_at,updated_at) VALUES (?,?,?,?,'preparing','none',?,?)`,
        )
        .run(id, kind, resourceId, versionId, Date.now(), Date.now());
    });
  }
  freezeDistribution(
    id: string,
    states: Array<{
      prior: AssignmentAggregate;
      next: AssignmentAggregate;
      target: ResourceAssignmentGeneration;
      projection: AssignmentProjectionDto;
    }>,
  ): void {
    this.transaction(() => {
      for (const [order, item] of states.entries()) {
        this.insertGeneration(item.prior.worktreeId, item.target, Date.now());
        this.write(item.next, item.projection, item.prior.projectionSequence);
        if (!item.next.attempt)
          throw new Error("Distribution child attempt is missing.");
        this.database
          .prepare(
            "UPDATE worktree_assignment_attempts SET distribution_operation_id=? WHERE id=?",
          )
          .run(id, item.next.attempt.attemptId);
        this.database
          .prepare(
            `INSERT INTO resource_distribution_operation_worktrees (operation_id,worktree_id,apply_order,observed_revision,prior_generation_id,target_generation_id,attempt_id,state,updated_at) VALUES (?,?,?,?,?,?,?,'gate_acquired',?)`,
          )
          .run(
            id,
            item.prior.worktreeId,
            order,
            BigInt(item.prior.revision),
            item.prior.verifiedGeneration.id,
            item.target.id,
            item.next.attempt.attemptId,
            Date.now(),
          );
      }
      const updated = this.database
        .prepare(
          "UPDATE resource_distribution_operations SET status='applying',side_effect_boundary='gates_acquired',updated_at=? WHERE id=? AND status='preparing'",
        )
        .run(Date.now(), id);
      if (updated.changes !== 1)
        throw new Error("Distribution parent changed before freeze.");
    });
  }
  distributionWorktreeProgress(
    operationId: string,
    worktreeId: string,
    state: "staged" | "activated" | "commit_ready" | "rollback_started",
  ): void {
    this.transaction(() => {
      const result = this.database
        .prepare(
          "UPDATE resource_distribution_operation_worktrees SET state=?,updated_at=? WHERE operation_id=? AND worktree_id=?",
        )
        .run(state, Date.now(), operationId, worktreeId);
      if (result.changes !== 1)
        throw new Error("Distribution participant journal is missing.");
    });
  }
  distributionBoundary(
    id: string,
    boundary: "staged" | "activated" | "commit_pending" | "none",
    status = "applying",
  ): void {
    this.transaction(() => {
      const updated = this.database
        .prepare(
          "UPDATE resource_distribution_operations SET status=?,side_effect_boundary=?,updated_at=? WHERE id=? AND completed_at IS NULL",
        )
        .run(status, boundary, Date.now(), id);
      if (updated.changes !== 1)
        throw new Error("Distribution operation is unavailable.");
    });
  }
  finishDistribution(
    id: string,
    status: "verified" | "failed" | "cancelled" | "superseded" | "recovery_required",
    changes: Array<{
      prior: AssignmentAggregate;
      next: AssignmentAggregate;
      projection: AssignmentProjectionDto;
      attemptId: string;
      attemptStatus: string;
    }>,
  ): void {
    this.transaction(() => {
      for (const change of changes) {
        this.write(
          change.next,
          change.projection,
          change.prior.projectionSequence,
          { id: change.attemptId, status: change.attemptStatus },
        );
        this.database
          .prepare(
            "UPDATE resource_distribution_operation_worktrees SET state=?,updated_at=? WHERE operation_id=? AND worktree_id=?",
          )
          .run(
            status === "verified"
              ? "committed"
              : change.next.phase === "recovery_required"
                ? "unknown"
                : "rolled_back",
            Date.now(),
            id,
            change.next.worktreeId,
          );
      }
      const result = this.database
        .prepare(
          "UPDATE resource_distribution_operations SET status=?,failure_code=?,updated_at=?,completed_at=? WHERE id=? AND completed_at IS NULL",
        )
        .run(
          status,
          status === "verified"
            ? null
            : ["cancelled", "superseded"].includes(status)
              ? "operation_cancelled"
              : "assignment_apply_failed",
          Date.now(),
          status === "recovery_required" ? null : Date.now(),
          id,
        );
      if (result.changes !== 1)
        throw new Error("Distribution decision lost its compare-and-set.");
    });
  }
  private insertVersion(resource: ResourceIdentity, now: number): string {
    const versionId = `rv:${assignmentDigest({ kind: resource.kind, id: resource.id, version: resource.version, contentDigest: resource.contentDigest, securityDigest: resource.securityDigest }).slice(7)}`;
    this.database
      .prepare(
        "INSERT OR IGNORE INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        versionId,
        resource.kind,
        resource.id,
        resource.version,
        resource.contentDigest,
        resource.securityDigest,
        now,
      );
    return versionId;
  }
  private insertGeneration(
    worktreeId: string,
    generation: ResourceAssignmentGeneration,
    now: number,
  ): void {
    if (
      this.database
        .prepare(
          "SELECT 1 FROM worktree_assignment_generations WHERE id=? AND worktree_id=?",
        )
        .get(generation.id, worktreeId)
    ) {
      if (
        JSON.stringify(this.loadGeneration(generation.id).resources) !==
        JSON.stringify(generation.resources)
      )
        throw new Error("Assignment generation identity collision.");
      return;
    }
    const ordinal = this.database
      .prepare(
        "SELECT coalesce(max(ordinal),-1)+1 ordinal FROM worktree_assignment_generations WHERE worktree_id=?",
      )
      .safeIntegers()
      .get(worktreeId) as { ordinal: bigint };
    this.database
      .prepare(
        "INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        generation.id,
        worktreeId,
        ordinal.ordinal,
        assignmentDigest({
          domain: "assignment-set-v1",
          worktreeId,
          resources: generation.resources,
        }),
        now,
      );
    for (const resource of generation.resources) {
      const versionId = this.insertVersion(resource, now);
      const member = `member:${assignmentDigest({ generation: generation.id, versionId }).slice(7)}`;
      this.database
        .prepare(
          "INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES (?,?,?,?,?)",
        )
        .run(
          member,
          generation.id,
          versionId,
          resource.configurationDigest,
          resource.invocationPolicyDigest,
        );
      for (const provider of resource.providerProjections)
        this.database
          .prepare(
            "INSERT INTO worktree_assignment_generation_resource_providers (generation_resource_id,agent_kind,availability,skill_isolation,qualification_digest,expected_state_digest) VALUES (?,?,?,?,?,?)",
          )
          .run(
            member,
            provider.agentKind,
            provider.availability,
            provider.skillIsolation,
            provider.qualificationDigest,
            provider.expectedStateDigest,
          );
    }
  }
  private write(
    raw: AssignmentAggregate,
    projection: AssignmentProjectionDto,
    expectedSequence: string | null,
    terminal?: { id: string; status: string },
  ): void {
    const state = assignmentAggregateSchema.parse(raw),
      now = Date.parse(state.updatedAt);
    const safeProjection = assignmentProjectionSchema.parse(projection);
    if (
      safeProjection.worktreeId !== state.worktreeId ||
      safeProjection.revision !== state.revision ||
      safeProjection.projectionSequence !== state.projectionSequence ||
      safeProjection.phase !== state.phase
    )
      throw new Error("Assignment projection lineage mismatch.");
    const current = this.getAggregate(state.worktreeId);
    if (
      current &&
      (BigInt(state.projectionSequence) !==
        BigInt(current.projectionSequence) + 1n ||
        BigInt(state.revision) < BigInt(current.revision) ||
        BigInt(state.revision) > BigInt(current.revision) + 1n)
    )
      throw new Error("Assignment counters are not monotonic.");
    if ((current?.projectionSequence ?? null) !== expectedSequence)
      throw new Error("Assignment write lost its sequence compare-and-set.");
    this.insertGeneration(state.worktreeId, state.desiredGeneration, now);
    this.insertGeneration(state.worktreeId, state.verifiedGeneration, now);
    if (terminal)
      this.database
        .prepare(
          "UPDATE worktree_assignment_attempts SET status=?,updated_at=?,completed_at=? WHERE id=? AND worktree_id=?",
        )
        .run(
          terminal.status,
          now,
          ["recovery_required"].includes(terminal.status) ? null : now,
          terminal.id,
          state.worktreeId,
        );
    if (state.attempt) {
      // Supersede only targets that have not crossed a side-effect boundary.
      this.database
        .prepare(
          "UPDATE worktree_assignment_attempts SET status='superseded',completed_at=?,updated_at=? WHERE worktree_id=? AND id<>? AND status IN ('preparing','waiting_for_idle') AND side_effect_boundary='none'",
        )
        .run(now, now, state.worktreeId, state.attempt.attemptId);
      const a = state.attempt;
      this.database
        .prepare(
          `INSERT INTO worktree_assignment_attempts (id,worktree_id,kind,target_revision,target_generation_id,prior_verified_generation_id,status,side_effect_boundary,started_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,side_effect_boundary=excluded.side_effect_boundary,updated_at=excluded.updated_at,completed_at=excluded.completed_at`,
        )
        .run(
          a.attemptId,
          state.worktreeId,
          a.kind,
          BigInt(a.targetRevision),
          a.targetGenerationId,
          a.priorVerifiedGenerationId,
          a.status,
          a.sideEffectBoundary,
          Date.parse(a.createdAt),
          now,
          [
            "preparing",
            "waiting_for_idle",
            "applying",
            "rolling_back",
            "recovery_required",
          ].includes(a.status)
            ? null
            : now,
        );
    } else
      this.database
        .prepare(
          "UPDATE worktree_assignment_attempts SET status='cancelled',completed_at=?,updated_at=? WHERE worktree_id=? AND status IN ('preparing','waiting_for_idle')",
        )
        .run(now, now, state.worktreeId);
    this.database
      .prepare(
        `INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,failure_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(worktree_id) DO UPDATE SET revision=excluded.revision,projection_sequence=excluded.projection_sequence,phase=excluded.phase,desired_generation_id=excluded.desired_generation_id,verified_generation_id=excluded.verified_generation_id,failure_code=excluded.failure_code,updated_at=excluded.updated_at`,
      )
      .run(
        state.worktreeId,
        BigInt(state.revision),
        BigInt(state.projectionSequence),
        state.phase,
        state.desiredGeneration.id,
        state.verifiedGeneration.id,
        state.failure?.code ?? null,
        now,
        now,
      );
    if (
      [
        "stable",
        "failed_rolled_back",
        "recovery_required",
        "removing",
      ].includes(state.phase)
    ) {
      const active = this.database
        .prepare(
          "SELECT agent_kind agentKind,runtime_generation runtimeGeneration FROM worktree_runtime_assignment_attestations WHERE worktree_id=? AND invalidated_at IS NULL",
        )
        .all(state.worktreeId) as Array<{
        agentKind: string;
        runtimeGeneration: string;
      }>;
      for (const p of active)
        if (
          !state.participants.some(
            (expected) =>
              expected.agentKind === p.agentKind &&
              expected.runtimeGenerationId === p.runtimeGeneration,
          )
        )
          this.database
            .prepare(
              "UPDATE worktree_runtime_assignment_attestations SET invalidated_at=?,invalidation_code='runtime_unavailable' WHERE worktree_id=? AND agent_kind=? AND runtime_generation=? AND invalidated_at IS NULL",
            )
            .run(now, state.worktreeId, p.agentKind, p.runtimeGeneration);
    }
    for (const p of state.participants) {
      this.insertCatalog(state.worktreeId, p);
      this.database
        .prepare(
          `INSERT INTO worktree_runtime_assignment_attestations (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at,invalidated_at,invalidation_code) VALUES (?,?,?,?,?,?,?,?,NULL,NULL) ON CONFLICT(worktree_id,agent_kind,runtime_generation) DO UPDATE SET assignment_generation_id=excluded.assignment_generation_id,catalog_generation_id=excluded.catalog_generation_id,provider_version=excluded.provider_version,effective_state_digest=excluded.effective_state_digest,verified_at=excluded.verified_at,invalidated_at=NULL,invalidation_code=NULL`,
        )
        .run(
          state.worktreeId,
          p.agentKind,
          p.runtimeGenerationId,
          p.assignmentGenerationId,
          p.catalogGenerationId,
          p.providerVersion,
          p.effectiveStateDigest,
          Date.parse(p.attestedAt),
        );
    }
    this.database
      .prepare(
        "INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at) VALUES (?,?,?,?,'assignment.changed',1,?,?)",
      )
      .run(
        randomUUID(),
        state.worktreeId,
        BigInt(state.revision),
        BigInt(state.projectionSequence),
        JSON.stringify(safeProjection),
        now,
      );
  }
}
