import {
  assignmentProjectionSchema,
  type AssignmentAggregate,
  type AssignmentBlockerDto,
  type AssignmentProjectionDto,
} from "../../shared/assignments";

export function projectWorktreeAssignment(
  state: AssignmentAggregate,
  agentKind: "codex" | "opencode" = "codex",
  blockers: AssignmentBlockerDto[] = [],
): AssignmentProjectionDto {
  const open = ["stable", "failed_rolled_back"].includes(state.phase);
  const desired = state.desiredGeneration.resources,
    verified = state.verifiedGeneration.resources;
  const union = [
    ...desired,
    ...verified.filter(
      (r) => !desired.some((d) => d.kind === r.kind && d.id === r.id),
    ),
  ];
  return assignmentProjectionSchema.parse({
    worktreeId: state.worktreeId,
    revision: state.revision,
    projectionSequence: state.projectionSequence,
    phase: state.phase,
    currentAgentKind: agentKind,
    resources: union.map((r) => {
      const d = desired.some((x) => x.kind === r.kind && x.id === r.id),
        v = verified.some((x) => JSON.stringify(x) === JSON.stringify(r));
      const p = r.providerProjections.find((p) => p.agentKind === agentKind);
      if (!p) throw new Error("Resource provider qualification is missing.");
      return {
        kind: r.kind,
        id: r.id,
        name: r.id,
        version: r.version,
        description: "",
        desired: d,
        verified: v,
        operation: d === v ? null : d ? "adding" : "removing",
        status:
          state.phase === "recovery_required"
            ? "recovery_required"
            : !open
              ? "applying"
              : state.phase === "failed_rolled_back" && (!d || !v)
                ? "failed"
                : p.availability === "compatible"
                  ? "enabled"
                  : "unavailable",
        assignable: p.availability === "compatible",
        unavailableReason:
          p.availability === "compatible" ? null : "provider_incompatible",
        automaticUsageReporting:
          r.kind === "capability" ? "supported" : "unknown",
        skillIsolation: p.skillIsolation,
      };
    }),
    blockers,
    progress: [
      "waiting_for_idle",
      "applying",
      "rolling_back",
      "recovery_required",
    ].includes(state.phase)
      ? {
          step:
            state.phase === "applying"
              ? state.attempt?.sideEffectBoundary === "commit_pending"
                ? "verifying"
                : state.attempt?.sideEffectBoundary === "activated"
                  ? "activating"
                  : "staging"
              : state.phase === "recovery_required"
                ? "recovering"
                : state.phase,
          completed: 0,
          total: 0,
          waitingSince:
            state.phase === "waiting_for_idle"
              ? (state.attempt?.createdAt ?? state.updatedAt)
              : null,
        }
      : null,
    admission: {
      canCreateSession: open,
      canResumeSession: open,
      canSend: open,
      reason: open
        ? null
        : state.phase === "recovery_required"
          ? "recovery_required"
          : "assignment_busy",
      message: open ? null : "Resource changes are pending.",
    },
    allowedActions:
      state.phase === "waiting_for_idle" &&
      state.attempt?.kind !== "resource_update"
        ? ["cancel_pending"]
        : state.phase === "failed_rolled_back"
          ? ["retry", "revert_desired"]
          : state.phase === "recovery_required"
            ? ["retry_recovery", "recreate_affected_runtimes", "revert_desired"]
            : [],
    failure: state.failure,
    updatedAt: state.updatedAt,
  });
}
