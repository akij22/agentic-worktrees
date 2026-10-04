import { describe, expect, it } from "vitest";
import {
  reduceSessionResourceActivityEvent,
  sessionResourceActivityChangedEventSchema,
  sessionResourceActivitySnapshotSchema,
  type SessionResourceActivityItem,
} from "./index";

const item = (id: string, occurredAt: string): SessionResourceActivityItem => ({
  id,
  resourceKind: "skill",
  resourceId: `skill-${id}`,
  resourceVersion: "1.0.0",
  requestState: "requested",
  useState: "confirmed",
  lifecycle: "terminal",
  outcome: "success",
  mode: "explicit",
  coverage: "qualified",
  occurredAt,
});

const snapshot = sessionResourceActivitySnapshotSchema.parse({
  runId: "run-1",
  sequence: "10",
  items: [item("a", "2026-09-15T10:00:00.000Z")],
});

const upsert = (eventId: string, sequence: string, value = item("b", "2026-09-15T10:01:00.000Z")) =>
  sessionResourceActivityChangedEventSchema.parse({
    eventId,
    runId: "run-1",
    sequence,
    change: { type: "upsert", item: value },
  });

describe("session Resource activity projection ordering", () => {
  it("applies only the next sequence and keeps deterministic item order", () => {
    const result = reduceSessionResourceActivityEvent({ snapshot }, upsert("event-11", "11"));
    expect(result).toMatchObject({ disposition: "applied", refetch: false });
    expect(result.state?.snapshot.sequence).toBe("11");
    expect(result.state?.snapshot.items.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("updates an existing Requested item in place", () => {
    const updated = { ...item("a", "2026-09-15T10:00:00.000Z"), requestState: "requested" as const };
    const result = reduceSessionResourceActivityEvent({ snapshot }, upsert("event-11", "11", updated));
    expect(result.state?.snapshot.items).toHaveLength(1);
    expect(result.state?.snapshot.items[0]).toEqual(updated);
  });

  it("ignores lower sequence events", () => {
    const current = { snapshot };
    expect(reduceSessionResourceActivityEvent(current, upsert("event-9", "9"))).toEqual({
      disposition: "ignored",
      state: current,
      refetch: false,
    });
  });

  it("deduplicates an exact replay of the last applied delta", () => {
    const replay = upsert("event-11", "11");
    const applied = reduceSessionResourceActivityEvent({ snapshot }, replay);
    expect(reduceSessionResourceActivityEvent(applied.state, replay)).toEqual({
      disposition: "duplicate",
      state: applied.state,
      refetch: false,
    });
  });

  it("discards local activity and refetches on equal-sequence conflict", () => {
    const applied = reduceSessionResourceActivityEvent({ snapshot }, upsert("event-11", "11"));
    const conflict = upsert("different-event", "11", item("c", "2026-09-15T10:02:00.000Z"));
    expect(reduceSessionResourceActivityEvent(applied.state, conflict)).toEqual({
      disposition: "conflict",
      state: null,
      refetch: true,
    });
  });

  it("does not apply a sequence gap before refetch", () => {
    const current = { snapshot };
    expect(reduceSessionResourceActivityEvent(current, upsert("event-12", "12"))).toEqual({
      disposition: "gap",
      state: current,
      refetch: true,
    });
  });

  it("removes a detached activity at the next sequence", () => {
    const event = sessionResourceActivityChangedEventSchema.parse({
      eventId: "event-11",
      runId: "run-1",
      sequence: "11",
      change: { type: "remove", activityId: "a" },
    });
    const result = reduceSessionResourceActivityEvent({ snapshot }, event);
    expect(result.state?.snapshot.items).toEqual([]);
  });

  it("rejects an event for another run", () => {
    const wrongRun = sessionResourceActivityChangedEventSchema.parse({
      ...upsert("event-11", "11"),
      runId: "run-2",
    });
    expect(reduceSessionResourceActivityEvent({ snapshot }, wrongRun)).toEqual({
      disposition: "conflict",
      state: null,
      refetch: true,
    });
  });
});
