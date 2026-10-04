import {
  assignmentAggregateSchema,
  type AssignmentAggregate,
  type AssignmentAttempt,
  type AssignmentPhase,
  type ResourceAssignmentGeneration,
} from "./schemas";

type ReplaceDesiredCommand = {
  expectedRevision: string;
  attemptId: string;
  targetGeneration: ResourceAssignmentGeneration;
  acceptedAt: string;
};

export type ReplaceDesiredResult =
  | { kind: "accepted"; state: AssignmentAggregate }
  | { kind: "unchanged"; state: AssignmentAggregate }
  | { kind: "conflict"; current: AssignmentAggregate }
  | { kind: "rejected"; reason: "recovery_required" | "worktree_removing" | "generation_identity_conflict"; current: AssignmentAggregate };

const increment = (value: string) => (BigInt(value) + 1n).toString();

const sameGeneration = (
  left: ResourceAssignmentGeneration,
  right: ResourceAssignmentGeneration,
) => left.id === right.id && JSON.stringify(left.resources) === JSON.stringify(right.resources);

export function replaceDesiredAssignment(state: AssignmentAggregate, command: ReplaceDesiredCommand): ReplaceDesiredResult {
  if (command.expectedRevision !== state.revision) return { kind: "conflict", current: state };
  const collidesWithDesired = command.targetGeneration.id === state.desiredGeneration.id
    && !sameGeneration(command.targetGeneration, state.desiredGeneration);
  const collidesWithVerified = command.targetGeneration.id === state.verifiedGeneration.id
    && !sameGeneration(command.targetGeneration, state.verifiedGeneration);
  if (collidesWithDesired || collidesWithVerified) {
    return { kind: "rejected", reason: "generation_identity_conflict", current: state };
  }
  if (sameGeneration(command.targetGeneration, state.desiredGeneration)) return { kind: "unchanged", state };
  if (state.phase === "recovery_required") return { kind: "rejected", reason: "recovery_required", current: state };
  if (state.phase === "removing") return { kind: "rejected", reason: "worktree_removing", current: state };

  const revision = increment(state.revision);
  const projectionSequence = increment(state.projectionSequence);
  const immutableAttemptInProgress = state.phase === "applying" || state.phase === "rolling_back";
  const returnsToVerified = command.targetGeneration.id === state.verifiedGeneration.id;
  const next = {
    ...state,
    revision,
    projectionSequence,
    desiredGeneration: command.targetGeneration,
    phase: immutableAttemptInProgress ? state.phase : returnsToVerified ? "stable" as const : "waiting_for_idle" as const,
    attempt: immutableAttemptInProgress
      ? state.attempt
      : returnsToVerified
        ? null
        : {
            attemptId: command.attemptId,
            kind: "assignment_apply" as const,
            targetRevision: revision,
            targetGenerationId: command.targetGeneration.id,
            priorVerifiedGenerationId: state.verifiedGeneration.id,
            status: "waiting_for_idle" as const,
            sideEffectBoundary: "none" as const,
            createdAt: command.acceptedAt,
          },
    failure: immutableAttemptInProgress ? state.failure : null,
    updatedAt: command.acceptedAt,
  };
  return { kind: "accepted", state: assignmentAggregateSchema.parse(next) };
}

const transitions: Readonly<Record<AssignmentPhase, ReadonlySet<AssignmentPhase>>> = {
  reconciling: new Set(["stable", "waiting_for_idle", "failed_rolled_back", "recovery_required", "removing"]),
  stable: new Set(["waiting_for_idle", "removing"]),
  waiting_for_idle: new Set(["waiting_for_idle", "stable", "applying", "failed_rolled_back", "removing"]),
  applying: new Set(["stable", "rolling_back", "failed_rolled_back", "removing"]),
  rolling_back: new Set(["failed_rolled_back", "recovery_required", "removing"]),
  failed_rolled_back: new Set(["waiting_for_idle", "stable", "removing"]),
  recovery_required: new Set(["stable", "failed_rolled_back", "removing"]),
  removing: new Set(),
};

type TransitionCommand = {
  to: AssignmentPhase;
  at: string;
  failure?: AssignmentAggregate["failure"];
  committedGeneration?: ResourceAssignmentGeneration;
  nextAttemptId?: string;
  sideEffectBoundary?: AssignmentAttempt["sideEffectBoundary"];
};

export function transitionAssignmentPhase(state: AssignmentAggregate, command: TransitionCommand): AssignmentAggregate {
  if (!transitions[state.phase].has(command.to)) throw new Error(`invalid_assignment_phase_transition:${state.phase}:${command.to}`);

  let attempt = state.attempt;
  if (attempt) {
    const status = command.to === "applying"
      ? "applying"
      : command.to === "rolling_back"
        ? "rolling_back"
        : command.to === "recovery_required"
          ? "recovery_required"
          : command.to === "stable"
            ? "verified"
            : command.to === "failed_rolled_back"
              ? "failed_rolled_back"
              : attempt.status;
    const sideEffectBoundary = command.sideEffectBoundary ?? attempt.sideEffectBoundary;
    if (command.to === "rolling_back" && sideEffectBoundary === "none") {
      throw new Error("rollback_requires_side_effect_boundary");
    }
    attempt = { ...attempt, status, sideEffectBoundary };
  }

  const commitsApplyingTarget = command.to === "stable" && state.phase === "applying";
  const commitsRecoveredTarget = command.to === "stable"
    && state.phase === "recovery_required"
    && command.committedGeneration !== undefined;
  let verifiedGeneration = state.verifiedGeneration;
  let phase = command.to;
  if (commitsRecoveredTarget) {
    const committedGeneration = command.committedGeneration;
    if (!committedGeneration || !sameGeneration(committedGeneration, state.desiredGeneration)) {
      throw new Error("invalid_recovered_assignment_generation");
    }
    verifiedGeneration = committedGeneration;
  }
  if (commitsApplyingTarget) {
    const committedGeneration = command.committedGeneration
      ?? (state.attempt?.targetGenerationId === state.desiredGeneration.id
        ? state.desiredGeneration
        : undefined);
    if (!committedGeneration || committedGeneration.id !== state.attempt?.targetGenerationId) {
      throw new Error("invalid_assignment_committed_generation");
    }
    verifiedGeneration = committedGeneration;
    if (state.desiredGeneration.id !== committedGeneration.id) {
      if (!command.nextAttemptId) throw new Error("missing_coalesced_assignment_attempt");
      phase = "waiting_for_idle";
      attempt = {
        attemptId: command.nextAttemptId,
        kind: "assignment_apply",
        targetRevision: state.revision,
        targetGenerationId: state.desiredGeneration.id,
        priorVerifiedGenerationId: committedGeneration.id,
        status: "waiting_for_idle",
        sideEffectBoundary: "none",
        createdAt: command.at,
      };
    }
  }

  const next = {
    ...state,
    phase,
    projectionSequence: increment(state.projectionSequence),
    verifiedGeneration,
    attempt: phase === "stable" ? null : attempt,
    failure: command.failure === undefined ? state.failure : command.failure,
    updatedAt: command.at,
  };
  return assignmentAggregateSchema.parse(next);
}
