import { describe, expect, it } from "vitest";
import {
  assignmentChangedEventSchema,
  assignmentProjectionSchema,
  reduceAssignmentProjectionEvent,
  type AssignmentChangedEventDto,
} from "./index";

const projection = (revision: string, projectionSequence: string) => assignmentProjectionSchema.parse({
  worktreeId: "worktree-1",
  revision,
  projectionSequence,
  phase: "stable",
  currentAgentKind: "codex",
  resources: [],
  blockers: [],
  progress: null,
  admission: {
    canCreateSession: true,
    canResumeSession: true,
    canSend: true,
    reason: null,
    message: null,
  },
  allowedActions: [],
  failure: null,
  updatedAt: "2026-09-15T10:00:00.000Z",
});

const event = (
  eventId: string,
  revision: string,
  projectionSequence: string,
  overrides: Partial<AssignmentChangedEventDto["projection"]> = {},
) => {
  const value = projection(revision, projectionSequence);
  return assignmentChangedEventSchema.parse({
    eventId,
    worktreeId: value.worktreeId,
    revision,
    projectionSequence,
    projection: { ...value, ...overrides },
  });
};

describe("Assignment projection ordering", () => {
  it("applies the first full projection", () => {
    const result = reduceAssignmentProjectionEvent(null, event("event-1", "1", "10"));
    expect(result).toMatchObject({ disposition: "applied", refetch: false });
    expect(result.state?.projection.projectionSequence).toBe("10");
  });

  it("ignores an older projection without regressing local state", () => {
    const current = reduceAssignmentProjectionEvent(null, event("event-2", "2", "11")).state;
    const result = reduceAssignmentProjectionEvent(current, event("event-1", "1", "10"));
    expect(result).toEqual({ disposition: "ignored", state: current, refetch: false });
  });

  it("deduplicates an exact equal-sequence replay", () => {
    const replay = event("event-1", "1", "10");
    const current = reduceAssignmentProjectionEvent(null, replay).state;
    const result = reduceAssignmentProjectionEvent(current, replay);
    expect(result).toEqual({ disposition: "duplicate", state: current, refetch: false });
  });

  it("requires refetch for conflicting equal-sequence content", () => {
    const current = reduceAssignmentProjectionEvent(null, event("event-1", "1", "10")).state;
    const result = reduceAssignmentProjectionEvent(
      current,
      event("event-2", "1", "10", { updatedAt: "2026-09-15T10:01:00.000Z" }),
    );
    expect(result).toEqual({ disposition: "conflict", state: current, refetch: true });
  });

  it("applies a sequence gap and requests a defensive refetch", () => {
    const current = reduceAssignmentProjectionEvent(null, event("event-1", "1", "10")).state;
    const result = reduceAssignmentProjectionEvent(current, event("event-3", "2", "12"));
    expect(result).toMatchObject({ disposition: "applied", refetch: true });
    expect(result.state?.projection.projectionSequence).toBe("12");
  });

  it("rejects a higher sequence that regresses the Assignment revision", () => {
    const current = reduceAssignmentProjectionEvent(null, event("event-1", "2", "10")).state;
    const result = reduceAssignmentProjectionEvent(current, event("event-2", "1", "11"));
    expect(result).toEqual({ disposition: "conflict", state: current, refetch: true });
  });

  it("rejects a higher revision with a non-increasing projection sequence", () => {
    const current = reduceAssignmentProjectionEvent(null, event("event-1", "1", "10")).state;
    const invalid = event("event-2", "2", "10");
    const result = reduceAssignmentProjectionEvent(current, invalid);
    expect(result).toEqual({ disposition: "conflict", state: current, refetch: true });
  });
});
