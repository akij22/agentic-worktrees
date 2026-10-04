import {
  resourceActivityEvidenceSchema,
  resourceActivityObservationSchema,
  resourceActivitySchema,
  type ActivityLineage,
  type ResourceActivity,
  type ResourceActivityEvidence,
  type ResourceActivityObservation,
} from "./schemas";

export type ResourceActivityLedger = {
  activities: ResourceActivity[];
  evidence: ResourceActivityEvidence[];
};

export type ResourceActivityReduction = {
  ledger: ResourceActivityLedger;
  disposition: "applied" | "duplicate" | "unmatched" | "conflict" | "stale_rejected";
  quarantine: boolean;
};

type ReductionContext = { qualifiedLineage: ActivityLineage[] };

export function emptyResourceActivityLedger(): ResourceActivityLedger {
  return { activities: [], evidence: [] };
}

const lineageMatches = (left: ActivityLineage, right: ActivityLineage) =>
  left.worktreeId === right.worktreeId
  && left.assignmentRevision === right.assignmentRevision
  && left.assignmentGenerationId === right.assignmentGenerationId
  && left.catalogGenerationId === right.catalogGenerationId
  && left.runtimeGenerationId === right.runtimeGenerationId
  && left.provider === right.provider
  && left.providerVersion === right.providerVersion
  && left.adapterContractVersion === right.adapterContractVersion;

const identityMatches = (activity: ResourceActivity, observation: ResourceActivityObservation) =>
  activity.resourceKind === observation.identity.resourceKind
  && activity.resourceId === observation.identity.resourceId
  && activity.resourceVersion === observation.identity.resourceVersion
  && activity.resourceDigest === observation.identity.resourceDigest;

const activityLineageMatches = (activity: ResourceActivity, observation: ResourceActivityObservation) =>
  activity.worktreeId === observation.lineage.worktreeId
  && activity.assignmentRevision === observation.lineage.assignmentRevision
  && activity.assignmentGenerationId === observation.lineage.assignmentGenerationId
  && activity.catalogGenerationId === observation.lineage.catalogGenerationId
  && activity.runtimeGenerationId === observation.lineage.runtimeGenerationId
  && activity.provider === observation.lineage.provider
  && activity.providerVersion === observation.lineage.providerVersion
  && activity.adapterContractVersion === observation.lineage.adapterContractVersion;

const boundaryFor = (observation: ResourceActivityObservation): ResourceActivityEvidence["boundary"] => {
  switch (observation.type) {
    case "application_request": return "application.request";
    case "provider_request": return "provider.request";
    case "capability_host_entered": return "capability_host.entered";
    case "capability_host_outcome": return "capability_host.outcome";
    case "provider_capability_receipt": return "provider.capability_receipt";
    case "skill_context_receipt": return "provider.skill_context_receipt";
    case "pre_entry_outcome": return "provider.outcome";
  }
};

const correlationFor = (observation: ResourceActivityObservation) => "correlationKey" in observation ? observation.correlationKey : null;

const evidenceFor = (observation: ResourceActivityObservation, activityId: string) => resourceActivityEvidenceSchema.parse({
  id: observation.evidenceId,
  activityId,
  boundary: boundaryFor(observation),
  sourceEventKey: observation.sourceEventKey,
  correlationKey: correlationFor(observation),
  providerContract: observation.providerContract,
  observedAt: observation.observedAt,
});

function replaceActivity(ledger: ResourceActivityLedger, activity: ResourceActivity): ResourceActivityLedger {
  return { ...ledger, activities: ledger.activities.map((current) => current.id === activity.id ? activity : current) };
}

function conflictActivity(ledger: ResourceActivityLedger, activityId: string): ResourceActivityLedger {
  const current = ledger.activities.find((activity) => activity.id === activityId);
  if (!current) return ledger;
  const conflict = resourceActivitySchema.parse({ ...current, runId: null, attribution: "conflict", coverage: "conflict" });
  return replaceActivity(ledger, conflict);
}

function baseActivity(observation: ResourceActivityObservation, input: Partial<ResourceActivity> & Pick<ResourceActivity, "id" | "requestState" | "useState" | "lifecycle" | "outcome" | "attribution" | "mode" | "routingIntegrity" | "coverage">) {
  return resourceActivitySchema.parse({
    id: input.id,
    ...observation.lineage,
    ...observation.identity,
    runId: input.runId ?? null,
    requestKey: input.requestKey ?? null,
    correlationKey: input.correlationKey ?? null,
    requestState: input.requestState,
    useState: input.useState,
    lifecycle: input.lifecycle,
    outcome: input.outcome,
    attribution: input.attribution,
    mode: input.mode,
    routingIntegrity: input.routingIntegrity,
    coverage: input.coverage,
    requestedAt: input.requestedAt ?? null,
    enteredOrLoadedAt: input.enteredOrLoadedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    firstObservedAt: input.firstObservedAt ?? observation.observedAt,
    lastObservedAt: input.lastObservedAt ?? observation.observedAt,
  });
}

export function reduceResourceActivity(input: ResourceActivityLedger, rawObservation: ResourceActivityObservation, context: ReductionContext): ResourceActivityReduction {
  const observation = resourceActivityObservationSchema.parse(rawObservation);
  if (!context.qualifiedLineage.some((lineage) => lineageMatches(lineage, observation.lineage))) {
    return { ledger: input, disposition: "stale_rejected", quarantine: false };
  }

  const boundary = boundaryFor(observation);
  const priorEvidence = input.evidence.find((event) => event.boundary === boundary && event.sourceEventKey === observation.sourceEventKey);
  if (priorEvidence) {
    const activity = input.activities.find((candidate) => candidate.id === priorEvidence.activityId);
    const changedSession = activity !== undefined && "runId" in observation && observation.runId !== undefined && activity.runId !== observation.runId;
    const changedOutcome = activity !== undefined && observation.type === "capability_host_outcome" && activity.lifecycle === "terminal" && activity.outcome !== observation.outcome;
    const changedIdentity = activity !== undefined && (!identityMatches(activity, observation) || !activityLineageMatches(activity, observation));
    const changed = priorEvidence.correlationKey !== correlationFor(observation)
      || priorEvidence.providerContract !== observation.providerContract
      || changedSession
      || changedOutcome
      || changedIdentity;
    return changed
      ? { ledger: conflictActivity(input, priorEvidence.activityId), disposition: "conflict", quarantine: true }
      : { ledger: input, disposition: "duplicate", quarantine: false };
  }

  if (observation.type === "application_request" || observation.type === "provider_request") {
    const existing = input.activities.find((activity) => activity.requestKey === observation.requestKey);
    if (existing) {
      if (existing.runId !== observation.runId || !identityMatches(existing, observation) || !activityLineageMatches(existing, observation)) {
        return { ledger: conflictActivity(input, existing.id), disposition: "conflict", quarantine: true };
      }
      return { ledger: { ...input, evidence: [...input.evidence, evidenceFor(observation, existing.id)] }, disposition: "applied", quarantine: false };
    }
    const activity = baseActivity(observation, {
      id: observation.activityId,
      runId: observation.runId,
      requestKey: observation.requestKey,
      requestState: "requested",
      useState: "not_confirmed",
      lifecycle: "open",
      outcome: "not_observed",
      attribution: "exact",
      mode: observation.mode,
      routingIntegrity: "verified",
      coverage: "pending",
      requestedAt: observation.observedAt,
    });
    return { ledger: { activities: [...input.activities, activity], evidence: [...input.evidence, evidenceFor(observation, activity.id)] }, disposition: "applied", quarantine: false };
  }

  if (observation.type === "capability_host_entered") {
    if (observation.identity.resourceKind !== "capability") return { ledger: input, disposition: "unmatched", quarantine: false };
    const existing = input.activities.find((activity) => activity.correlationKey === observation.correlationKey);
    if (existing) {
      if (!identityMatches(existing, observation) || !activityLineageMatches(existing, observation)) return { ledger: conflictActivity(input, existing.id), disposition: "conflict", quarantine: true };
      return { ledger: { ...input, evidence: [...input.evidence, evidenceFor(observation, existing.id)] }, disposition: "applied", quarantine: false };
    }
    const activity = baseActivity(observation, {
      id: observation.activityId,
      correlationKey: observation.correlationKey,
      requestState: "not_observed",
      useState: "confirmed",
      lifecycle: "open",
      outcome: "not_observed",
      attribution: "unknown",
      mode: "unknown",
      routingIntegrity: "unknown",
      coverage: "pending",
      enteredOrLoadedAt: observation.observedAt,
    });
    return { ledger: { activities: [...input.activities, activity], evidence: [...input.evidence, evidenceFor(observation, activity.id)] }, disposition: "applied", quarantine: false };
  }

  if (observation.type === "capability_host_outcome") {
    const activity = input.activities.find((candidate) => candidate.correlationKey === observation.correlationKey);
    if (!activity || activity.resourceKind !== "capability" || !identityMatches(activity, observation) || !activityLineageMatches(activity, observation)) return { ledger: input, disposition: "unmatched", quarantine: false };
    const terminal = resourceActivitySchema.parse({ ...activity, lifecycle: "terminal", outcome: observation.outcome, finishedAt: observation.observedAt, lastObservedAt: observation.observedAt });
    const ledger = replaceActivity(input, terminal);
    return { ledger: { ...ledger, evidence: [...ledger.evidence, evidenceFor(observation, activity.id)] }, disposition: "applied", quarantine: false };
  }

  if (observation.type === "provider_capability_receipt") {
    const host = input.activities.find((activity) => activity.correlationKey === observation.correlationKey && activity.resourceKind === "capability");
    if (!host || !identityMatches(host, observation) || !activityLineageMatches(host, observation)) return { ledger: input, disposition: "unmatched", quarantine: false };
    if (host.attribution === "exact" && host.runId !== observation.runId) return { ledger: conflictActivity(input, host.id), disposition: "conflict", quarantine: true };

    const request = observation.requestKey ? input.activities.find((activity) => activity.requestKey === observation.requestKey) : undefined;
    if (request && (request.runId !== observation.runId || !identityMatches(request, observation) || !activityLineageMatches(request, observation))) {
      return { ledger: conflictActivity(input, host.id), disposition: "conflict", quarantine: true };
    }
    const paired = resourceActivitySchema.parse({
      ...host,
      runId: observation.runId,
      requestKey: observation.requestKey ?? host.requestKey,
      requestState: request?.requestState ?? host.requestState,
      requestedAt: request?.requestedAt ?? host.requestedAt,
      attribution: "exact",
      mode: observation.mode,
      routingIntegrity: observation.routingIntegrity,
      coverage: "qualified",
      lastObservedAt: observation.observedAt,
    });
    const removedRequestId = request && request.id !== host.id ? request.id : undefined;
    const movedEvidence = input.evidence.map((event) => event.activityId === removedRequestId ? { ...event, activityId: host.id } : event);
    const ledger = {
      activities: input.activities.filter((activity) => activity.id !== removedRequestId).map((activity) => activity.id === host.id ? paired : activity),
      evidence: [...movedEvidence, evidenceFor(observation, host.id)],
    };
    return { ledger, disposition: "applied", quarantine: observation.routingIntegrity === "lease_mismatch" };
  }

  if (observation.type === "skill_context_receipt") {
    if (observation.identity.resourceKind !== "skill") return { ledger: input, disposition: "unmatched", quarantine: false };
    const existing = input.activities.find((activity) => activity.correlationKey === observation.correlationKey);
    if (existing) {
      const contradictsExisting = existing.resourceKind !== "skill"
        || existing.runId !== observation.runId
        || !identityMatches(existing, observation)
        || !activityLineageMatches(existing, observation)
        || existing.requestKey !== observation.requestKey
        || existing.mode !== observation.mode
        || existing.routingIntegrity !== observation.routingIntegrity;
      if (contradictsExisting) {
        return { ledger: conflictActivity(input, existing.id), disposition: "conflict", quarantine: true };
      }
      return {
        ledger: { ...input, evidence: [...input.evidence, evidenceFor(observation, existing.id)] },
        disposition: "applied",
        quarantine: false,
      };
    }
    const request = observation.requestKey ? input.activities.find((activity) => activity.requestKey === observation.requestKey) : undefined;
    if (request && (request.runId !== observation.runId || !identityMatches(request, observation) || !activityLineageMatches(request, observation))) {
      return { ledger: conflictActivity(input, request.id), disposition: "conflict", quarantine: true };
    }
    const activity = baseActivity(observation, {
      id: observation.activityId,
      runId: observation.runId,
      requestKey: observation.requestKey,
      correlationKey: observation.correlationKey,
      requestState: request ? "requested" : "not_observed",
      useState: "confirmed",
      lifecycle: "terminal",
      outcome: "success",
      attribution: "exact",
      mode: observation.mode,
      routingIntegrity: observation.routingIntegrity,
      coverage: "qualified",
      requestedAt: request?.requestedAt ?? null,
      enteredOrLoadedAt: observation.observedAt,
      finishedAt: observation.observedAt,
    });
    const removedRequestId = request?.id;
    const movedEvidence = input.evidence.map((event) => event.activityId === removedRequestId ? { ...event, activityId: activity.id } : event);
    const ledger = {
      activities: [...input.activities.filter((candidate) => candidate.id !== removedRequestId), activity],
      evidence: [...movedEvidence, evidenceFor(observation, activity.id)],
    };
    return { ledger, disposition: "applied", quarantine: observation.routingIntegrity === "lease_mismatch" };
  }

  const requested = input.activities.find((activity) => activity.requestKey === observation.requestKey);
  if (!requested || !identityMatches(requested, observation) || !activityLineageMatches(requested, observation)) return { ledger: input, disposition: "unmatched", quarantine: false };
  if (requested.useState === "confirmed" || (requested.lifecycle === "terminal" && requested.outcome !== observation.outcome)) {
    return { ledger: conflictActivity(input, requested.id), disposition: "conflict", quarantine: true };
  }
  const terminal = resourceActivitySchema.parse({ ...requested, lifecycle: "terminal", outcome: observation.outcome, coverage: "qualified", finishedAt: observation.observedAt, lastObservedAt: observation.observedAt });
  const ledger = replaceActivity(input, terminal);
  return { ledger: { ...ledger, evidence: [...ledger.evidence, evidenceFor(observation, requested.id)] }, disposition: "applied", quarantine: false };
}
