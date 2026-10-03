import { randomUUID } from "node:crypto";
import {
  resourceIdentitySchema,
  type AssignmentAggregate,
  type AssignmentProjectionDto,
  type AssignmentParticipantAttestation,
  type ResourceAssignmentGeneration,
  type AssignmentRevisionRequest,
  type AssignmentRecoverRequest,
} from "../../shared/assignments";
import type { OwnedWorktreeRuntime } from "../coding-agents/worktree-runtime-manager";
import type { AssignmentCoordinatorStore } from "./assignment-coordinator-store";
import type {
  AssignmentServiceOptions,
  PreparedAssignmentParticipant,
} from "./worktree-resource-assignment-service";
function requireAttempt(
  state: AssignmentAggregate,
): NonNullable<AssignmentAggregate["attempt"]> {
  if (!state.attempt) throw new Error("Distribution child attempt is missing.");
  return state.attempt;
}
const increment = (value: string) => (BigInt(value) + 1n).toString();

export interface AssignmentDistributionContext {
  readonly store: AssignmentCoordinatorStore;
  readonly options: AssignmentServiceOptions;
  readonly distributionControllers: Map<string, AbortController>;
  readonly frozen: Set<string>;
  readonly supersededDistributions: Set<string>;
  distributionIntentReady(operationId: string): void;
  state(worktreeId: string): AssignmentAggregate;
  projection(state: AssignmentAggregate): AssignmentProjectionDto;
  save(
    state: AssignmentAggregate,
    previous: AssignmentAggregate | null,
    terminal?: { id: string; status: string },
  ): void;
  queuePublication(): void;
  publishOutbox(): Promise<void>;
  waitForReconciliation(worktreeId: string): Promise<void>;
  applyTarget(worktreeId: string): Promise<void>;
  newAttempt(
    state: AssignmentAggregate,
    prior: string,
  ): NonNullable<AssignmentAggregate["attempt"]>;
  prepareParticipant(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
  ): Promise<PreparedAssignmentParticipant>;
  validatePlan(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
    plan: PreparedAssignmentParticipant,
  ): void;
  exact(
    actual: AssignmentParticipantAttestation,
    expected: AssignmentParticipantAttestation,
  ): void;
  assertParticipantLive(
    worktreeId: string,
    attestation: AssignmentParticipantAttestation,
  ): void;
  assertPlanLive(worktreeId: string, plan: PreparedAssignmentParticipant): void;
  advanceBoundary(
    worktreeId: string,
    boundary: "activated" | "commit_pending",
  ): void;
  revision(input: AssignmentRevisionRequest): AssignmentAggregate;
}

export async function distributeResourceAssignment(
  context: AssignmentDistributionContext,
  input: {
    kind: "skill" | "capability";
    id: string;
    targetVersion: string | null;
    operationId?: string;
  },
): Promise<void> {
  const operationId = input.operationId ?? randomUUID(),
    controller = new AbortController();
  const target =
    input.targetVersion === null
      ? null
      : resourceIdentitySchema.parse(
          await context.options.resources.resolve({
            kind: input.kind,
            id: input.id,
            version: input.targetVersion,
          }),
        );
  if (
    target &&
    (target.kind !== input.kind ||
      target.id !== input.id ||
      target.version !== input.targetVersion)
  )
    throw new Error("Distribution Resource identity mismatch.");
  context.store.beginDistribution(operationId, input.kind, input.id, target);
  context.distributionControllers.set(operationId, controller);
  context.distributionIntentReady(operationId);
  const gates = new Map<string, { release(): void }>(),
    pins: Array<{ release(): void }> = [];
  const plans: Array<{
      worktreeId: string;
      attemptId: string;
      plan: PreparedAssignmentParticipant;
    }> = [],
    touched: typeof plans = [];
  let committed = false;
  const cleanupFailedWorktrees = new Set<string>();
  let items: Array<{
    prior: AssignmentAggregate;
    next: AssignmentAggregate;
    target: ResourceAssignmentGeneration;
    projection: AssignmentProjectionDto;
  }> = [];
  try {
    const affected = () =>
      context.store
        .listWorktrees()
        .filter((id) =>
          [
            ...context.state(id).desiredGeneration.resources,
            ...context.state(id).verifiedGeneration.resources,
          ].some(
            (r) =>
              r.kind === input.kind &&
              r.id === input.id &&
              (target === null || JSON.stringify(r) !== JSON.stringify(target)),
          ),
        )
        .sort();
    for (;;) {
      for (const worktreeId of affected()) {
        if (gates.has(worktreeId)) continue;
        await context.waitForReconciliation(worktreeId);
        const waiting = context.state(worktreeId);
        if (waiting.phase === "stable") {
          const next: AssignmentAggregate = {
            ...waiting,
            phase: "waiting_for_idle",
            projectionSequence: increment(waiting.projectionSequence),
            updatedAt: new Date().toISOString(),
            attempt: {
              ...context.newAttempt(waiting, waiting.verifiedGeneration.id),
              kind: "resource_update",
            },
          };
          context.store.announceDistribution(
            operationId,
            waiting,
            next,
            context.projection(next),
          );
          context.queuePublication();
        }
        gates.set(
          worktreeId,
          await context.options.runtimeManager.acquireAdmission(
            worktreeId,
            "exclusive",
            { signal: controller.signal },
          ),
        );
        while (
          context.state(worktreeId).phase === "waiting_for_idle" &&
          context.state(worktreeId).attempt?.kind === "assignment_apply"
        )
          await context.applyTarget(worktreeId);
        restoreDistributionWait(context, worktreeId);
      }
      const refreshed = affected();
      if (refreshed.every((id) => gates.has(id))) {
        for (const [id, gate] of gates)
          if (!refreshed.includes(id)) {
            gate.release();
            gates.delete(id);
          }
        break;
      }
    }
    items = [...gates.keys()].sort().map((worktreeId) => {
      const prior = context.state(worktreeId);
      if (
        prior.phase !== "stable" ||
        prior.desiredGeneration.id !== prior.verifiedGeneration.id
      )
        throw new Error("Resource update requires a stable Assignment.");
      const resources = prior.verifiedGeneration.resources.filter(
        (r) => r.kind !== input.kind || r.id !== input.id,
      );
      if (target) resources.push(target);
      resources.sort((a, b) =>
        `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
      );
      const generation = context.store.generation(worktreeId, resources);
      const next: AssignmentAggregate = {
        ...prior,
        phase: "waiting_for_idle",
        projectionSequence: increment(prior.projectionSequence),
        updatedAt: new Date().toISOString(),
        attempt: {
          ...context.newAttempt(prior, prior.verifiedGeneration.id),
          kind: "resource_update",
          targetGenerationId: generation.id,
        },
      };
      return {
        prior,
        next,
        target: generation,
        projection: context.projection(next),
      };
    });
    for (const item of items) context.frozen.add(item.prior.worktreeId);
    context.store.freezeDistribution(operationId, items);
    for (const item of items) {
      await context.options.resources.prepare(item.target);
      const before = context.options.runtimeManager.inspectWorktree(
        item.prior.worktreeId,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      const after = context.options.runtimeManager.inspectWorktree(
        item.prior.worktreeId,
      );
      if (before.busy || after.busy || before.fingerprint !== after.fingerprint)
        throw new Error("Distribution participant changed.");
      for (const runtime of after.runtimes) {
        if (
          item.target.resources.some(
            (r) =>
              r.providerProjections.find(
                (p) => p.agentKind === runtime.agentKind,
              )?.availability !== "compatible",
          )
        )
          continue;
        pins.push(
          await context.options.runtimeManager.acquireControlRuntime(
            runtime.agentKind,
            runtime.worktreeId,
            runtime.generation,
          ),
        );
        const plan = await context.prepareParticipant(
          runtime,
          item.target,
          item.prior.verifiedGeneration,
        );
        context.validatePlan(
          runtime,
          item.target,
          item.prior.verifiedGeneration,
          plan,
        );
        plans.push({
          worktreeId: runtime.worktreeId,
          attemptId: requireAttempt(item.next).attemptId,
          plan,
        });
      }
      const worktreePlans = plans.filter(
        (p) => p.worktreeId === item.prior.worktreeId,
      );
      context.store.planParticipants(
        requireAttempt(item.next).attemptId,
        worktreePlans.map((p) => p.plan.expected),
        worktreePlans.map((p) => p.plan.priorExpected),
        worktreePlans.flatMap((p) => [
          {
            id: p.plan.expected.catalogGenerationId,
            digest: p.plan.projectionDigest,
          },
          {
            id: p.plan.priorExpected.catalogGenerationId,
            digest: p.plan.priorProjectionDigest,
          },
        ]),
      );
    }
    if (controller.signal.aborted)
      throw new Error("Distribution cancelled before effects.");
    context.store.distributionBoundary(operationId, "staged");
    for (const item of items) {
      const current = context.state(item.prior.worktreeId);
      context.save(
        {
          ...current,
          phase: "applying",
          projectionSequence: increment(current.projectionSequence),
          updatedAt: new Date().toISOString(),
          attempt: {
            ...requireAttempt(current),
            status: "applying",
            sideEffectBoundary: "staged",
          },
        },
        current,
      );
    }
    for (const item of items)
      context.store.distributionWorktreeProgress(
        operationId,
        item.prior.worktreeId,
        "staged",
      );
    for (const participant of plans) {
      touched.push(participant);
      context.store.participantProgress(
        participant.attemptId,
        participant.plan.expected,
        "staged",
      );
      await participant.plan.stage();
    }
    for (const item of items)
      context.advanceBoundary(item.prior.worktreeId, "activated");
    for (const item of items)
      context.store.distributionWorktreeProgress(
        operationId,
        item.prior.worktreeId,
        "activated",
      );
    context.store.distributionBoundary(operationId, "activated");
    for (const participant of plans) {
      context.store.participantProgress(
        participant.attemptId,
        participant.plan.expected,
        "activated",
      );
      await participant.plan.activate();
      context.exact(await participant.plan.verify(), participant.plan.expected);
      context.assertParticipantLive(
        participant.worktreeId,
        participant.plan.expected,
      );
      context.store.participantProgress(
        participant.attemptId,
        participant.plan.expected,
        "verified",
      );
    }
    for (const p of plans) context.assertPlanLive(p.worktreeId, p.plan);
    for (const item of items)
      context.advanceBoundary(item.prior.worktreeId, "commit_pending");
    for (const item of items)
      context.store.distributionWorktreeProgress(
        operationId,
        item.prior.worktreeId,
        "commit_ready",
      );
    context.store.distributionBoundary(
      operationId,
      "commit_pending",
      "commit_pending",
    );
    const changes = items.map((item) => {
      const prior = context.state(item.prior.worktreeId);
      const next: AssignmentAggregate = {
        ...prior,
        desiredGeneration: item.target,
        verifiedGeneration: item.target,
        phase: "stable",
        revision: increment(prior.revision),
        projectionSequence: increment(prior.projectionSequence),
        updatedAt: new Date().toISOString(),
        attempt: null,
        participants: plans
          .filter((p) => p.worktreeId === prior.worktreeId)
          .map((p) => p.plan.expected),
      };
      return {
        prior,
        next,
        projection: context.projection(next),
        attemptId: requireAttempt(item.next).attemptId,
        attemptStatus: "verified",
      };
    });
    context.store.finishDistribution(operationId, "verified", changes);
    committed = true;
    for (const participant of plans) {
      try {
        await participant.plan.finalize();
      } catch {
        cleanupFailedWorktrees.add(participant.worktreeId);
      }
    }
    if (cleanupFailedWorktrees.size)
      throw new Error("Resource update runtime finalization failed.");
  } catch (error) {
    if (committed) {
      for (const item of items.filter((item) =>
        cleanupFailedWorktrees.has(item.prior.worktreeId),
      )) {
        const state = context.state(item.prior.worktreeId);
        const recovery: AssignmentAggregate = {
          ...state,
          phase: "recovery_required",
          attempt: null,
          participants: [],
          failure: {
            code: "assignment_recovery_required",
            message:
              "Committed Resource update requires owned-runtime cleanup recovery.",
          },
          projectionSequence: increment(state.projectionSequence),
          updatedAt: new Date().toISOString(),
        };
        context.save(recovery, state);
      }
      throw Object.assign(
        new Error(
          "Resource update committed but runtime cleanup requires recovery.",
        ),
        { code: "assignment_recovery_required" },
      );
    }
    const divergent = new Set<string>();
    for (const worktreeId of context.store.distributionWorktrees(operationId))
      restoreDistributionWait(context, worktreeId);
    context.store.distributionBoundary(
      operationId,
      touched.length ? "activated" : "none",
      "rolling_back",
    );
    for (const participant of [...touched].reverse()) {
      try {
        context.store.participantProgress(
          participant.attemptId,
          participant.plan.expected,
          "rollback_started",
        );
        context.exact(
          await participant.plan.rollback(),
          participant.plan.priorExpected,
        );
        context.assertParticipantLive(
          participant.worktreeId,
          participant.plan.priorExpected,
        );
        context.store.participantProgress(
          participant.attemptId,
          participant.plan.expected,
          "rolled_back",
        );
      } catch {
        divergent.add(participant.worktreeId);
      }
    }
    for (const p of plans) {
      try {
        await p.plan.discard();
      } catch {
        divergent.add(p.worktreeId);
      }
    }
    const changes = items
      .filter(
        (item) =>
          context.state(item.prior.worktreeId).attempt?.attemptId ===
          item.next.attempt?.attemptId,
      )
      .map((item) => {
        const prior = context.state(item.prior.worktreeId),
          unknown = divergent.has(prior.worktreeId);
        const next: AssignmentAggregate = {
          ...item.prior,
          phase: unknown ? "recovery_required" : "stable",
          projectionSequence: increment(prior.projectionSequence),
          updatedAt: new Date().toISOString(),
          attempt: unknown
            ? { ...requireAttempt(prior), status: "recovery_required" }
            : null,
          participants: unknown
            ? []
            : plans
                .filter((p) => p.worktreeId === prior.worktreeId)
                .map((p) => p.plan.priorExpected),
          failure: unknown
            ? {
                code: "assignment_recovery_required",
                message: "The Resource update could not restore this Worktree.",
              }
            : null,
        };
        return {
          prior,
          next,
          projection: context.projection(next),
          attemptId: requireAttempt(item.next).attemptId,
          attemptStatus: unknown ? "recovery_required" : "failed_rolled_back",
        };
      });
    context.store.finishDistribution(
      operationId,
      divergent.size
        ? "recovery_required"
        : controller.signal.aborted
          ? "cancelled"
          : "failed",
      changes,
    );
    throw Object.assign(
      new Error(
        controller.signal.aborted
          ? "Resource distribution was cancelled."
          : "Resource distribution failed.",
        { cause: error },
      ),
      {
        code: controller.signal.aborted
          ? "operation_cancelled"
          : "assignment_apply_failed",
      },
    );
  } finally {
    context.distributionControllers.delete(operationId);
    for (const pin of pins.reverse()) pin.release();
    for (const [id, gate] of [...gates].reverse()) {
      context.frozen.delete(id);
      gate.release();
    }
  }
  await context.publishOutbox();
}

function restoreDistributionWait(
  context: AssignmentDistributionContext,
  worktreeId: string,
): void {
  const state = context.state(worktreeId);
  if (
    state.phase === "waiting_for_idle" &&
    state.attempt?.kind === "resource_update" &&
    state.attempt.sideEffectBoundary === "none" &&
    state.attempt.targetGenerationId === state.verifiedGeneration.id &&
    state.desiredGeneration.id === state.verifiedGeneration.id
  ) {
    const next: AssignmentAggregate = {
      ...state,
      phase: "stable",
      attempt: null,
      projectionSequence: increment(state.projectionSequence),
      updatedAt: new Date().toISOString(),
    };
    context.save(next, state, {
      id: state.attempt.attemptId,
      status: "superseded",
    });
  }
}

export async function recoverResourceDistribution(
  context: AssignmentDistributionContext,
  operationId: string,
  input: AssignmentRecoverRequest,
): Promise<void> {
  const ids = context.store.distributionWorktrees(operationId).sort(),
    gates: Array<{ release(): void }> = [];
  try {
    for (const id of ids) {
      gates.push(
        await context.options.runtimeManager.acquireAdmission(id, "exclusive"),
      );
      context.frozen.add(id);
    }
    context.revision(input);
    const changes = [];
    for (const id of ids) {
      const prior = context.state(id);
      await context.options.resources.prepare(prior.verifiedGeneration);
      await context.options.runtimeManager.recoverAssignmentReplacements(id);
      const snapshot = context.options.runtimeManager.inspectWorktree(id);
      if (snapshot.busy)
        throw new Error("Resource recovery participants are not idle.");
      const participants: AssignmentParticipantAttestation[] = [];
      for (const runtime of snapshot.runtimes) {
        let proved = false;
        if (input.action === "retry_recovery") {
          try {
            const plan = await context.prepareParticipant(
              runtime,
              prior.verifiedGeneration,
              prior.verifiedGeneration,
            );
            context.validatePlan(
              runtime,
              prior.verifiedGeneration,
              prior.verifiedGeneration,
              plan,
            );
            context.exact(await plan.verify(), plan.expected);
            context.store.prepareCatalog(
              id,
              plan.expected,
              plan.projectionDigest,
            );
            participants.push(plan.expected);
            proved = true;
          } catch {
            proved = false;
          }
        }
        if (!proved)
          await context.options.runtimeManager.retireAssignmentRuntime(
            runtime.agentKind,
            id,
            runtime.generation,
          );
      }
      if (!prior.attempt) continue;
      const next: AssignmentAggregate = {
        ...prior,
        phase: "stable",
        attempt: null,
        participants,
        failure: null,
        projectionSequence: increment(prior.projectionSequence),
        updatedAt: new Date().toISOString(),
      };
      changes.push({
        prior,
        next,
        projection: context.projection(next),
        attemptId: prior.attempt.attemptId,
        attemptStatus: "failed_rolled_back",
      });
    }
    context.store.finishDistribution(operationId, "failed", changes);
  } catch (error) {
    throw Object.assign(
      new Error("The Resource update still requires recovery.", {
        cause: error,
      }),
      { code: "assignment_recovery_required" },
    );
  } finally {
    for (const id of ids) context.frozen.delete(id);
    for (const gate of gates.reverse()) gate.release();
  }
}

export async function reconcileResourceDistributions(
  context: AssignmentDistributionContext,
): Promise<void> {
  for (const parent of context.store.activeDistributions()) {
    const ids = context.store.distributionWorktrees(parent.id),
      gates: Array<{ release(): void }> = [];
    try {
      for (const id of ids)
        gates.push(
          await context.options.runtimeManager.acquireAdmission(
            id,
            "exclusive",
          ),
        );
      const preEffect = ["none", "gates_acquired"].includes(parent.boundary);
      const changes = ids
        .map((id) => {
          const prior = context.state(id);
          if (prior.attempt?.kind !== "resource_update") return null;
          const next: AssignmentAggregate = {
            ...prior,
            phase: preEffect ? "stable" : "recovery_required",
            attempt: preEffect
              ? null
              : { ...prior.attempt, status: "recovery_required" },
            participants: preEffect ? prior.participants : [],
            failure: preEffect
              ? null
              : {
                  code: "assignment_recovery_required",
                  message: "An interrupted Resource update requires recovery.",
                },
            projectionSequence: increment(prior.projectionSequence),
            updatedAt: new Date().toISOString(),
          };
          return {
            prior,
            next,
            projection: context.projection(next),
            attemptId: prior.attempt.attemptId,
            attemptStatus: preEffect ? "cancelled" : "recovery_required",
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      context.store.finishDistribution(
        parent.id,
        preEffect ? "cancelled" : "recovery_required",
        changes,
      );
    } finally {
      for (const gate of gates.reverse()) gate.release();
    }
  }
}
