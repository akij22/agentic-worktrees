import {
  assignmentChangedEventSchema,
  type AssignmentChangedEventDto,
  type AssignmentProjectionDto,
} from "./schemas";

export type AssignmentProjectionCursor = {
  eventId: string;
  projection: AssignmentProjectionDto;
};

export type AssignmentProjectionReduction = {
  disposition: "applied" | "duplicate" | "ignored" | "conflict";
  state: AssignmentProjectionCursor | null;
  refetch: boolean;
};

const sameProjection = (
  left: AssignmentProjectionDto,
  right: AssignmentProjectionDto,
) => JSON.stringify(left) === JSON.stringify(right);

export function reduceAssignmentProjectionEvent(
  current: AssignmentProjectionCursor | null | undefined,
  rawEvent: AssignmentChangedEventDto,
): AssignmentProjectionReduction {
  const event = assignmentChangedEventSchema.parse(rawEvent);
  if (!current) {
    return {
      disposition: "applied",
      state: { eventId: event.eventId, projection: event.projection },
      refetch: false,
    };
  }

  if (event.worktreeId !== current.projection.worktreeId) {
    return { disposition: "ignored", state: current, refetch: false };
  }

  const currentSequence = BigInt(current.projection.projectionSequence);
  const nextSequence = BigInt(event.projectionSequence);
  const currentRevision = BigInt(current.projection.revision);
  const nextRevision = BigInt(event.revision);

  if (nextRevision > currentRevision && nextSequence <= currentSequence) {
    return { disposition: "conflict", state: current, refetch: true };
  }

  if (nextSequence < currentSequence) {
    return { disposition: "ignored", state: current, refetch: false };
  }
  if (nextRevision < currentRevision) {
    return { disposition: "conflict", state: current, refetch: true };
  }

  if (nextSequence === currentSequence) {
    const exactReplay = event.eventId === current.eventId
      && event.revision === current.projection.revision
      && sameProjection(event.projection, current.projection);
    return exactReplay
      ? { disposition: "duplicate", state: current, refetch: false }
      : { disposition: "conflict", state: current, refetch: true };
  }

  const hasGap = nextSequence > currentSequence + 1n;
  return {
    disposition: "applied",
    state: { eventId: event.eventId, projection: event.projection },
    refetch: hasGap,
  };
}
