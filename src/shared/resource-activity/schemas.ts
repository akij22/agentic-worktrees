import { z } from "zod";
import { canonicalDecimalSchema, resourceKindSchema } from "../assignments/schemas";

const boundedIdSchema = z.string().trim().min(1).max(256);
const resourceIdSchema = z.string().trim().min(1).max(128);
const versionSchema = z.string().trim().min(1).max(80);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const evidenceKeySchema = z.string().regex(/^hmac:v[1-9][0-9]*:[a-f0-9]{64}$/);
export const activityProviderSchema = z.enum(["codex", "opencode"]);
export const requestStateSchema = z.enum(["not_observed", "requested"]);
export const useStateSchema = z.enum(["not_confirmed", "confirmed"]);
export const activityLifecycleSchema = z.enum(["open", "terminal"]);
export const activityOutcomeSchema = z.enum(["not_observed", "success", "reported_error", "thrown", "timeout", "cancelled", "rejected", "permission_denied", "load_failed"]);
export const attributionStateSchema = z.enum(["exact", "unknown", "conflict"]);
export const invocationModeSchema = z.enum(["explicit", "automatic", "unknown"]);
export const routingIntegritySchema = z.enum(["verified", "lease_mismatch", "unknown"]);
export const evidenceCoverageSchema = z.enum(["qualified", "pending", "evidence_gap", "provider_unqualified", "format_drift", "legacy_unverified", "conflict"]);

export const activityResourceIdentitySchema = z.object({
  resourceKind: resourceKindSchema,
  resourceId: resourceIdSchema,
  resourceVersion: versionSchema,
  resourceDigest: digestSchema,
}).strict();

export const activityLineageSchema = z.object({
  worktreeId: boundedIdSchema,
  assignmentRevision: canonicalDecimalSchema,
  assignmentGenerationId: boundedIdSchema,
  catalogGenerationId: boundedIdSchema,
  runtimeGenerationId: boundedIdSchema,
  provider: activityProviderSchema,
  providerVersion: versionSchema,
  adapterContractVersion: z.number().int().positive(),
}).strict();

export const resourceActivitySchema = z.object({
  id: boundedIdSchema,
  worktreeId: boundedIdSchema,
  runId: boundedIdSchema.nullable(),
  resourceKind: resourceKindSchema,
  resourceId: resourceIdSchema,
  resourceVersion: versionSchema,
  resourceDigest: digestSchema.nullable(),
  assignmentRevision: canonicalDecimalSchema.nullable(),
  assignmentGenerationId: boundedIdSchema.nullable(),
  catalogGenerationId: boundedIdSchema.nullable(),
  runtimeGenerationId: boundedIdSchema.nullable(),
  provider: activityProviderSchema.nullable(),
  providerVersion: versionSchema.nullable(),
  adapterContractVersion: z.number().int().positive().nullable(),
  requestKey: evidenceKeySchema.nullable(),
  correlationKey: evidenceKeySchema.nullable(),
  requestState: requestStateSchema,
  useState: useStateSchema,
  lifecycle: activityLifecycleSchema,
  outcome: activityOutcomeSchema,
  attribution: attributionStateSchema,
  mode: invocationModeSchema,
  routingIntegrity: routingIntegritySchema,
  coverage: evidenceCoverageSchema,
  requestedAt: z.date().nullable(),
  enteredOrLoadedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  firstObservedAt: z.date(),
  lastObservedAt: z.date(),
}).strict().superRefine((activity, context) => {
  const issue = (message: string, path: string[] = []) => context.addIssue({ code: "custom", message, path });
  if ((activity.attribution === "exact") !== (activity.runId !== null)) issue("Exact attribution requires a run; Unknown/conflict attribution forbids it.", ["runId"]);
  if ((activity.lifecycle === "terminal") !== (activity.finishedAt !== null)) issue("Terminal lifecycle and finishedAt must agree.", ["finishedAt"]);
  if ((activity.requestState === "requested") !== (activity.requestedAt !== null)) issue("Requested state and requestedAt must agree.", ["requestedAt"]);
  if ((activity.useState === "confirmed") !== (activity.enteredOrLoadedAt !== null)) issue("Confirmed use requires its E2 boundary time.", ["enteredOrLoadedAt"]);
  if (activity.resourceKind === "capability" && activity.mode === "automatic") issue("Capability mode cannot be automatic.", ["mode"]);
  if (activity.coverage === "qualified" && (activity.attribution === "conflict" || activity.routingIntegrity === "unknown")) issue("Qualified coverage requires non-conflicting known routing.", ["coverage"]);

  const nullableLineage = [activity.resourceDigest, activity.assignmentRevision, activity.assignmentGenerationId, activity.catalogGenerationId, activity.runtimeGenerationId, activity.provider, activity.providerVersion, activity.adapterContractVersion];
  if (activity.coverage === "legacy_unverified") {
    if (activity.resourceKind !== "skill" || activity.requestState !== "requested" || activity.useState !== "not_confirmed" || activity.attribution !== "exact" || activity.routingIntegrity !== "unknown" || nullableLineage.some((value) => value !== null)) {
      issue("Legacy activity requires the complete request-only legacy tuple.", ["coverage"]);
    }
  } else if (nullableLineage.some((value) => value === null)) issue("Non-legacy activity requires complete immutable lineage.");

  if (["rejected", "permission_denied"].includes(activity.outcome) && activity.useState !== "not_confirmed") issue("Pre-entry outcomes cannot confirm use.", ["outcome"]);
  if (activity.outcome === "load_failed" && (activity.resourceKind !== "skill" || activity.useState !== "not_confirmed")) issue("load_failed is Skill-only and pre-entry.", ["outcome"]);
  if (activity.resourceKind === "capability" && ["success", "reported_error", "thrown", "timeout", "cancelled"].includes(activity.outcome) && activity.useState !== "confirmed") issue("Capability post-entry outcome requires confirmed use.", ["outcome"]);
  if (activity.resourceKind === "skill" && activity.useState === "confirmed" && (activity.lifecycle !== "terminal" || activity.outcome !== "success")) issue("Skill context entry terminalizes loading successfully.", ["outcome"]);
  if (activity.lifecycle === "terminal" && activity.outcome === "not_observed" && !["evidence_gap", "provider_unqualified", "format_drift", "legacy_unverified"].includes(activity.coverage)) issue("Terminal activity without outcome requires explicit incomplete coverage.", ["coverage"]);
});

export const evidenceBoundarySchema = z.enum(["application.request", "provider.request", "capability_host.entered", "capability_host.outcome", "provider.capability_receipt", "provider.skill_context_receipt", "provider.outcome", "reconciliation.conflict"]);
export const resourceActivityEvidenceSchema = z.object({
  id: boundedIdSchema,
  activityId: boundedIdSchema,
  boundary: evidenceBoundarySchema,
  sourceEventKey: evidenceKeySchema,
  correlationKey: evidenceKeySchema.nullable(),
  providerContract: z.string().trim().min(1).max(128),
  observedAt: z.date(),
}).strict();

export const resourceActivitySessionRouteSchema = z.object({
  routeKey: evidenceKeySchema,
  runId: boundedIdSchema,
  worktreeId: boundedIdSchema,
  provider: activityProviderSchema,
  providerVersion: versionSchema,
  adapterContractVersion: z.number().int().positive(),
  runtimeGenerationId: boundedIdSchema,
  assignmentGenerationId: boundedIdSchema,
  catalogGenerationId: boundedIdSchema,
  registeredAt: z.date(),
  retiredAt: z.date().nullable(),
}).strict();

export const resourceEvidenceCoverageRecordSchema = z.object({
  id: boundedIdSchema,
  worktreeId: boundedIdSchema,
  provider: activityProviderSchema,
  providerVersion: versionSchema,
  adapterContractVersion: z.number().int().positive(),
  runtimeGenerationId: boundedIdSchema,
  assignmentGenerationId: boundedIdSchema.nullable(),
  catalogGenerationId: boundedIdSchema.nullable(),
  kind: z.enum(["evidence_gap", "provider_unqualified", "format_drift", "security_conflict"]),
  sourceEventKey: evidenceKeySchema,
  observedAt: z.date(),
  resolvedAt: z.date().nullable(),
}).strict();

const observationBase = z.object({
  evidenceId: boundedIdSchema,
  sourceEventKey: evidenceKeySchema,
  providerContract: z.string().trim().min(1).max(128),
  observedAt: z.date(),
  identity: activityResourceIdentitySchema,
  lineage: activityLineageSchema,
});
export const resourceActivityObservationSchema = z.discriminatedUnion("type", [
  observationBase.extend({ type: z.literal("application_request"), activityId: boundedIdSchema, requestKey: evidenceKeySchema, runId: boundedIdSchema, mode: z.literal("explicit") }).strict(),
  observationBase.extend({ type: z.literal("provider_request"), activityId: boundedIdSchema, requestKey: evidenceKeySchema, runId: boundedIdSchema, mode: invocationModeSchema }).strict(),
  observationBase.extend({ type: z.literal("capability_host_entered"), activityId: boundedIdSchema, correlationKey: evidenceKeySchema }).strict(),
  observationBase.extend({ type: z.literal("capability_host_outcome"), correlationKey: evidenceKeySchema, outcome: z.enum(["success", "reported_error", "thrown", "timeout", "cancelled"]) }).strict(),
  observationBase.extend({ type: z.literal("provider_capability_receipt"), requestKey: evidenceKeySchema.nullable(), correlationKey: evidenceKeySchema, runId: boundedIdSchema, mode: z.enum(["explicit", "unknown"]), routingIntegrity: z.enum(["verified", "lease_mismatch"]) }).strict(),
  observationBase.extend({ type: z.literal("skill_context_receipt"), activityId: boundedIdSchema, requestKey: evidenceKeySchema.nullable(), correlationKey: evidenceKeySchema, runId: boundedIdSchema, mode: invocationModeSchema, routingIntegrity: z.enum(["verified", "lease_mismatch"]).default("verified") }).strict(),
  observationBase.extend({ type: z.literal("pre_entry_outcome"), requestKey: evidenceKeySchema, outcome: z.enum(["rejected", "permission_denied", "load_failed"]) }).strict(),
]).superRefine((observation, context) => {
  const capabilityBoundary = [
    "capability_host_entered",
    "capability_host_outcome",
    "provider_capability_receipt",
  ].includes(observation.type);
  if (capabilityBoundary && observation.identity.resourceKind !== "capability") {
    context.addIssue({ code: "custom", message: "Capability evidence requires Capability identity.", path: ["identity", "resourceKind"] });
  }
  if (observation.type === "skill_context_receipt" && observation.identity.resourceKind !== "skill") {
    context.addIssue({ code: "custom", message: "Skill context evidence requires Skill identity.", path: ["identity", "resourceKind"] });
  }
  if ((observation.type === "application_request" || observation.type === "provider_request")
    && observation.identity.resourceKind === "capability"
    && observation.mode === "automatic") {
    context.addIssue({ code: "custom", message: "Capability requests cannot be automatic.", path: ["mode"] });
  }
  if (observation.type === "pre_entry_outcome"
    && observation.outcome === "load_failed"
    && observation.identity.resourceKind !== "skill") {
    context.addIssue({ code: "custom", message: "load_failed evidence requires Skill identity.", path: ["outcome"] });
  }
});

export const sessionResourceActivityItemSchema = z.object({
  id: boundedIdSchema,
  resourceKind: resourceKindSchema,
  resourceId: resourceIdSchema,
  resourceVersion: versionSchema,
  requestState: requestStateSchema,
  useState: useStateSchema,
  lifecycle: activityLifecycleSchema,
  outcome: activityOutcomeSchema,
  mode: invocationModeSchema,
  coverage: evidenceCoverageSchema,
  occurredAt: z.string().datetime(),
}).strict();
export const sessionResourceActivitySnapshotSchema = z.object({
  runId: boundedIdSchema,
  sequence: canonicalDecimalSchema,
  items: z.array(sessionResourceActivityItemSchema).max(1_000),
}).strict().superRefine((snapshot, context) => {
  const ids = new Set<string>();
  snapshot.items.forEach((item, index) => {
    if (ids.has(item.id)) {
      context.addIssue({ code: "custom", message: "Activity snapshot IDs must be unique.", path: ["items", index, "id"] });
    }
    ids.add(item.id);
  });
});
export const sessionResourceActivityChangedEventSchema = z.object({
  eventId: boundedIdSchema,
  runId: boundedIdSchema,
  sequence: canonicalDecimalSchema,
  change: z.discriminatedUnion("type", [
    z.object({ type: z.literal("upsert"), item: sessionResourceActivityItemSchema }).strict(),
    z.object({ type: z.literal("remove"), activityId: boundedIdSchema }).strict(),
  ]),
}).strict();
export const resourceActivityListRequestSchema = z.object({ runId: boundedIdSchema }).strict();
export const resourceActivityIpcErrorSchema = z.object({ code: z.enum(["activity_run_not_found", "activity_access_denied", "internal_error"]), message: z.string().trim().min(1).max(512) }).strict();
export const resourceActivityIpcResultSchema = <T extends z.ZodType>(value: T) => z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value }).strict(),
  z.object({ ok: z.literal(false), error: resourceActivityIpcErrorSchema }).strict(),
]);

export type ResourceActivity = z.infer<typeof resourceActivitySchema>;
export type ResourceActivityEvidence = z.infer<typeof resourceActivityEvidenceSchema>;
export type ResourceActivitySessionRoute = z.infer<typeof resourceActivitySessionRouteSchema>;
export type ResourceEvidenceCoverageRecord = z.infer<typeof resourceEvidenceCoverageRecordSchema>;
export type ResourceActivityObservation = z.infer<typeof resourceActivityObservationSchema>;
export type ActivityLineage = z.infer<typeof activityLineageSchema>;
export type SessionResourceActivityItem = z.infer<typeof sessionResourceActivityItemSchema>;
export type SessionResourceActivitySnapshot = z.infer<typeof sessionResourceActivitySnapshotSchema>;
export type SessionResourceActivityChangedEvent = z.infer<typeof sessionResourceActivityChangedEventSchema>;
export type ResourceActivityListRequest = z.infer<typeof resourceActivityListRequestSchema>;
export type ResourceActivityIpcError = z.infer<typeof resourceActivityIpcErrorSchema>;
export type ResourceActivityIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ResourceActivityIpcError };
