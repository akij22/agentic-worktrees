import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  assignmentParticipantAttestationSchema,
  assignmentSetDesiredRequestSchema,
  assignmentRevisionRequestSchema,
  assignmentRecoverRequestSchema,
  resourceIdentitySchema,
  replaceDesiredAssignment,
  type AssignmentAggregate,
  type AssignmentChangedEventDto,
  type AssignmentProjectionDto,
  type AssignmentSetDesiredRequest,
  type AssignmentRevisionRequest,
  type AssignmentRecoverRequest,
  type ResourceAssignmentGeneration,
  type ResourceIdentity,
  type AssignmentParticipantAttestation,
} from "../../shared/assignments";
import {
  WorktreeRuntimeManager,
  type OwnedWorktreeRuntime,
  type WorktreeRuntimeLease,
} from "../coding-agents/worktree-runtime-manager";
import { DatabaseRuntimeAttestationVerifier } from "../coding-agents/worktree-runtime-attestation-verifier";
import { projectWorktreeAssignment } from "./assignment-coordinator-projection";
import {
  distributeResourceAssignment,
  recoverResourceDistribution,
  reconcileResourceDistributions,
  type AssignmentDistributionContext,
} from "./assignment-resource-distribution";
import { AssignmentCoordinatorStore } from "./assignment-coordinator-store";

type AgentKind = "codex" | "opencode";
export type AssignmentAdmissionLease = WorktreeRuntimeLease & {
  readonly assignmentGenerationId: string;
  readonly catalogGenerationId: string;
  readonly assignmentRevision: string;
};
export interface AssignmentResourcePort {
  resolve(
    selection: AssignmentSetDesiredRequest["resources"][number],
  ): Promise<ResourceIdentity>;
  prepare(generation: ResourceAssignmentGeneration): Promise<void>;
}
export interface PreparedAssignmentParticipant {
  readonly expected: AssignmentParticipantAttestation;
  readonly priorExpected: AssignmentParticipantAttestation;
  readonly projectionDigest: string;
  readonly priorProjectionDigest: string;
  stage(): Promise<void>;
  activate(): Promise<void>;
  verify(): Promise<AssignmentParticipantAttestation>;
  rollback(): Promise<AssignmentParticipantAttestation>;
  discard(): Promise<void>;
  finalize(): Promise<void>;
}
export interface AssignmentProviderPort {
  prepare(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
  ): Promise<PreparedAssignmentParticipant>;
}
export interface AssignmentServiceOptions {
  sqlite: BetterSqlite3.Database;
  runtimeManager: WorktreeRuntimeManager;
  resources: AssignmentResourcePort;
  providers: AssignmentProviderPort;
}
const increment = (value: string) => (BigInt(value) + 1n).toString();
export class WorktreeResourceAssignmentService {
  private readonly store: AssignmentCoordinatorStore;
  private publicationScheduled: ReturnType<typeof setImmediate> | null = null;
  private publicationError: unknown = null;
  private readonly reconciliationErrors = new Map<string, unknown>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly distributionIntents = new Map<string, { id: string; targetVersion: string | null; ready: Promise<void>; completion: Promise<void> }>();
  private readonly distributionReady = new Map<string, () => void>();
  private readonly supersededDistributions = new Set<string>();
  private readonly distributionControllers = new Map<string, AbortController>();
  private readonly projectionFingerprints = new Map<
    string,
    { sequence: string; fingerprint: string }
  >();
  private readonly removed = new Set<string>();
  private readonly frozen = new Set<string>();
  private readonly listeners = new Set<
    (event: AssignmentChangedEventDto) => void
  >();
  constructor(private readonly options: AssignmentServiceOptions) {
    this.store = new AssignmentCoordinatorStore(options.sqlite);
  }
  private state(worktreeId: string): AssignmentAggregate {
    const state = this.store.load(worktreeId);
    if (!state)
      throw Object.assign(new Error("Worktree Assignment is unavailable."), {
        code: this.removed.has(worktreeId)
          ? "worktree_removing"
          : "runtime_unavailable",
      });
    return state;
  }
  private projection(
    state: AssignmentAggregate,
    agentKind: AgentKind = "codex",
  ): AssignmentProjectionDto {
    const blockers =
      state.phase === "waiting_for_idle"
        ? this.options.runtimeManager
            .inspectWorktree(state.worktreeId)
            .blockers.map((kind) => ({
              kind,
              sessionRunId: null,
              sessionTitle: null,
              canStop: true,
            }))
        : [];
    const projection = projectWorktreeAssignment(state, agentKind, blockers);
    const live = this.options.runtimeManager
      .inspectWorktree(state.worktreeId)
      .runtimes.find((r) => r.agentKind === agentKind);
    const attested =
      live &&
      state.participants.some(
        (p) =>
          p.agentKind === agentKind &&
          p.runtimeGenerationId === live.generation &&
          p.assignmentGenerationId === state.verifiedGeneration.id &&
          p.providerVersion === live.providerVersion,
      );
    if (
      live &&
      !attested &&
      ["stable", "failed_rolled_back"].includes(state.phase)
    ) {
      projection.admission = {
        canCreateSession: false,
        canResumeSession: false,
        canSend: false,
        reason: "runtime_verification",
        message:
          "The owned runtime must verify its Assignment before agent work.",
      };
      projection.resources = projection.resources.map((r) =>
        r.status === "enabled"
          ? {
              ...r,
              status: "unavailable",
              unavailableReason: "provider_unqualified",
            }
          : r,
      );
    }
    return projection;
  }
  private distributionContext(): AssignmentDistributionContext {
    return {
      store: this.store,
      options: this.options,
      distributionControllers: this.distributionControllers,
      frozen: this.frozen,
      supersededDistributions: this.supersededDistributions,
      distributionIntentReady: id => this.distributionReady.get(id)?.(),
      state: (id) => this.state(id),
      projection: (state) => this.projection(state),
      save: (state, previous, terminal) => this.save(state, previous, terminal),
      queuePublication: () => this.queuePublication(),
      publishOutbox: () => this.publishOutbox(),
      waitForReconciliation: (id) => this.waitForReconciliation(id),
      applyTarget: (id) => this.applyTarget(id),
      newAttempt: (state, prior) => this.newAttempt(state, prior),
      prepareParticipant: (runtime, target, prior) =>
        this.prepareParticipant(runtime, target, prior),
      validatePlan: (runtime, target, prior, plan) =>
        this.validatePlan(runtime, target, prior, plan),
      exact: (actual, expected) => this.exact(actual, expected),
      assertParticipantLive: (id, attestation) =>
        this.assertParticipantLive(id, attestation),
      assertPlanLive: (id, plan) => this.assertPlanLive(id, plan),
      advanceBoundary: (id, boundary) => this.advanceBoundary(id, boundary),
      revision: (input) => this.revision(input),
    };
  }

  async get(
    worktreeId: string,
    agentKind: AgentKind = "codex",
  ): Promise<AssignmentProjectionDto> {
    let state = this.state(worktreeId);
    const last = this.store.getProjection(worktreeId),
      current = this.projection(state, agentKind),
      key = `${worktreeId}:${agentKind}`;
    const fingerprint = (projection: AssignmentProjectionDto) =>
      JSON.stringify({
        blockers: projection.blockers,
        admission: projection.admission,
        resources: projection.resources.map((r) => ({
          kind: r.kind,
          id: r.id,
          version: r.version,
          status: r.status,
        })),
      });
    const cached = this.projectionFingerprints.get(key);
    const prior =
      cached?.sequence === state.projectionSequence
        ? cached.fingerprint
        : last?.currentAgentKind === agentKind
          ? fingerprint(last)
          : undefined;
    if (prior && prior !== fingerprint(current)) {
      const updated = {
        ...state,
        projectionSequence: increment(state.projectionSequence),
        updatedAt: new Date().toISOString(),
      };
      this.save(updated, state);
      state = updated;
    }
    const result = this.projection(state, agentKind);
    this.projectionFingerprints.set(key, {
      sequence: result.projectionSequence,
      fingerprint: fingerprint(result),
    });
    return result;
  }
  subscribe(listener: (event: AssignmentChangedEventDto) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async publishOutbox(): Promise<void> {
    if (this.publicationScheduled) {
      clearImmediate(this.publicationScheduled);
      this.publicationScheduled = null;
    }
    for (;;) {
      const page = this.store.listPendingOutbox();
      if (page.length === 0) break;
      for (const row of page) {
        const event = {
          eventId: row.eventId,
          worktreeId: row.worktreeId,
          revision: row.revision,
          projectionSequence: row.projectionSequence,
          projection: row.projection,
        };
        for (const listener of this.listeners) listener(event);
        this.store.markOutboxPublished(row.eventId, new Date());
      }
    }
    this.publicationError = null;
  }
  getPublicationStatus(): { pending: boolean; unavailable: boolean } {
    return {
      pending: this.store.listPendingOutbox(1).length > 0,
      unavailable: this.publicationError !== null,
    };
  }
  private queuePublication(): void {
    if (this.publicationScheduled) return;
    this.publicationScheduled = setImmediate(() => {
      this.publicationScheduled = null;
      void this.publishOutbox().catch((error) => {
        this.publicationError = error;
      });
    });
  }
  private save(
    state: AssignmentAggregate,
    previous: AssignmentAggregate | null,
    terminal?: { id: string; status: string },
  ): void {
    this.store.persist(
      state,
      this.projection(state),
      previous?.projectionSequence ?? null,
      terminal,
    );
    this.queuePublication();
  }
  async reconcileStartup(): Promise<void> {
    await reconcileResourceDistributions(this.distributionContext());
    for (const worktreeId of this.store.listWorktrees()) {
      const gate = await this.options.runtimeManager.acquireAdmission(
        worktreeId,
        "exclusive",
      );
      try {
        const current = this.store.load(worktreeId);
        if (!current) {
          const generation = this.store.generation(worktreeId, []);
          this.save(
            {
              worktreeId,
              revision: "0",
              projectionSequence: "0",
              desiredGeneration: generation,
              verifiedGeneration: generation,
              phase: "stable",
              attempt: null,
              participants: [],
              failure: null,
              updatedAt: new Date().toISOString(),
            },
            null,
          );
        } else if (
          current.attempt &&
          current.attempt.sideEffectBoundary !== "none" &&
          current.phase !== "recovery_required"
        ) {
          const next: AssignmentAggregate = {
            ...current,
            phase: "recovery_required",
            attempt: { ...current.attempt, status: "recovery_required" },
            participants: [],
            failure: {
              code: "assignment_recovery_required",
              message: "An interrupted Resource change requires recovery.",
            },
            projectionSequence: increment(current.projectionSequence),
            updatedAt: new Date().toISOString(),
          };
          this.save(next, current);
        } else if (current.phase === "waiting_for_idle")
          this.schedule(worktreeId);
      } finally {
        gate.release();
      }
    }
    await this.publishOutbox();
  }
  async setDesired(
    raw: AssignmentSetDesiredRequest,
  ): Promise<AssignmentProjectionDto> {
    const input = assignmentSetDesiredRequestSchema.parse(raw);
    this.revision(input);

    const resources = await Promise.all(
      input.resources.map(async (selection) => {
        const resource = resourceIdentitySchema.parse(
          await this.options.resources.resolve(selection),
        );
        if (
          resource.kind !== selection.kind ||
          resource.id !== selection.id ||
          resource.version !== selection.version ||
          resource.providerProjections.every(
            (p) => p.availability !== "compatible",
          )
        )
          throw Object.assign(
            new Error("The selected Resource is unavailable."),
            { code: "assignment_invalid_resource" },
          );
        return resource;
      }),
    );
    resources.sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    );
    const latest = this.state(input.worktreeId);
    for (const barrier of this.store.activeDistributions()) {
      const resource = resources.find(
          (r) => r.kind === barrier.kind && r.id === barrier.resourceId,
        ),
        previous = latest.desiredGeneration.resources.find(
          (r) => r.kind === barrier.kind && r.id === barrier.resourceId,
        );
      if (resource && JSON.stringify(resource) !== JSON.stringify(previous))
        throw Object.assign(
          new Error("This Resource has an update in progress."),
          { code: "resource_update_pending", current: this.projection(latest) },
        );
    }
    if (this.frozen.has(input.worktreeId)) {
      const gate = await this.options.runtimeManager.acquireAdmission(
        input.worktreeId,
        "normal",
      );
      gate.release();
    }
    const afterBarrier = this.state(input.worktreeId);
    const result = replaceDesiredAssignment(afterBarrier, {
      expectedRevision: input.expectedRevision,
      attemptId: randomUUID(),
      targetGeneration: this.store.generation(input.worktreeId, resources),
      acceptedAt: new Date().toISOString(),
    });
    if (result.kind === "conflict")
      throw Object.assign(
        new Error("Assignment changed. Refresh and try again."),
        { code: "assignment_conflict", current: this.projection(afterBarrier) },
      );
    if (result.kind === "rejected")
      throw Object.assign(new Error("Assignment is unavailable."), {
        code:
          result.reason === "recovery_required"
            ? "assignment_recovery_required"
            : result.reason === "worktree_removing"
              ? "worktree_removing"
              : "assignment_invalid_resource",
        current: this.projection(afterBarrier),
      });
    if (result.kind === "accepted") {
      this.save(result.state, afterBarrier);
      this.schedule(input.worktreeId);
    }

    return this.projection(result.state);
  }
  startDistribution(input: {
    kind: "skill" | "capability";
    id: string;
    targetVersion: string | null;
  }): { operationId: string; completion: Promise<void> } {
    const operationId = randomUUID();
    return {
      operationId,
      completion: this.distribute({ ...input, operationId }),
    };
  }
  async cancelDistribution(operationId: string): Promise<void> {
    const parent = this.store
      .activeDistributions()
      .find((p) => p.id === operationId);
    if (!parent || !["none", "gates_acquired"].includes(parent.boundary))
      throw Object.assign(new Error("This update has already started."), {
        code: "operation_cancelled",
      });
    const controller = this.distributionControllers.get(operationId);
    if (!controller)
      throw Object.assign(
        new Error("This interrupted update requires recovery."),
        { code: "assignment_recovery_required" },
      );
    controller.abort();
  }
  async distribute(input: { kind: "skill" | "capability"; id: string; targetVersion: string | null; operationId?: string }): Promise<void> {
    const key = `${input.kind}:${input.id}`, previous = this.distributionIntents.get(key);
    if (previous) {
      if (previous.targetVersion === input.targetVersion) throw Object.assign(new Error("This Resource already has an update in progress."), { code: "resource_update_pending" });
      await previous.ready;
      const active = this.store.activeDistributions().find(parent => parent.id === previous.id);
      if (active) {
        if (!["none", "gates_acquired"].includes(active.boundary)) throw Object.assign(new Error("The current Resource update has already started."), { code: "resource_update_pending" });
        this.supersededDistributions.add(previous.id); await this.cancelDistribution(previous.id);
      }
      try { await previous.completion; } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "operation_cancelled")) throw error; }
      return this.distribute(input);
    }
    const id = input.operationId ?? randomUUID(); let markReady!: () => void;
    const ready = new Promise<void>(resolve => { markReady = resolve; }); this.distributionReady.set(id, markReady);
    const completion = distributeResourceAssignment(this.distributionContext(), { ...input, operationId: id });
    this.distributionIntents.set(key, { id, targetVersion: input.targetVersion, ready, completion });
    try { await completion; }
    finally { markReady(); this.distributionReady.delete(id); this.supersededDistributions.delete(id); if (this.distributionIntents.get(key)?.id === id) this.distributionIntents.delete(key); }
  }
  private async prepareParticipant(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
  ): Promise<PreparedAssignmentParticipant> {
    const freeze = <T>(value: T): T => {
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
      return value;
    };
    const raw = await this.options.providers.prepare(
      runtime,
      freeze(structuredClone(target)),
      freeze(structuredClone(prior)),
    );
    return {
      projectionDigest: raw.projectionDigest,
      priorProjectionDigest: raw.priorProjectionDigest,
      expected: Object.freeze(
        assignmentParticipantAttestationSchema.parse(raw.expected),
      ),
      priorExpected: Object.freeze(
        assignmentParticipantAttestationSchema.parse(raw.priorExpected),
      ),
      stage: raw.stage.bind(raw),
      activate: raw.activate.bind(raw),
      verify: raw.verify.bind(raw),
      rollback: raw.rollback.bind(raw),
      discard: raw.discard.bind(raw),
      finalize: raw.finalize.bind(raw),
    };
  }
  private validatePlan(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
    plan: PreparedAssignmentParticipant,
  ): void {
    for (const [expected, generation] of [
      [plan.expected, target],
      [plan.priorExpected, prior],
    ] as const) {
      assignmentParticipantAttestationSchema.parse(expected);
      if (
        expected.agentKind !== runtime.agentKind ||
        (expected.runtimeGenerationId !== runtime.generation &&
          !(
            generation.id === target.id &&
            this.options.runtimeManager.ownsAssignmentReplacement(
              runtime.agentKind,
              runtime.worktreeId,
              runtime.generation,
              expected.runtimeGenerationId,
            )
          )) ||
        expected.providerVersion !== runtime.providerVersion ||
        expected.assignmentGenerationId !== generation.id
      )
        throw new Error("Provider plan lineage mismatch.");
      const skills = generation.resources.filter(
        (r) =>
          r.kind === "skill" &&
          r.providerProjections.some(
            (p) =>
              p.agentKind === runtime.agentKind &&
              p.availability === "compatible",
          ),
      );
      if (
        skills.some(
          (r) =>
            r.providerProjections.find((p) => p.agentKind === runtime.agentKind)
              ?.skillIsolation !== expected.skillIsolation,
        )
      )
        throw new Error("Provider Skill isolation mismatch.");
    }
  }
  async removeWorktree(worktreeId: string): Promise<void> {
    if (this.frozen.has(worktreeId)) {
      const gate = await this.options.runtimeManager.acquireAdmission(
        worktreeId,
        "normal",
      );
      gate.release();
    }
    let state = this.state(worktreeId);
    if (
      state.phase === "waiting_for_idle" &&
      state.attempt?.kind === "assignment_apply"
    )
      await this.cancelPending({
        worktreeId,
        expectedRevision: state.revision,
      });
    if (["applying", "rolling_back"].includes(state.phase))
      await this.waitForReconciliation(worktreeId);
    state = this.state(worktreeId);
    const removing: AssignmentAggregate = {
      ...state,
      phase: "removing",
      attempt: null,
      projectionSequence: increment(state.projectionSequence),
      updatedAt: new Date().toISOString(),
    };
    this.save(
      removing,
      state,
      state.attempt
        ? { id: state.attempt.attemptId, status: "cancelled" }
        : undefined,
    );
    await this.options.runtimeManager.stopWorktree(worktreeId, async () => {
      this.store.removeWorktree(worktreeId);
    });
    this.removed.add(worktreeId);
  }
  private revision(input: AssignmentRevisionRequest): AssignmentAggregate {
    const parsed = assignmentRevisionRequestSchema.parse({
        worktreeId: input.worktreeId,
        expectedRevision: input.expectedRevision,
      }),
      state = this.state(parsed.worktreeId);
    if (parsed.expectedRevision !== state.revision)
      throw Object.assign(
        new Error("Assignment changed. Refresh and try again."),
        { code: "assignment_conflict", current: this.projection(state) },
      );
    return state;
  }
  async recover(
    raw: AssignmentRecoverRequest,
  ): Promise<AssignmentProjectionDto> {
    const input = assignmentRecoverRequestSchema.parse(raw);
    this.revision(input);
    const parent = this.store
      .activeDistributions()
      .find((parent) =>
        this.store.distributionWorktrees(parent.id).includes(input.worktreeId),
      );
    if (parent && input.action !== "revert_desired") {
      await recoverResourceDistribution(
        this.distributionContext(),
        parent.id,
        input,
      );
      return this.get(input.worktreeId);
    }
    const gate = await this.options.runtimeManager.acquireAdmission(
      input.worktreeId,
      "exclusive",
    );
    try {
      let state = this.revision(input);
      if (state.phase !== "recovery_required")
        throw Object.assign(
          new Error("Assignment does not require recovery."),
          { code: "assignment_recovery_required" },
        );
      if (
        input.action === "revert_desired" &&
        state.desiredGeneration.id !== state.verifiedGeneration.id
      ) {
        const reverted = {
          ...state,
          desiredGeneration: state.verifiedGeneration,
          revision: increment(state.revision),
          projectionSequence: increment(state.projectionSequence),
          updatedAt: new Date().toISOString(),
        };
        this.save(reverted, state);
        state = reverted;
        return this.projection(state);
      }
      if (
        input.action === "retry_recovery" &&
        (await this.tryRecoverTarget(state))
      )
        return this.get(state.worktreeId);
      await this.options.resources.prepare(state.verifiedGeneration);
      await this.options.runtimeManager.recoverAssignmentReplacements(
        state.worktreeId,
      );
      const snapshot = this.options.runtimeManager.inspectWorktree(
        state.worktreeId,
      );
      if (snapshot.busy) throw new Error("Recovery participants are not idle.");
      const restored: AssignmentParticipantAttestation[] = [];
      for (const runtime of snapshot.runtimes) {
        let proved = false;
        if (input.action === "retry_recovery") {
          try {
            const plan = await this.prepareParticipant(
              runtime,
              state.verifiedGeneration,
              state.verifiedGeneration,
            );
            this.exact(await plan.verify(), plan.expected);
            this.store.prepareCatalog(
              state.worktreeId,
              plan.expected,
              plan.projectionDigest,
            );
            restored.push(plan.expected);
            proved = true;
          } catch {
            proved = false;
          }
        }
        if (!proved)
          await this.options.runtimeManager.retireAssignmentRuntime(
            runtime.agentKind,
            state.worktreeId,
            runtime.generation,
          );
      }
      const next: AssignmentAggregate = {
        ...state,
        phase:
          state.desiredGeneration.id === state.verifiedGeneration.id
            ? "stable"
            : "failed_rolled_back",
        attempt: null,
        participants: restored,
        projectionSequence: increment(state.projectionSequence),
        updatedAt: new Date().toISOString(),
        failure:
          state.desiredGeneration.id === state.verifiedGeneration.id
            ? null
            : {
                code: "assignment_apply_failed",
                message:
                  "The prior Resource generation was restored. Retry the desired change explicitly.",
              },
      };
      this.save(
        next,
        state,
        state.attempt
          ? { id: state.attempt.attemptId, status: "failed_rolled_back" }
          : undefined,
      );
      return this.projection(next);
    } catch (error) {
      throw Object.assign(
        new Error("Resource recovery could not be verified.", { cause: error }),
        { code: "assignment_recovery_required" },
      );
    } finally {
      gate.release();
    }
  }
  private async tryRecoverTarget(state: AssignmentAggregate): Promise<boolean> {
    if (!state.attempt) return false;
    const expected = this.store.targetParticipants(state.attempt.attemptId),
      snapshot = this.options.runtimeManager.inspectWorktree(state.worktreeId);
    if (
      !expected.length ||
      snapshot.busy ||
      snapshot.runtimes.length !== expected.length
    )
      return false;
    const target = this.store.loadGeneration(state.attempt.targetGenerationId),
      proved: AssignmentParticipantAttestation[] = [];
    try {
      await this.options.resources.prepare(target);
      for (const runtime of snapshot.runtimes) {
        const journal = expected.find(
          (p) =>
            p.agentKind === runtime.agentKind &&
            p.runtimeGenerationId === runtime.generation,
        );
        if (!journal) return false;
        const plan = await this.prepareParticipant(
          runtime,
          target,
          state.verifiedGeneration,
        );
        this.validatePlan(runtime, target, state.verifiedGeneration, plan);
        for (const key of Object.keys(journal) as Array<keyof typeof journal>)
          if (journal[key] !== plan.expected[key]) return false;
        this.exact(await plan.verify(), plan.expected);
        this.assertParticipantLive(state.worktreeId, plan.expected);
        proved.push(plan.expected);
      }
    } catch {
      return false;
    }
    const latest = this.state(state.worktreeId),
      same = latest.desiredGeneration.id === target.id;
    const next: AssignmentAggregate = {
      ...latest,
      verifiedGeneration: target,
      phase: same ? "stable" : "waiting_for_idle",
      participants: proved,
      failure: null,
      attempt: same ? null : this.newAttempt(latest, target.id),
      projectionSequence: increment(latest.projectionSequence),
      updatedAt: new Date().toISOString(),
    };
    for (const participant of proved)
      this.store.participantProgress(
        state.attempt.attemptId,
        participant,
        "verified",
      );
    this.save(next, latest, {
      id: state.attempt.attemptId,
      status: "verified",
    });
    if (!same) this.schedule(state.worktreeId);
    return true;
  }
  async retryApply(
    input: AssignmentRevisionRequest,
  ): Promise<AssignmentProjectionDto> {
    const state = this.revision(input);
    if (state.phase !== "failed_rolled_back")
      throw Object.assign(
        new Error("Assignment cannot be retried in its current state."),
        { code: "assignment_apply_failed" },
      );
    const next: AssignmentAggregate = {
      ...state,
      phase: "waiting_for_idle",
      attempt: this.newAttempt(state, state.verifiedGeneration.id),
      failure: null,
      projectionSequence: increment(state.projectionSequence),
      updatedAt: new Date().toISOString(),
    };
    this.save(next, state);
    this.schedule(state.worktreeId);
    return this.projection(next);
  }
  async cancelPending(
    input: AssignmentRevisionRequest,
  ): Promise<AssignmentProjectionDto> {
    const state = this.revision(input);
    if (
      state.phase !== "waiting_for_idle" ||
      state.attempt?.kind !== "assignment_apply" ||
      state.attempt?.sideEffectBoundary !== "none"
    )
      throw Object.assign(new Error("This change has already started."), {
        code: "operation_cancelled",
      });
    const result = replaceDesiredAssignment(state, {
      expectedRevision: state.revision,
      attemptId: randomUUID(),
      targetGeneration: state.verifiedGeneration,
      acceptedAt: new Date().toISOString(),
    });
    if (result.kind !== "accepted" && result.kind !== "unchanged")
      throw new Error("Pending cancellation was rejected.");
    if (result.kind === "accepted") this.save(result.state, state);
    return this.projection(result.state);
  }
  private schedule(worktreeId: string): void {
    if (this.running.has(worktreeId)) return;
    const task = new Promise<void>((resolve) => setImmediate(resolve)).then(
      () => this.reconcile(worktreeId),
    );
    this.reconciliationErrors.delete(worktreeId);
    this.running.set(worktreeId, task);
    void task.then(
      () => this.running.delete(worktreeId),
      (error) => {
        this.running.delete(worktreeId);
        this.reconciliationErrors.set(worktreeId, error);
      },
    );
  }
  async waitForReconciliation(worktreeId: string): Promise<void> {
    await this.running.get(worktreeId);
    if (this.reconciliationErrors.has(worktreeId))
      throw this.reconciliationErrors.get(worktreeId);
  }
  private assertPlanLive(
    worktreeId: string,
    plan: PreparedAssignmentParticipant,
  ): void {
    this.assertParticipantLive(worktreeId, plan.expected);
    if (
      plan.expected.runtimeGenerationId !==
        plan.priorExpected.runtimeGenerationId &&
      !this.options.runtimeManager.ownsAssignmentReplacement(
        plan.expected.agentKind,
        worktreeId,
        plan.priorExpected.runtimeGenerationId,
        plan.expected.runtimeGenerationId,
      )
    )
      throw new Error("Replacement rollback candidate is unavailable.");
  }
  private assertParticipantLive(
    worktreeId: string,
    attestation: AssignmentParticipantAttestation,
  ): void {
    const runtime = this.options.runtimeManager
      .inspectWorktree(worktreeId)
      .runtimes.find(
        (r) =>
          r.agentKind === attestation.agentKind &&
          r.generation === attestation.runtimeGenerationId &&
          r.providerVersion === attestation.providerVersion,
      );
    if (!runtime)
      throw new Error("The owned runtime generation is no longer live.");
  }
  private advanceBoundary(
    worktreeId: string,
    boundary: "activated" | "commit_pending",
  ): void {
    const state = this.state(worktreeId);
    if (!state.attempt || state.phase !== "applying")
      throw new Error("Assignment boundary requires an applying attempt.");
    this.save(
      {
        ...state,
        attempt: { ...state.attempt, sideEffectBoundary: boundary },
        projectionSequence: increment(state.projectionSequence),
        updatedAt: new Date().toISOString(),
      },
      state,
    );
  }
  private exact(
    actual: AssignmentParticipantAttestation,
    expected: AssignmentParticipantAttestation,
  ): void {
    const parsed = assignmentParticipantAttestationSchema.parse(actual);
    for (const key of Object.keys(expected) as Array<
      keyof AssignmentParticipantAttestation
    >) {
      if (key !== "attestedAt" && parsed[key] !== expected[key])
        throw new Error("Runtime attestation mismatch.");
    }
  }
  private async reconcile(worktreeId: string): Promise<void> {
    const lease = await this.options.runtimeManager.acquireAdmission(
      worktreeId,
      "exclusive",
    );
    try {
      while (this.state(worktreeId).phase === "waiting_for_idle")
        await this.applyTarget(worktreeId);
    } finally {
      lease.release();
    }
    await this.publishOutbox();
  }
  private async applyTarget(worktreeId: string): Promise<void> {
    const current = this.state(worktreeId),
      target = current.desiredGeneration;
    const pinned: Array<{ release(): void }> = [],
      plans: PreparedAssignmentParticipant[] = [],
      touched: PreparedAssignmentParticipant[] = [];
    let attempt = current.attempt,
      committed = false;
    try {
      await this.options.resources.prepare(target);
      const first = this.options.runtimeManager.inspectWorktree(worktreeId);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const second = this.options.runtimeManager.inspectWorktree(worktreeId);
      if (first.busy || second.busy || first.fingerprint !== second.fingerprint)
        return;
      for (const runtime of second.runtimes) {
        if (
          target.resources.some(
            (r) =>
              r.providerProjections.find(
                (p) => p.agentKind === runtime.agentKind,
              )?.availability !== "compatible",
          )
        )
          continue;
        pinned.push(
          await this.options.runtimeManager.acquireControlRuntime(
            runtime.agentKind,
            worktreeId,
            runtime.generation,
          ),
        );
        const plan = await this.prepareParticipant(
          runtime,
          target,
          current.verifiedGeneration,
        );
        this.validatePlan(runtime, target, current.verifiedGeneration, plan);
        plans.push(plan);
      }
      const latest = this.state(worktreeId);
      if (
        latest.revision !== current.revision ||
        latest.attempt?.attemptId !== current.attempt?.attemptId
      ) {
        for (const plan of plans) await plan.discard();
        return;
      }
      attempt = current.attempt;
      if (!attempt) throw new Error("Missing Assignment attempt.");
      this.store.planParticipants(
        attempt.attemptId,
        plans.map((p) => p.expected),
        plans.map((p) => p.priorExpected),
        plans.flatMap((p) => [
          { id: p.expected.catalogGenerationId, digest: p.projectionDigest },
          {
            id: p.priorExpected.catalogGenerationId,
            digest: p.priorProjectionDigest,
          },
        ]),
      );
      const applying = {
        ...latest,
        phase: "applying" as const,
        projectionSequence: increment(latest.projectionSequence),
        updatedAt: new Date().toISOString(),
        attempt: {
          ...attempt,
          status: "applying" as const,
          sideEffectBoundary: "staged" as const,
        },
      };
      this.save(applying, latest);
      attempt = applying.attempt;
      for (const plan of plans) {
        touched.push(plan);
        this.store.participantProgress(
          attempt.attemptId,
          plan.expected,
          "staged",
        );
        await plan.stage();
      }
      this.advanceBoundary(worktreeId, "activated");
      for (const plan of plans) {
        this.store.participantProgress(
          attempt.attemptId,
          plan.expected,
          "activated",
        );
        await plan.activate();
        this.exact(await plan.verify(), plan.expected);
        this.assertPlanLive(worktreeId, plan);
        this.store.participantProgress(
          attempt.attemptId,
          plan.expected,
          "verified",
        );
      }
      for (const plan of plans) this.assertPlanLive(worktreeId, plan);
      this.advanceBoundary(worktreeId, "commit_pending");
      const live = this.state(worktreeId),
        same = live.desiredGeneration.id === target.id;
      const committedState: AssignmentAggregate = {
        ...live,
        phase: same ? "stable" : "waiting_for_idle",
        verifiedGeneration: target,
        participants: plans.map((p) => p.expected),
        failure: null,
        attempt: same ? null : this.newAttempt(live, target.id),
        projectionSequence: increment(live.projectionSequence),
        updatedAt: new Date().toISOString(),
      };
      this.save(committedState, live, {
        id: attempt.attemptId,
        status: "verified",
      });
      committed = true;
      const cleanupFailures: unknown[] = [];
      for (const plan of plans) {
        try {
          await plan.finalize();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (cleanupFailures.length)
        throw new AggregateError(
          cleanupFailures,
          "Runtime replacement finalization failed.",
        );
    } catch (error) {
      const live = this.state(worktreeId);
      if (committed) {
        const recovery: AssignmentAggregate = {
          ...live,
          phase: "recovery_required",
          attempt: null,
          participants: [],
          failure: {
            code: "assignment_recovery_required",
            message:
              "Committed Resources require owned-runtime cleanup recovery.",
          },
          projectionSequence: increment(live.projectionSequence),
          updatedAt: new Date().toISOString(),
        };
        this.save(
          recovery,
          live,
          live.attempt
            ? { id: live.attempt.attemptId, status: "cancelled" }
            : undefined,
        );
        return;
      }
      if (!attempt || live.attempt?.attemptId !== attempt.attemptId)
        throw error;
      let rollbackVerified = true;
      if (touched.length) {
        const rolling: AssignmentAggregate = {
          ...live,
          phase: "rolling_back",
          projectionSequence: increment(live.projectionSequence),
          updatedAt: new Date().toISOString(),
          attempt: live.attempt
            ? { ...live.attempt, status: "rolling_back" }
            : null,
        };
        this.save(rolling, live);
        for (const plan of [...touched].reverse()) {
          try {
            this.store.participantProgress(
              attempt.attemptId,
              plan.expected,
              "rollback_started",
            );
            this.exact(await plan.rollback(), plan.priorExpected);
            this.assertParticipantLive(worktreeId, plan.priorExpected);
            this.store.participantProgress(
              attempt.attemptId,
              plan.expected,
              "rolled_back",
            );
          } catch {
            rollbackVerified = false;
          }
        }
      }
      for (const plan of plans) {
        try {
          await plan.discard();
        } catch {
          rollbackVerified = false;
        }
      }
      const after = this.state(worktreeId),
        superseded = after.desiredGeneration.id !== target.id,
        reverted = after.desiredGeneration.id === after.verifiedGeneration.id;
      const phase = !rollbackVerified
        ? "recovery_required"
        : reverted
          ? "stable"
          : superseded
            ? "waiting_for_idle"
            : "failed_rolled_back";
      const failed: AssignmentAggregate = {
        ...after,
        phase,
        participants: rollbackVerified
          ? touched.map((p) => p.priorExpected)
          : [],
        projectionSequence: increment(after.projectionSequence),
        updatedAt: new Date().toISOString(),
        failure:
          phase === "recovery_required"
            ? {
                code: "assignment_recovery_required",
                message: "Resource state requires recovery.",
              }
            : phase === "failed_rolled_back"
              ? {
                  code: "assignment_apply_failed",
                  message: "Resources could not be applied.",
                }
              : null,
        attempt:
          phase === "recovery_required" && after.attempt
            ? { ...after.attempt, status: "recovery_required" }
            : phase === "waiting_for_idle"
              ? this.newAttempt(after, after.verifiedGeneration.id)
              : null,
      };
      this.save(
        failed,
        after,
        attempt
          ? {
              id: attempt.attemptId,
              status: rollbackVerified
                ? "failed_rolled_back"
                : "recovery_required",
            }
          : undefined,
      );
    } finally {
      for (const runtime of pinned.reverse()) runtime.release();
    }
  }
  async withSessionAdmission<T>(
    request: {
      worktreeId: string;
      agentKind: AgentKind;
      runId: string;
      operation: "create" | "resume";
      externalSessionId?: string;
      signal?: AbortSignal;
    },
    operation: (lease: AssignmentAdmissionLease) => Promise<T>,
  ): Promise<T> {
    return this.admit(request, operation);
  }
  async withTurnAdmission<T>(
    request: {
      worktreeId: string;
      agentKind: AgentKind;
      runId: string;
      externalSessionId: string;
      explicitResources?: AssignmentSetDesiredRequest["resources"];
      signal?: AbortSignal;
    },
    operation: (lease: AssignmentAdmissionLease) => Promise<T>,
  ): Promise<T> {
    return this.admit({ ...request, operation: "turn" }, operation);
  }
  private assertAdmission(state: AssignmentAggregate): void {
    if (!["stable", "failed_rolled_back"].includes(state.phase))
      throw Object.assign(
        new Error("Resource state is not ready for agent work."),
        {
          code:
            state.phase === "recovery_required"
              ? "assignment_recovery_required"
              : state.phase === "removing"
                ? "worktree_removing"
                : "assignment_waiting_for_idle",
          current: this.projection(state),
        },
      );
  }
  private async admit<T>(
    request: {
      worktreeId: string;
      agentKind: AgentKind;
      runId: string;
      operation: "create" | "resume" | "turn";
      externalSessionId?: string;
      explicitResources?: AssignmentSetDesiredRequest["resources"];
      signal?: AbortSignal;
    },
    operation: (lease: AssignmentAdmissionLease) => Promise<T>,
  ): Promise<T> {
    const current = this.state(request.worktreeId);
    this.assertAdmission(current);
    if (
      current.verifiedGeneration.resources.some(
        (r) =>
          r.providerProjections.find((p) => p.agentKind === request.agentKind)
            ?.availability !== "compatible",
      )
    )
      throw Object.assign(
        new Error("The verified Assignment is unavailable for this provider."),
        {
          code: "resource_unavailable",
          current: this.projection(current, request.agentKind),
        },
      );
    for (const selected of request.explicitResources ?? []) {
      const verified = current.verifiedGeneration.resources.find(
        (r) =>
          r.kind === selected.kind &&
          r.id === selected.id &&
          r.version === selected.version,
      );
      if (
        !verified ||
        verified.providerProjections.find(
          (p) => p.agentKind === request.agentKind,
        )?.availability !== "compatible"
      )
        throw Object.assign(
          new Error(
            "The requested Resource is unavailable in the verified Assignment.",
          ),
          {
            code: "resource_unavailable",
            current: this.projection(current, request.agentKind),
          },
        );
    }
    await this.verifyLazyRuntime(
      request.worktreeId,
      request.agentKind,
      request.signal,
    );
    const state = this.state(request.worktreeId);
    this.assertAdmission(state);
    const participant = state.participants.find(
      (p) => p.agentKind === request.agentKind,
    );
    if (!participant)
      throw Object.assign(new Error("Runtime Assignment is not verified."), {
        code: "runtime_unavailable",
      });
    const lease = await this.options.runtimeManager.acquireProviderSession({
      ...request,
      assignmentGenerationId: state.verifiedGeneration.id,
      catalogGenerationId: participant.catalogGenerationId,
    });
    try {
      const admitted = this.state(request.worktreeId);
      this.assertAdmission(admitted);
      if (admitted.verifiedGeneration.id !== state.verifiedGeneration.id)
        throw new Error("Assignment changed during admission.");
      return await operation({
        ...lease,
        assignmentGenerationId: state.verifiedGeneration.id,
        catalogGenerationId: participant.catalogGenerationId,
        assignmentRevision: state.revision,
      });
    } finally {
      lease.release();
    }
  }
  private async verifyLazyRuntime(
    worktreeId: string,
    agentKind: AgentKind,
    signal?: AbortSignal,
  ): Promise<void> {
    const gate = await this.options.runtimeManager.acquireAdmission(
      worktreeId,
      "exclusive",
      { signal },
    );
    let runtime: WorktreeRuntimeLease | undefined;
    try {
      const state = this.state(worktreeId);
      this.assertAdmission(state);
      runtime = await this.options.runtimeManager.acquireRuntime(
        agentKind,
        worktreeId,
        { signal },
      );
      const owned = runtime.runtime;
      const existing = state.participants.find(
        (p) =>
          p.agentKind === agentKind &&
          p.runtimeGenerationId === owned.generation,
      );
      if (
        existing &&
        (await new DatabaseRuntimeAttestationVerifier(
          this.options.sqlite,
        ).verify({
          agentKind,
          worktreeId,
          runtimeGeneration: runtime.runtime.generation,
          providerVersion: runtime.runtime.providerVersion,
          assignmentGenerationId: state.verifiedGeneration.id,
          catalogGenerationId: existing.catalogGenerationId,
        }))
      )
        return;
      await this.options.resources.prepare(state.verifiedGeneration);
      const plan = await this.prepareParticipant(
        runtime.runtime,
        state.verifiedGeneration,
        state.verifiedGeneration,
      );
      if (
        plan.expected.assignmentGenerationId !== state.verifiedGeneration.id ||
        plan.expected.runtimeGenerationId !== runtime.runtime.generation ||
        plan.expected.agentKind !== agentKind ||
        plan.expected.providerVersion !== runtime.runtime.providerVersion
      )
        throw new Error("Lazy runtime plan lineage mismatch.");
      this.validatePlan(
        runtime.runtime,
        state.verifiedGeneration,
        state.verifiedGeneration,
        plan,
      );
      await plan.stage();
      await plan.activate();
      this.exact(await plan.verify(), plan.expected);
      this.assertPlanLive(worktreeId, plan);
      this.store.prepareCatalog(
        worktreeId,
        plan.expected,
        plan.projectionDigest,
      );
      const next = {
        ...state,
        participants: [
          ...state.participants.filter((p) => p.agentKind !== agentKind),
          plan.expected,
        ],
        projectionSequence: increment(state.projectionSequence),
        updatedAt: new Date().toISOString(),
      };
      this.save(next, state);
      await plan.finalize();
    } catch (error) {
      if (runtime)
        this.options.runtimeManager.quarantineRuntime(
          agentKind,
          worktreeId,
          runtime.runtime.generation,
          "runtime_unavailable",
        );
      throw Object.assign(
        new Error("Runtime Assignment verification failed.", { cause: error }),
        { code: "runtime_unavailable" },
      );
    } finally {
      runtime?.release();
      gate.release();
    }
  }
  private newAttempt(
    state: AssignmentAggregate,
    prior: string,
  ): NonNullable<AssignmentAggregate["attempt"]> {
    return {
      attemptId: randomUUID(),
      kind: "assignment_apply",
      targetRevision: state.revision,
      targetGenerationId: state.desiredGeneration.id,
      priorVerifiedGenerationId: prior,
      status: "waiting_for_idle",
      sideEffectBoundary: "none",
      createdAt: new Date().toISOString(),
    };
  }
}
