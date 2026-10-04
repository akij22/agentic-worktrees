import { z } from "zod";

const boundedIdSchema = z.string().trim().min(1).max(128);
const boundedTextIdSchema = z.string().trim().min(1).max(256);
const versionSchema = z.string().trim().min(1).max(80);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safeMessageSchema = z.string().trim().min(1).max(512);

export const canonicalDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const assignmentAgentKindSchema = z.enum(["codex", "opencode"]);
export const resourceKindSchema = z.enum(["capability", "skill"]);
export const assignmentPhaseSchema = z.enum([
  "reconciling",
  "stable",
  "waiting_for_idle",
  "applying",
  "rolling_back",
  "failed_rolled_back",
  "recovery_required",
  "removing",
]);
export const skillIsolationSchema = z.enum(["enforced", "not_enforced", "not_applicable"]);

export const resourceProviderProjectionSchema = z.object({
  agentKind: assignmentAgentKindSchema,
  availability: z.enum(["compatible", "unavailable"]),
  skillIsolation: skillIsolationSchema,
  qualificationDigest: digestSchema,
  expectedStateDigest: digestSchema,
}).strict();

export const resourceIdentitySchema = z.object({
  kind: resourceKindSchema,
  id: boundedIdSchema,
  version: versionSchema,
  contentDigest: digestSchema,
  securityDigest: digestSchema,
  configurationDigest: digestSchema,
  invocationPolicyDigest: digestSchema,
  providerProjections: z.array(resourceProviderProjectionSchema).length(2),
}).strict().superRefine((resource, context) => {
  const expectedKinds = assignmentAgentKindSchema.options;
  resource.providerProjections.forEach((projection, index) => {
    if (projection.agentKind !== expectedKinds[index]) {
      context.addIssue({ code: "custom", message: "Provider projections must contain Codex and OpenCode in canonical order.", path: ["providerProjections", index, "agentKind"] });
    }
    const expectedIsolation = resource.kind === "capability" ? "not_applicable" : undefined;
    if (expectedIsolation && projection.skillIsolation !== expectedIsolation) {
      context.addIssue({ code: "custom", message: "Capability provider projections require not_applicable Skill isolation.", path: ["providerProjections", index, "skillIsolation"] });
    }
    if (resource.kind === "skill" && projection.skillIsolation === "not_applicable") {
      context.addIssue({ code: "custom", message: "Skill provider projections must declare an isolation posture.", path: ["providerProjections", index, "skillIsolation"] });
    }
  });
});

const resourceKey = (resource: z.infer<typeof resourceIdentitySchema>) => `${resource.kind}:${resource.id}`;

export const resourceAssignmentGenerationSchema = z.object({
  id: boundedTextIdSchema,
  resources: z.array(resourceIdentitySchema).max(256),
}).strict().superRefine((generation, context) => {
  let previous: string | undefined;
  generation.resources.forEach((resource, index) => {
    const key = resourceKey(resource);
    if (previous !== undefined && key <= previous) {
      context.addIssue({ code: "custom", message: key === previous ? "Duplicate Resource identity." : "Resources must use canonical kind/id order.", path: ["resources", index] });
    }
    previous = key;
  });
});

export const assignmentErrorCodeSchema = z.enum([
  "assignment_conflict",
  "assignment_invalid_resource",
  "assignment_setup_required",
  "assignment_waiting_for_idle",
  "assignment_apply_failed",
  "assignment_recovery_required",
  "resource_unavailable",
  "resource_update_pending",
  "runtime_unavailable",
  "worktree_removing",
  "operation_cancelled",
  "internal_error",
]);

export const assignmentFailureSchema = z.object({
  code: assignmentErrorCodeSchema,
  message: safeMessageSchema,
}).strict();

export const assignmentAttemptKindSchema = z.enum([
  "assignment_apply",
  "runtime_join",
  "recovery",
  "resource_update",
  "removal",
]);
export const assignmentAttemptStatusSchema = z.enum([
  "preparing",
  "waiting_for_idle",
  "applying",
  "rolling_back",
  "verified",
  "failed_rolled_back",
  "recovery_required",
  "superseded",
  "cancelled",
]);
export const assignmentSideEffectBoundarySchema = z.enum([
  "none",
  "staged",
  "activated",
  "commit_pending",
]);
export const assignmentAttemptSchema = z.object({
  attemptId: boundedTextIdSchema,
  kind: assignmentAttemptKindSchema,
  targetRevision: canonicalDecimalSchema,
  targetGenerationId: boundedTextIdSchema,
  priorVerifiedGenerationId: boundedTextIdSchema.nullable(),
  status: assignmentAttemptStatusSchema,
  sideEffectBoundary: assignmentSideEffectBoundarySchema,
  createdAt: z.string().datetime(),
}).strict();

export const assignmentParticipantAttestationSchema = z.object({
  agentKind: assignmentAgentKindSchema,
  runtimeGenerationId: boundedTextIdSchema,
  assignmentGenerationId: boundedTextIdSchema,
  catalogGenerationId: boundedTextIdSchema,
  providerVersion: versionSchema,
  adapterContractVersion: z.number().int().positive(),
  effectiveStateDigest: digestSchema,
  skillIsolation: skillIsolationSchema,
  attestedAt: z.string().datetime(),
}).strict();

export const assignmentAggregateSchema = z.object({
  worktreeId: boundedIdSchema,
  revision: canonicalDecimalSchema,
  projectionSequence: canonicalDecimalSchema,
  desiredGeneration: resourceAssignmentGenerationSchema,
  verifiedGeneration: resourceAssignmentGenerationSchema,
  phase: assignmentPhaseSchema,
  attempt: assignmentAttemptSchema.nullable(),
  participants: z.array(assignmentParticipantAttestationSchema).max(8),
  failure: assignmentFailureSchema.nullable(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((aggregate, context) => {
  if (aggregate.phase === "stable" && aggregate.desiredGeneration.id !== aggregate.verifiedGeneration.id) {
    context.addIssue({ code: "custom", message: "Stable Assignment must have matching desired and verified generations.", path: ["phase"] });
  }
  if (aggregate.phase === "stable" && aggregate.attempt !== null) {
    context.addIssue({ code: "custom", message: "Stable Assignment cannot retain an active attempt.", path: ["attempt"] });
  }
  if (aggregate.phase === "stable" && aggregate.failure !== null) {
    context.addIssue({ code: "custom", message: "Stable Assignment cannot retain failure state.", path: ["failure"] });
  }
  if (aggregate.phase === "failed_rolled_back") {
    if (aggregate.desiredGeneration.id === aggregate.verifiedGeneration.id) {
      context.addIssue({ code: "custom", message: "Verified rollback requires a differing desired generation.", path: ["desiredGeneration"] });
    }
    if (aggregate.failure === null) {
      context.addIssue({ code: "custom", message: "Verified rollback requires a structured failure.", path: ["failure"] });
    }
  }
  if (aggregate.phase === "recovery_required" && aggregate.failure === null) {
    context.addIssue({ code: "custom", message: "Recovery-required Assignment needs a structured failure.", path: ["failure"] });
  }
  if (["waiting_for_idle", "applying", "rolling_back"].includes(aggregate.phase) && aggregate.attempt === null) {
    context.addIssue({ code: "custom", message: "Active Assignment phase requires an attempt.", path: ["attempt"] });
  }
});

export const assignmentGetRequestSchema = z.object({ worktreeId: boundedIdSchema, agentKind: assignmentAgentKindSchema }).strict();
export const assignmentResourceSelectionSchema = z.object({ kind: resourceKindSchema, id: boundedIdSchema, version: versionSchema }).strict();
export const assignmentSetDesiredRequestSchema = z.object({
  worktreeId: boundedIdSchema,
  expectedRevision: canonicalDecimalSchema,
  resources: z.array(assignmentResourceSelectionSchema).max(256),
}).strict().superRefine((request, context) => {
  const seen = new Set<string>();
  request.resources.forEach((resource, index) => {
    const key = resourceKey(resource as z.infer<typeof resourceIdentitySchema>);
    if (seen.has(key)) context.addIssue({ code: "custom", message: "Duplicate Resource selection.", path: ["resources", index] });
    seen.add(key);
  });
});
export const assignmentRevisionRequestSchema = z.object({ worktreeId: boundedIdSchema, expectedRevision: canonicalDecimalSchema }).strict();
export const assignmentRetryRequestSchema = assignmentRevisionRequestSchema;
export const assignmentCancelPendingRequestSchema = assignmentRevisionRequestSchema;
export const assignmentRecoveryActionSchema = z.enum(["retry_recovery", "recreate_affected_runtimes", "revert_desired"]);
export const assignmentRecoverRequestSchema = assignmentRevisionRequestSchema.extend({ action: assignmentRecoveryActionSchema }).strict();

export const resourceAssignmentItemSchema = z.object({
  kind: resourceKindSchema,
  id: boundedIdSchema,
  name: z.string().trim().min(1).max(80),
  version: versionSchema,
  description: z.string().trim().max(1_024),
  desired: z.boolean(),
  verified: z.boolean(),
  operation: z.enum(["adding", "removing"]).nullable(),
  status: z.enum(["installed", "applying", "enabled", "unavailable", "failed", "recovery_required"]),
  assignable: z.boolean(),
  unavailableReason: z.enum(["setup_required", "provider_incompatible", "provider_unqualified", "installation_invalid", "consent_required"]).nullable(),
  automaticUsageReporting: z.enum(["supported", "unknown", "not_applicable"]),
  skillIsolation: skillIsolationSchema,
}).strict().superRefine((item, context) => {
  if (item.status === "enabled" && (!item.desired || !item.verified)) context.addIssue({ code: "custom", message: "Enabled Resource must be desired and verified." });
  if (item.kind === "capability" && item.skillIsolation !== "not_applicable") context.addIssue({ code: "custom", message: "Capability Skill isolation must be not_applicable.", path: ["skillIsolation"] });
});

export const assignmentBlockerSchema = z.object({
  kind: z.enum(["active_turn", "provider_pending", "permission_waiting", "aborting", "queued_follow_up", "runtime_transition", "event_drain"]),
  sessionRunId: boundedIdSchema.nullable(),
  sessionTitle: z.string().trim().min(1).max(256).nullable(),
  canStop: z.boolean(),
}).strict();
export const assignmentProgressSchema = z.object({
  step: z.enum(["preparing", "waiting_for_idle", "staging", "activating", "verifying", "rolling_back", "recovering"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  waitingSince: z.string().datetime().nullable(),
}).strict().refine((progress) => progress.completed <= progress.total, "Completed progress cannot exceed total.");
export const assignmentAdmissionSchema = z.object({
  canCreateSession: z.boolean(),
  canResumeSession: z.boolean(),
  canSend: z.boolean(),
  reason: z.enum(["assignment_busy", "recovery_required", "runtime_verification", "worktree_removing"]).nullable(),
  message: safeMessageSchema.nullable(),
}).strict().superRefine((admission, context) => {
  const unrestricted = admission.canCreateSession && admission.canResumeSession && admission.canSend;
  const hasExplanation = admission.reason !== null && admission.message !== null;
  if ((unrestricted && (admission.reason !== null || admission.message !== null)) || (!unrestricted && !hasExplanation)) {
    context.addIssue({ code: "custom", message: "Admission reason/message must describe every restriction." });
  }
});
export const assignmentActionSchema = z.enum(["retry", "cancel_pending", "retry_recovery", "recreate_affected_runtimes", "revert_desired"]);

export const assignmentProjectionSchema = z.object({
  worktreeId: boundedIdSchema,
  revision: canonicalDecimalSchema,
  projectionSequence: canonicalDecimalSchema,
  phase: assignmentPhaseSchema,
  currentAgentKind: assignmentAgentKindSchema,
  resources: z.array(resourceAssignmentItemSchema).max(256),
  blockers: z.array(assignmentBlockerSchema).max(256),
  progress: assignmentProgressSchema.nullable(),
  admission: assignmentAdmissionSchema,
  allowedActions: z.array(assignmentActionSchema).max(5),
  failure: assignmentFailureSchema.nullable(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((projection, context) => {
  const actions = new Set(projection.allowedActions);
  if (actions.size !== projection.allowedActions.length) {
    context.addIssue({ code: "custom", message: "Allowed Assignment actions must be unique.", path: ["allowedActions"] });
  }
  const resources = new Set<string>();
  projection.resources.forEach((resource, index) => {
    const key = `${resource.kind}:${resource.id}`;
    if (resources.has(key)) {
      context.addIssue({ code: "custom", message: "Assignment projection Resources must be unique.", path: ["resources", index] });
    }
    resources.add(key);
  });
});

export const assignmentChangedEventSchema = z.object({
  eventId: boundedTextIdSchema,
  worktreeId: boundedIdSchema,
  revision: canonicalDecimalSchema,
  projectionSequence: canonicalDecimalSchema,
  projection: assignmentProjectionSchema,
}).strict().superRefine((event, context) => {
  if (event.worktreeId !== event.projection.worktreeId || event.revision !== event.projection.revision || event.projectionSequence !== event.projection.projectionSequence) {
    context.addIssue({ code: "custom", message: "Assignment event lineage must match its projection.", path: ["projection"] });
  }
});

export const assignmentIpcErrorSchema = z.object({
  code: assignmentErrorCodeSchema,
  message: safeMessageSchema,
  retryable: z.boolean(),
  current: assignmentProjectionSchema.optional(),
}).strict();
export const assignmentIpcResultSchema = <T extends z.ZodType>(value: T) => z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value }).strict(),
  z.object({ ok: z.literal(false), error: assignmentIpcErrorSchema }).strict(),
]);

export type ResourceKind = z.infer<typeof resourceKindSchema>;
export type ResourceProviderProjection = z.infer<typeof resourceProviderProjectionSchema>;
export type ResourceIdentity = z.infer<typeof resourceIdentitySchema>;
export type ResourceAssignmentGeneration = z.infer<typeof resourceAssignmentGenerationSchema>;
export type AssignmentPhase = z.infer<typeof assignmentPhaseSchema>;
export type AssignmentAggregate = z.infer<typeof assignmentAggregateSchema>;
export type AssignmentAttempt = z.infer<typeof assignmentAttemptSchema>;
export type AssignmentParticipantAttestation = z.infer<typeof assignmentParticipantAttestationSchema>;
export type ResourceAssignmentItemDto = z.infer<typeof resourceAssignmentItemSchema>;
export type AssignmentBlockerDto = z.infer<typeof assignmentBlockerSchema>;
export type AssignmentProgressDto = z.infer<typeof assignmentProgressSchema>;
export type AssignmentAdmissionDto = z.infer<typeof assignmentAdmissionSchema>;
export type AssignmentAction = z.infer<typeof assignmentActionSchema>;
export type AssignmentProjectionDto = z.infer<typeof assignmentProjectionSchema>;
export type AssignmentChangedEventDto = z.infer<typeof assignmentChangedEventSchema>;
export type AssignmentGetRequest = z.infer<typeof assignmentGetRequestSchema>;
export type AssignmentSetDesiredRequest = z.infer<typeof assignmentSetDesiredRequestSchema>;
export type AssignmentRevisionRequest = z.infer<typeof assignmentRevisionRequestSchema>;
export type AssignmentRecoverRequest = z.infer<typeof assignmentRecoverRequestSchema>;
export type AssignmentErrorCode = z.infer<typeof assignmentErrorCodeSchema>;
export type AssignmentIpcError = z.infer<typeof assignmentIpcErrorSchema>;
export type AssignmentIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AssignmentIpcError };
