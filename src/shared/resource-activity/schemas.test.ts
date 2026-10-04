import { describe, expect, it } from "vitest";
import {
  emptyResourceActivityLedger,
  reduceResourceActivity,
  resourceActivityObservationSchema,
  resourceActivitySchema,
  sessionResourceActivityChangedEventSchema,
  sessionResourceActivityItemSchema,
  sessionResourceActivitySnapshotSchema,
  type ResourceActivityObservation,
} from "./index";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const key = (letter: string) => `hmac:v1:${letter.repeat(64)}`;
const at = (minute: number) => new Date(`2026-09-15T10:${String(minute).padStart(2, "0")}:00.000Z`);
const identity = { resourceKind: "capability" as const, resourceId: "prototype.capability", resourceVersion: "1.0.0", resourceDigest: digest("a") };
const lineage = { worktreeId: "worktree-1", assignmentRevision: "9007199254740993", assignmentGenerationId: "assignment:one", catalogGenerationId: "catalog:one", runtimeGenerationId: "runtime:one", provider: "codex" as const, providerVersion: "0.154.0", adapterContractVersion: 1 };
const context = { qualifiedLineage: [lineage] };

type ObservationWithoutContext<T> = T extends ResourceActivityObservation
  ? Omit<T, "identity" | "lineage">
  : never;
type ObservationInput = ObservationWithoutContext<ResourceActivityObservation>;
type ObservationOfType<T extends ObservationInput["type"]> = Extract<
  ResourceActivityObservation,
  { type: T }
>;

const observation = <T extends ObservationInput>(value: T): ObservationOfType<T["type"]> =>
  ({ ...value, identity, lineage }) as unknown as ObservationOfType<T["type"]>;

describe("Resource activity schemas", () => {
  it("rejects impossible Capability Used tuples", () => {
    expect(() => resourceActivitySchema.parse({
      id: "activity-1", ...lineage, ...identity, runId: "run-1", requestKey: key("a"), correlationKey: key("b"), requestState: "requested", useState: "not_confirmed",
      lifecycle: "terminal", outcome: "success", attribution: "exact", mode: "explicit", routingIntegrity: "verified", coverage: "qualified",
      requestedAt: at(0), enteredOrLoadedAt: null, finishedAt: at(1), firstObservedAt: at(0), lastObservedAt: at(1),
    })).toThrow();
  });

  it("accepts only the complete legacy request exception", () => {
    const legacy = {
      id: "legacy-1", worktreeId: "worktree-1", runId: "run-1", resourceKind: "skill" as const, resourceId: "review", resourceVersion: "1.0.0",
      resourceDigest: null, assignmentRevision: null, assignmentGenerationId: null, catalogGenerationId: null, runtimeGenerationId: null,
      provider: null, providerVersion: null, adapterContractVersion: null, requestKey: key("c"), correlationKey: null,
      requestState: "requested" as const, useState: "not_confirmed" as const, lifecycle: "terminal" as const, outcome: "not_observed" as const,
      attribution: "exact" as const, mode: "explicit" as const, routingIntegrity: "unknown" as const, coverage: "legacy_unverified" as const,
      requestedAt: at(0), enteredOrLoadedAt: null, finishedAt: at(1), firstObservedAt: at(0), lastObservedAt: at(1),
    };
    expect(resourceActivitySchema.parse(legacy)).toEqual(legacy);
    expect(() => resourceActivitySchema.parse({ ...legacy, useState: "confirmed", enteredOrLoadedAt: at(0) })).toThrow();
  });

  it("rejects evidence whose boundary contradicts its Resource kind or mode", () => {
    const base = {
      activityId: "activity-1",
      evidenceId: "evidence-1",
      sourceEventKey: key("a"),
      correlationKey: key("b"),
      providerContract: "host/v1",
      observedAt: at(0),
      lineage,
    };
    expect(() => resourceActivityObservationSchema.parse({
      ...base,
      type: "capability_host_entered",
      identity: { ...identity, resourceKind: "skill" },
    })).toThrow();
    expect(() => resourceActivityObservationSchema.parse({
      ...base,
      type: "provider_request",
      requestKey: key("c"),
      runId: "run-1",
      mode: "automatic",
      identity,
    })).toThrow();
  });

  it("keeps renderer DTOs free of provenance and raw evidence", () => {
    expect(() => sessionResourceActivityItemSchema.parse({
      id: "activity-1", resourceKind: "capability", resourceId: "prototype.capability", resourceVersion: "1.0.0",
      requestState: "requested", useState: "confirmed", lifecycle: "terminal", outcome: "success", mode: "explicit", coverage: "qualified",
      occurredAt: "2026-09-15T10:00:00.000Z", correlationKey: key("a"), providerSessionId: "private-session", prompt: "private",
    })).toThrow();
  });

  it("requires canonical stream sequence and event lineage", () => {
    const item = sessionResourceActivityItemSchema.parse({
      id: "activity-1", resourceKind: "skill", resourceId: "review", resourceVersion: "1.0.0", requestState: "requested", useState: "confirmed",
      lifecycle: "terminal", outcome: "success", mode: "automatic", coverage: "qualified", occurredAt: "2026-09-15T10:00:00.000Z",
    });
    expect(sessionResourceActivitySnapshotSchema.parse({ runId: "run-1", sequence: "9007199254740993", items: [item] }).sequence).toBe("9007199254740993");
    expect(() => sessionResourceActivitySnapshotSchema.parse({ runId: "run-1", sequence: "1", items: [item, item] })).toThrow();
    expect(() => sessionResourceActivityChangedEventSchema.parse({ eventId: "event-1", runId: "run-1", sequence: "01", change: { type: "upsert", item } })).toThrow();
  });
});

describe("Resource activity evidence reducer", () => {
  it("records an application-owned explicit request without manufacturing use", () => {
    const result = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "application_request", activityId: "activity-request", evidenceId: "evidence-request", sourceEventKey: key("a"), requestKey: key("b"), runId: "run-a", mode: "explicit", providerContract: "app/v1", observedAt: at(0),
    }), context);
    expect(result.ledger.activities[0]).toMatchObject({
      requestState: "requested",
      useState: "not_confirmed",
      attribution: "exact",
      runId: "run-a",
    });
    expect(result.ledger.evidence[0]?.boundary).toBe("application.request");
  });

  it("keeps validated host entry Used but session Unknown until exact provider pairing", () => {
    const result = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "codex/0.154.0/v1", observedAt: at(1),
    }), context);
    expect(result.disposition).toBe("applied");
    expect(result.ledger.activities[0]).toMatchObject({ useState: "confirmed", attribution: "unknown", runId: null, coverage: "pending" });
  });

  it("merges an exact request into its host activity only through both qualified keys", () => {
    let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "provider_request", activityId: "activity-request", evidenceId: "evidence-request", sourceEventKey: key("c"), requestKey: key("d"), runId: "run-a", mode: "explicit", providerContract: "codex/0.154.0/v1", observedAt: at(0),
    }), context).ledger;
    ledger = reduceResourceActivity(ledger, observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("e"), correlationKey: key("f"), providerContract: "host/v1", observedAt: at(1),
    }), context).ledger;
    const paired = reduceResourceActivity(ledger, observation({
      type: "provider_capability_receipt", evidenceId: "evidence-receipt", sourceEventKey: key("0"), requestKey: key("d"), correlationKey: key("f"), runId: "run-a", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    }), context);
    expect(paired.ledger.activities).toHaveLength(1);
    expect(paired.ledger.activities[0]).toMatchObject({ id: "activity-host", requestState: "requested", useState: "confirmed", attribution: "exact", runId: "run-a", coverage: "qualified" });
    expect(paired.ledger.evidence.every((event) => event.activityId === "activity-host")).toBe(true);
  });

  it("does not manufacture Used from a provider receipt without host entry", () => {
    const result = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "provider_capability_receipt", evidenceId: "evidence-receipt", sourceEventKey: key("a"), requestKey: key("b"), correlationKey: key("c"), runId: "run-a", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    }), context);
    expect(result.disposition).toBe("unmatched");
    expect(result.ledger.activities).toEqual([]);
  });

  it("preserves Used across reported error, throw, timeout, and cancellation", () => {
    for (const outcome of ["reported_error", "thrown", "timeout", "cancelled"] as const) {
      let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
        type: "capability_host_entered", activityId: `activity-${outcome}`, evidenceId: `entered-${outcome}`, sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1),
      }), context).ledger;
      ledger = reduceResourceActivity(ledger, observation({
        type: "capability_host_outcome", evidenceId: `outcome-${outcome}`, sourceEventKey: key("c"), correlationKey: key("b"), outcome, providerContract: "host/v1", observedAt: at(2),
      }), context).ledger;
      expect(ledger.activities[0]).toMatchObject({ useState: "confirmed", lifecycle: "terminal", outcome });
    }
  });

  it("deduplicates replay but quarantines changed duplicate evidence", () => {
    const entered = observation({ type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1) });
    const first = reduceResourceActivity(emptyResourceActivityLedger(), entered, context);
    expect(reduceResourceActivity(first.ledger, entered, context).disposition).toBe("duplicate");
    const changed = observation({ ...entered, correlationKey: key("c") });
    const conflict = reduceResourceActivity(first.ledger, changed, context);
    expect(conflict.disposition).toBe("conflict");
    expect(conflict.quarantine).toBe(true);
  });

  it("rejects stale runtime lineage without creating activity", () => {
    const stale = observation({ type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1) });
    const result = reduceResourceActivity(emptyResourceActivityLedger(), { ...stale, lineage: { ...lineage, runtimeGenerationId: "runtime:stale" } }, context);
    expect(result.disposition).toBe("stale_rejected");
    expect(result.ledger.activities).toEqual([]);
  });

  it("keeps exact session B attribution and quarantines a lease mismatch", () => {
    const ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1),
    }), context).ledger;
    const result = reduceResourceActivity(ledger, observation({
      type: "provider_capability_receipt", evidenceId: "evidence-receipt", sourceEventKey: key("c"), requestKey: null, correlationKey: key("b"), runId: "run-b", mode: "explicit", routingIntegrity: "lease_mismatch", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    }), context);
    expect(result.ledger.activities[0]).toMatchObject({ runId: "run-b", attribution: "exact", routingIntegrity: "lease_mismatch" });
    expect(result.quarantine).toBe(true);
  });

  it("detaches a receipt claimed by two sessions", () => {
    let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1),
    }), context).ledger;
    ledger = reduceResourceActivity(ledger, observation({
      type: "provider_capability_receipt", evidenceId: "receipt-a", sourceEventKey: key("c"), requestKey: null, correlationKey: key("b"), runId: "run-a", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    }), context).ledger;
    const conflict = reduceResourceActivity(ledger, observation({
      type: "provider_capability_receipt", evidenceId: "receipt-b", sourceEventKey: key("d"), requestKey: null, correlationKey: key("b"), runId: "run-b", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(3),
    }), context);
    expect(conflict.ledger.activities[0]).toMatchObject({ runId: null, attribution: "conflict", coverage: "conflict" });
    expect(conflict.quarantine).toBe(true);
  });

  it("terminalizes a qualified pre-entry rejection without confirming use", () => {
    let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "provider_request", activityId: "activity-request", evidenceId: "evidence-request", sourceEventKey: key("a"), requestKey: key("b"), runId: "run-a", mode: "explicit", providerContract: "codex/0.154.0/v1", observedAt: at(0),
    }), context).ledger;
    ledger = reduceResourceActivity(ledger, observation({
      type: "pre_entry_outcome", evidenceId: "evidence-denied", sourceEventKey: key("c"), requestKey: key("b"), outcome: "permission_denied", providerContract: "codex/0.154.0/v1", observedAt: at(1),
    }), context).ledger;
    expect(ledger.activities[0]).toMatchObject({ requestState: "requested", useState: "not_confirmed", lifecycle: "terminal", outcome: "permission_denied" });
  });

  it("quarantines a contradictory pre-entry outcome after confirmed Capability use", () => {
    let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "provider_request", activityId: "activity-request", evidenceId: "request", sourceEventKey: key("a"), requestKey: key("b"), runId: "run-a", mode: "explicit", providerContract: "codex/0.154.0/v1", observedAt: at(0),
    }), context).ledger;
    ledger = reduceResourceActivity(ledger, observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "entered", sourceEventKey: key("c"), correlationKey: key("d"), providerContract: "host/v1", observedAt: at(1),
    }), context).ledger;
    ledger = reduceResourceActivity(ledger, observation({
      type: "provider_capability_receipt", evidenceId: "receipt", sourceEventKey: key("e"), requestKey: key("b"), correlationKey: key("d"), runId: "run-a", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    }), context).ledger;

    const result = reduceResourceActivity(ledger, observation({
      type: "pre_entry_outcome", evidenceId: "denied", sourceEventKey: key("f"), requestKey: key("b"), outcome: "permission_denied", providerContract: "codex/0.154.0/v1", observedAt: at(3),
    }), context);

    expect(result.disposition).toBe("conflict");
    expect(result.quarantine).toBe(true);
    expect(result.ledger.activities[0]).toMatchObject({
      useState: "confirmed",
      attribution: "conflict",
      coverage: "conflict",
    });
  });

  it("treats the same provider event changing its session as a conflict", () => {
    let ledger = reduceResourceActivity(emptyResourceActivityLedger(), observation({
      type: "capability_host_entered", activityId: "activity-host", evidenceId: "evidence-host", sourceEventKey: key("a"), correlationKey: key("b"), providerContract: "host/v1", observedAt: at(1),
    }), context).ledger;
    const receipt = observation({
      type: "provider_capability_receipt", evidenceId: "receipt-a", sourceEventKey: key("c"), requestKey: null, correlationKey: key("b"), runId: "run-a", mode: "explicit", routingIntegrity: "verified", providerContract: "codex/0.154.0/v1", observedAt: at(2),
    });
    ledger = reduceResourceActivity(ledger, receipt, context).ledger;
    const changed = reduceResourceActivity(ledger, { ...receipt, runId: "run-b" }, context);
    expect(changed.disposition).toBe("conflict");
    expect(changed.ledger.activities[0]).toMatchObject({ attribution: "conflict", runId: null });
  });

  it("confirms Skill Used only from exact context-entry evidence", () => {
    const skillIdentity = { resourceKind: "skill" as const, resourceId: "review", resourceVersion: "1.0.0", resourceDigest: digest("d") };
    const result = reduceResourceActivity(emptyResourceActivityLedger(), {
      type: "skill_context_receipt", activityId: "activity-skill", evidenceId: "evidence-skill", sourceEventKey: key("e"), requestKey: null, correlationKey: key("f"), runId: "run-a", mode: "automatic", routingIntegrity: "verified",
      providerContract: "opencode/1.18.30/v1", observedAt: at(1), identity: skillIdentity, lineage: { ...lineage, provider: "opencode", providerVersion: "1.18.30" },
    }, { qualifiedLineage: [{ ...lineage, provider: "opencode", providerVersion: "1.18.30" }] });
    expect(result.ledger.activities[0]).toMatchObject({ resourceKind: "skill", useState: "confirmed", outcome: "success", mode: "automatic", attribution: "exact" });
  });

  it("treats a second qualified Skill receipt for the same session as corroborating evidence", () => {
    const skillIdentity = { resourceKind: "skill" as const, resourceId: "review", resourceVersion: "1.0.0", resourceDigest: digest("d") };
    const skillLineage = { ...lineage, provider: "opencode" as const, providerVersion: "1.18.30" };
    const skillContext = { qualifiedLineage: [skillLineage] };
    const firstReceipt = {
      type: "skill_context_receipt" as const, activityId: "activity-skill", evidenceId: "receipt-live", sourceEventKey: key("a"), requestKey: null, correlationKey: key("b"), runId: "run-a", mode: "automatic" as const, routingIntegrity: "verified" as const,
      providerContract: "opencode/1.18.30/v1", observedAt: at(1), identity: skillIdentity, lineage: skillLineage,
    };
    const first = reduceResourceActivity(emptyResourceActivityLedger(), firstReceipt, skillContext);
    const replay = reduceResourceActivity(first.ledger, {
      ...firstReceipt,
      evidenceId: "receipt-history",
      sourceEventKey: key("c"),
      observedAt: at(2),
    }, skillContext);

    expect(replay.disposition).toBe("applied");
    expect(replay.ledger.activities).toHaveLength(1);
    expect(replay.ledger.evidence).toHaveLength(2);
    expect(replay.ledger.evidence.every(({ activityId }) => activityId === "activity-skill")).toBe(true);
  });

  it("merges an explicit Skill request into the exact context-entry activity", () => {
    const skillIdentity = { resourceKind: "skill" as const, resourceId: "review", resourceVersion: "1.0.0", resourceDigest: digest("d") };
    const skillLineage = { ...lineage, provider: "opencode" as const, providerVersion: "1.18.30" };
    const skillContext = { qualifiedLineage: [skillLineage] };
    const ledger = reduceResourceActivity(emptyResourceActivityLedger(), {
      type: "provider_request", activityId: "activity-request", evidenceId: "request-skill", sourceEventKey: key("a"), requestKey: key("b"), runId: "run-a", mode: "explicit",
      providerContract: "opencode/1.18.30/v1", observedAt: at(0), identity: skillIdentity, lineage: skillLineage,
    }, skillContext).ledger;
    const result = reduceResourceActivity(ledger, {
      type: "skill_context_receipt", activityId: "activity-context", evidenceId: "context-skill", sourceEventKey: key("c"), requestKey: key("b"), correlationKey: key("d"), runId: "run-a", mode: "explicit", routingIntegrity: "verified",
      providerContract: "opencode/1.18.30/v1", observedAt: at(1), identity: skillIdentity, lineage: skillLineage,
    }, skillContext);
    expect(result.ledger.activities).toHaveLength(1);
    expect(result.ledger.activities[0]).toMatchObject({ id: "activity-context", requestState: "requested", useState: "confirmed", runId: "run-a" });
    expect(result.ledger.evidence.every((event) => event.activityId === "activity-context")).toBe(true);
  });
});
