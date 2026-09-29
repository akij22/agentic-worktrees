import {
  sessionResourceActivityChangedEventSchema,
  sessionResourceActivitySnapshotSchema,
  type SessionResourceActivityChangedEvent,
  type SessionResourceActivityItem,
  type SessionResourceActivitySnapshot,
} from "./schemas";

export type SessionResourceActivityCursor = {
  snapshot: SessionResourceActivitySnapshot;
  lastEvent?: SessionResourceActivityChangedEvent;
};

export type SessionResourceActivityProjectionReduction = {
  disposition: "applied" | "duplicate" | "ignored" | "gap" | "conflict";
  state: SessionResourceActivityCursor | null;
  refetch: boolean;
};

const sameEvent = (
  left: SessionResourceActivityChangedEvent,
  right: SessionResourceActivityChangedEvent,
) => JSON.stringify(left) === JSON.stringify(right);

const sortItems = (items: SessionResourceActivityItem[]) => [...items].sort((left, right) =>
  left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));

export function reduceSessionResourceActivityEvent(
  current: SessionResourceActivityCursor | null | undefined,
  rawEvent: SessionResourceActivityChangedEvent,
): SessionResourceActivityProjectionReduction {
  const event = sessionResourceActivityChangedEventSchema.parse(rawEvent);
  if (!current || event.runId !== current.snapshot.runId) {
    return { disposition: "conflict", state: null, refetch: true };
  }

  const currentSequence = BigInt(current.snapshot.sequence);
  const nextSequence = BigInt(event.sequence);
  if (nextSequence < currentSequence) {
    return { disposition: "ignored", state: current, refetch: false };
  }
  if (nextSequence === currentSequence) {
    return current.lastEvent && sameEvent(current.lastEvent, event)
      ? { disposition: "duplicate", state: current, refetch: false }
      : { disposition: "conflict", state: null, refetch: true };
  }
  if (nextSequence !== currentSequence + 1n) {
    return { disposition: "gap", state: current, refetch: true };
  }

  const change = event.change;
  const items = change.type === "upsert"
    ? sortItems([
        ...current.snapshot.items.filter(({ id }) => id !== change.item.id),
        change.item,
      ])
    : current.snapshot.items.filter(({ id }) => id !== change.activityId);
  const snapshot = sessionResourceActivitySnapshotSchema.parse({
    runId: current.snapshot.runId,
    sequence: event.sequence,
    items,
  });
  return {
    disposition: "applied",
    state: { snapshot, lastEvent: event },
    refetch: false,
  };
}
