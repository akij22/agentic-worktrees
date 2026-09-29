import { describe, expect, it } from "vitest";
import {
  assignmentAggregateSchema,
  assignmentAttemptSchema,
  assignmentChangedEventSchema,
  assignmentProjectionSchema,
  assignmentSetDesiredRequestSchema,
  canonicalDecimalSchema,
  resourceAssignmentGenerationSchema,
  resourceIdentitySchema,
  replaceDesiredAssignment,
  transitionAssignmentPhase,
} from "./index";

const resource = (id: string) => resourceIdentitySchema.parse({
  kind: "capability",
  id,
  version: "1.0.0",
  contentDigest: `sha256:${"a".repeat(64)}`,
  securityDigest: `sha256:${"b".repeat(64)}`,
  configurationDigest: `sha256:${"c".repeat(64)}`,
  invocationPolicyDigest: `sha256:${"d".repeat(64)}`,
  providerProjections: [
    {
      agentKind: "codex",
      availability: "compatible",
      skillIsolation: "not_applicable",
      qualificationDigest: `sha256:${"e".repeat(64)}`,
      expectedStateDigest: `sha256:${"f".repeat(64)}`,
    },
    {
      agentKind: "opencode",
      availability: "compatible",
      skillIsolation: "not_applicable",
      qualificationDigest: `sha256:${"1".repeat(64)}`,
      expectedStateDigest: `sha256:${"2".repeat(64)}`,
    },
  ],
});

const generation = (id: string, resources = [resource("alpha")]) => resourceAssignmentGenerationSchema.parse({ id, resources });

const stable = assignmentAggregateSchema.parse({
  worktreeId: "worktree-1",
  revision: "9007199254740993",
  projectionSequence: "9007199254740995",
  desiredGeneration: generation("assignment:one"),
  verifiedGeneration: generation("assignment:one"),
  phase: "stable",
  attempt: null,
  participants: [],
  failure: null,
  updatedAt: "2026-09-15T10:00:00.000Z",
});

describe("Assignment schemas", () => {
  it("accepts canonical 64-bit decimal text without numeric coercion", () => {
    expect(canonicalDecimalSchema.parse("9007199254740993")).toBe("9007199254740993");
    for (const invalid of ["", "-1", "+1", "01", "1.0", 1]) expect(() => canonicalDecimalSchema.parse(invalid)).toThrow();
  });

  it("pins immutable security, configuration, invocation policy, and both provider projections", () => {
    const pinned = resourceIdentitySchema.parse({
      kind: "skill",
      id: "review",
      version: "1.0.0",
      contentDigest: `sha256:${"a".repeat(64)}`,
      securityDigest: `sha256:${"b".repeat(64)}`,
      configurationDigest: `sha256:${"c".repeat(64)}`,
      invocationPolicyDigest: `sha256:${"d".repeat(64)}`,
      providerProjections: [
        {
          agentKind: "codex",
          availability: "compatible",
          skillIsolation: "not_enforced",
          qualificationDigest: `sha256:${"e".repeat(64)}`,
          expectedStateDigest: `sha256:${"f".repeat(64)}`,
        },
        {
          agentKind: "opencode",
          availability: "compatible",
          skillIsolation: "enforced",
          qualificationDigest: `sha256:${"1".repeat(64)}`,
          expectedStateDigest: `sha256:${"2".repeat(64)}`,
        },
      ],
    });
    expect(pinned.providerProjections.map(({ agentKind }) => agentKind)).toEqual(["codex", "opencode"]);
    expect(() => resourceIdentitySchema.parse({
      ...pinned,
      providerProjections: pinned.providerProjections.slice(0, 1),
    })).toThrow();
  });

  it("rejects duplicate or non-canonical Resource generations", () => {
    expect(() => resourceAssignmentGenerationSchema.parse({ id: "assignment:duplicate", resources: [resource("alpha"), resource("alpha")] })).toThrow();
    expect(() => resourceAssignmentGenerationSchema.parse({ id: "assignment:unsorted", resources: [resource("zeta"), resource("alpha")] })).toThrow();
  });

  it("rejects renderer attempts to submit generation or digest state", () => {
    expect(() => assignmentSetDesiredRequestSchema.parse({
      worktreeId: "worktree-1",
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1.0.0", contentDigest: `sha256:${"a".repeat(64)}` }],
    })).toThrow();
  });

  it("uses the normative attempt kinds, statuses, and write-ahead boundary", () => {
    const attempt = assignmentAttemptSchema.parse({
      attemptId: "attempt-1",
      kind: "resource_update",
      targetRevision: "3",
      targetGenerationId: "assignment:two",
      priorVerifiedGenerationId: "assignment:one",
      status: "waiting_for_idle",
      sideEffectBoundary: "none",
      createdAt: "2026-09-15T10:00:00.000Z",
    });
    expect(attempt.sideEffectBoundary).toBe("none");
    expect(() => assignmentAttemptSchema.parse({
      ...attempt,
      kind: "resource_distribution",
      status: "queued",
      sideEffectsStarted: false,
    })).toThrow();
  });

  it("rejects contradictory stable and failed aggregate tuples", () => {
    expect(() => assignmentAggregateSchema.parse({
      ...stable,
      failure: { code: "assignment_apply_failed", message: "Failed." },
    })).toThrow();
    expect(() => assignmentAggregateSchema.parse({
      ...stable,
      phase: "failed_rolled_back",
      failure: null,
    })).toThrow();
  });

  it("rejects unsafe projection tuples", () => {
    expect(() => assignmentProjectionSchema.parse({
      worktreeId: "worktree-1", revision: "0", projectionSequence: "0", phase: "stable", currentAgentKind: "codex",
      resources: [], blockers: [], progress: null,
      admission: { canCreateSession: true, canResumeSession: true, canSend: true, reason: "recovery_required", message: null },
      allowedActions: [], failure: null, updatedAt: "2026-09-15T10:00:00.000Z",
    })).toThrow();
    expect(() => assignmentProjectionSchema.parse({
      worktreeId: "worktree-1", revision: "0", projectionSequence: "0", phase: "waiting_for_idle", currentAgentKind: "codex",
      resources: [], blockers: [], progress: null,
      admission: { canCreateSession: false, canResumeSession: false, canSend: false, reason: "assignment_busy", message: null },
      allowedActions: ["cancel_pending", "cancel_pending"], failure: null, updatedAt: "2026-09-15T10:00:00.000Z",
    })).toThrow();
  });

  it("requires changed-event lineage to equal its full projection", () => {
    const projection = assignmentProjectionSchema.parse({
      worktreeId: "worktree-1", revision: "2", projectionSequence: "7", phase: "stable", currentAgentKind: "opencode",
      resources: [], blockers: [], progress: null,
      admission: { canCreateSession: true, canResumeSession: true, canSend: true, reason: null, message: null },
      allowedActions: [], failure: null, updatedAt: "2026-09-15T10:00:00.000Z",
    });
    expect(() => assignmentChangedEventSchema.parse({ eventId: "event-1", worktreeId: "worktree-1", revision: "2", projectionSequence: "8", projection })).toThrow();
  });
});

describe("Assignment reducer", () => {
  it("accepts a changed complete set without losing 64-bit precision", () => {
    const result = replaceDesiredAssignment(stable, {
      expectedRevision: "9007199254740993",
      attemptId: "attempt-2",
      targetGeneration: generation("assignment:two", [resource("alpha"), resource("beta")]),
      acceptedAt: "2026-09-15T10:01:00.000Z",
    });
    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.state.revision).toBe("9007199254740994");
    expect(result.state.projectionSequence).toBe("9007199254740996");
    expect(result.state.phase).toBe("waiting_for_idle");
    expect(result.state.verifiedGeneration.id).toBe("assignment:one");
    expect(result.state.attempt?.attemptId).toBe("attempt-2");
  });

  it("returns the current state for a stale optimistic revision", () => {
    const result = replaceDesiredAssignment(stable, { expectedRevision: "4", attemptId: "attempt", targetGeneration: generation("assignment:two"), acceptedAt: "2026-09-15T10:01:00.000Z" });
    expect(result).toEqual({ kind: "conflict", current: stable });
  });

  it("treats an identical complete set as a no-op", () => {
    const result = replaceDesiredAssignment(stable, { expectedRevision: stable.revision, attemptId: "unused", targetGeneration: generation("assignment:one"), acceptedAt: "2026-09-15T10:01:00.000Z" });
    expect(result).toEqual({ kind: "unchanged", state: stable });
  });

  it("fails closed when a generation identity is reused for different contents", () => {
    const result = replaceDesiredAssignment(stable, {
      expectedRevision: stable.revision,
      attemptId: "unused",
      targetGeneration: generation("assignment:one", [resource("beta")]),
      acceptedAt: "2026-09-15T10:01:00.000Z",
    });
    expect(result).toEqual({
      kind: "rejected",
      reason: "generation_identity_conflict",
      current: stable,
    });
  });

  it("allows only normative phase transitions", () => {
    const waiting = replaceDesiredAssignment(stable, { expectedRevision: stable.revision, attemptId: "attempt", targetGeneration: generation("assignment:two"), acceptedAt: "2026-09-15T10:01:00.000Z" });
    if (waiting.kind !== "accepted") throw new Error("expected accepted state");
    expect(transitionAssignmentPhase(waiting.state, { to: "applying", at: "2026-09-15T10:02:00.000Z" }).phase).toBe("applying");
    expect(() => transitionAssignmentPhase(stable, { to: "applying", at: "2026-09-15T10:02:00.000Z" })).toThrow(/invalid_assignment_phase_transition/);
  });

  it("coalesces a mid-apply edit without mutating the in-flight attempt", () => {
    const waiting = replaceDesiredAssignment(stable, { expectedRevision: stable.revision, attemptId: "attempt-one", targetGeneration: generation("assignment:two"), acceptedAt: "2026-09-15T10:01:00.000Z" });
    if (waiting.kind !== "accepted") throw new Error("expected accepted state");
    const applying = transitionAssignmentPhase(waiting.state, { to: "applying", at: "2026-09-15T10:02:00.000Z" });
    const coalesced = replaceDesiredAssignment(applying, { expectedRevision: applying.revision, attemptId: "must-not-replace", targetGeneration: generation("assignment:three", [resource("alpha"), resource("gamma")]), acceptedAt: "2026-09-15T10:03:00.000Z" });
    expect(coalesced.kind).toBe("accepted");
    if (coalesced.kind !== "accepted") return;
    expect(coalesced.state.phase).toBe("applying");
    expect(coalesced.state.attempt?.attemptId).toBe("attempt-one");
    expect(coalesced.state.attempt?.targetGenerationId).toBe("assignment:two");
    expect(coalesced.state.desiredGeneration.id).toBe("assignment:three");
  });

  it("verifies only the immutable in-flight target before queuing a coalesced edit", () => {
    const target = generation("assignment:two", [resource("alpha"), resource("beta")]);
    const waiting = replaceDesiredAssignment(stable, {
      expectedRevision: stable.revision,
      attemptId: "attempt-one",
      targetGeneration: target,
      acceptedAt: "2026-09-15T10:01:00.000Z",
    });
    if (waiting.kind !== "accepted") throw new Error("expected accepted state");
    const applying = transitionAssignmentPhase(waiting.state, {
      to: "applying",
      at: "2026-09-15T10:02:00.000Z",
    });
    const coalesced = replaceDesiredAssignment(applying, {
      expectedRevision: applying.revision,
      attemptId: "attempt-two",
      targetGeneration: generation("assignment:three", [resource("alpha"), resource("gamma")]),
      acceptedAt: "2026-09-15T10:03:00.000Z",
    });
    if (coalesced.kind !== "accepted") throw new Error("expected coalesced state");

    const completed = transitionAssignmentPhase(coalesced.state, {
      to: "stable",
      at: "2026-09-15T10:04:00.000Z",
      committedGeneration: target,
      nextAttemptId: "attempt-two",
    });

    expect(completed.verifiedGeneration.id).toBe("assignment:two");
    expect(completed.desiredGeneration.id).toBe("assignment:three");
    expect(completed.phase).toBe("waiting_for_idle");
    expect(completed.attempt).toMatchObject({
      attemptId: "attempt-two",
      targetGenerationId: "assignment:three",
      priorVerifiedGenerationId: "assignment:two",
      status: "waiting_for_idle",
    });
  });

  it("preserves failed desired state after verified rollback", () => {
    const waiting = replaceDesiredAssignment(stable, { expectedRevision: stable.revision, attemptId: "attempt", targetGeneration: generation("assignment:two"), acceptedAt: "2026-09-15T10:01:00.000Z" });
    if (waiting.kind !== "accepted") throw new Error("expected accepted state");
    const applying = transitionAssignmentPhase(waiting.state, { to: "applying", at: "2026-09-15T10:02:00.000Z" });
    const rollback = transitionAssignmentPhase(applying, { to: "rolling_back", at: "2026-09-15T10:03:00.000Z", sideEffectBoundary: "staged", failure: { code: "assignment_apply_failed", message: "Resource changes failed." } });
    const failed = transitionAssignmentPhase(rollback, { to: "failed_rolled_back", at: "2026-09-15T10:04:00.000Z" });
    expect(failed.desiredGeneration.id).toBe("assignment:two");
    expect(failed.verifiedGeneration.id).toBe("assignment:one");
    expect(failed.failure?.code).toBe("assignment_apply_failed");
  });

  it("requires recovery to establish a known state before another apply", () => {
    const recovering = assignmentAggregateSchema.parse({ ...stable, phase: "recovery_required", failure: { code: "assignment_recovery_required", message: "Resource state could not be verified." } });
    expect(() => transitionAssignmentPhase(recovering, { to: "applying", at: "2026-09-15T10:05:00.000Z" })).toThrow(/invalid_assignment_phase_transition/);
    expect(transitionAssignmentPhase(recovering, { to: "stable", at: "2026-09-15T10:05:00.000Z", failure: null }).phase).toBe("stable");
  });

  it("commits the desired generation only after recovery proves it", () => {
    const desired = generation("assignment:two", [resource("alpha"), resource("beta")]);
    const recovering = assignmentAggregateSchema.parse({
      ...stable,
      desiredGeneration: desired,
      phase: "recovery_required",
      failure: { code: "assignment_recovery_required", message: "Resource state could not be verified." },
    });
    const recovered = transitionAssignmentPhase(recovering, {
      to: "stable",
      at: "2026-09-15T10:06:00.000Z",
      committedGeneration: desired,
      failure: null,
    });
    expect(recovered.phase).toBe("stable");
    expect(recovered.verifiedGeneration.id).toBe("assignment:two");
    expect(recovered.failure).toBeNull();
  });
});
