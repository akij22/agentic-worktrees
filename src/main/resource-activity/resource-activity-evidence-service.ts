import { z } from "zod";
import { createHmac, randomUUID } from "node:crypto";
import {
  capabilityHostObservationSchema,
  capabilityReceiptSchema,
  type CapabilityReceipt,
  type CapabilityHostObservation,
} from "../capabilities/capability-receipt";
import {
  activityLineageSchema,
  activityResourceIdentitySchema,
  type ActivityLineage,
  type ResourceActivityObservation,
  type SessionResourceActivityChangedEvent,
} from "../../shared/resource-activity";
import { ResourceActivityRepository } from "./resource-activity-repository";

type ResourceIdentity = ResourceActivityObservation["identity"];
export interface ProviderEvidenceContract {
  name: string;
  provider: ActivityLineage["provider"];
  providerVersion: string;
  adapterContractVersion: number;
  /** Resolve only the immutable catalog's exact transformed server/tool forward mapping. */
  resolveSkill?(
    lineage: ActivityLineage,
    skillRoute: string,
  ): ResourceIdentity | null;
  /** Full model-context body digest, distinct from the immutable package identity. */
  resolveSkillBodyDigest?(
    lineage: ActivityLineage,
    skillRoute: string,
  ): string | null;
  automaticSkillContextQualified?: boolean;
  resolveHostTool?(
    lineage: ActivityLineage,
    serverName: string,
    toolName: string,
  ): string | null;
  resolveTool(
    lineage: ActivityLineage,
    serverName: string,
    toolName: string,
  ): ResourceIdentity | null;
}
export interface ResourceActivityEvidenceDependencies {
  repository: ResourceActivityRepository;
  keyVersion: number;
  evidenceKey: Uint8Array;
  previousKeys?: Readonly<Record<number, Uint8Array>>;
  providerContracts: readonly ProviderEvidenceContract[];
  quarantine(lineage: ActivityLineage): void;
  cancelOwnedInvocation?(
    lineage: ActivityLineage,
    invocationId: string,
  ): Promise<boolean>;
  cancellationTimeoutMs?: number;
  onChanged?(event: SessionResourceActivityChangedEvent): void;
  now?(): Date;
}
export type ProviderCapabilityObservation = {
  lineage: ActivityLineage;
  providerContract: string;
  sourceIdentity: string;
  requestIdentity: string | null;
  routingIntegrity?: "verified" | "lease_mismatch";
  rawSessionId: string;
  serverName: string;
  toolName: string;
} & (
  | { type: "request" }
  | { type: "pre_entry_failure"; outcome: "rejected" | "permission_denied" }
  | { type: "terminal"; receipt: CapabilityReceipt }
);

export type ProviderSkillObservation = {
  lineage: ActivityLineage;
  providerContract: string;
  rawSessionId: string;
  requestIdentity: string | null;
  sourceIdentity: string;
  skillRoute: string;
  mode: "explicit" | "automatic" | "unknown";
} & (
  | { type: "request" }
  | { type: "failed" }
  | {
      type: "context";
      receiptIdentity: string;
      bodyDigest: string;
      completeBody: boolean;
    }
);

const rawIdentitySchema = z.string().min(1).max(1024);
const providerBase = z.object({
  lineage: activityLineageSchema,
  providerContract: z.string().min(1).max(128),
  sourceIdentity: rawIdentitySchema,
  requestIdentity: rawIdentitySchema.nullable(),
  rawSessionId: rawIdentitySchema,
});
const capabilityBase = providerBase.extend({
  serverName: z.string().min(1).max(256),
  toolName: z.string().min(1).max(256),
  routingIntegrity: z.enum(["verified", "lease_mismatch"]).optional(),
});
const providerCapabilitySchema = z.discriminatedUnion("type", [
  capabilityBase.extend({ type: z.literal("request") }).strict(),
  capabilityBase
    .extend({ type: z.literal("terminal"), receipt: capabilityReceiptSchema })
    .strict(),
  capabilityBase
    .extend({
      type: z.literal("pre_entry_failure"),
      outcome: z.enum(["rejected", "permission_denied"]),
    })
    .strict(),
]);
const skillBase = providerBase.extend({
  skillRoute: z.string().min(1).max(256),
  mode: z.enum(["explicit", "automatic", "unknown"]),
});
const providerSkillSchema = z.discriminatedUnion("type", [
  skillBase.extend({ type: z.literal("request") }).strict(),
  skillBase.extend({ type: z.literal("failed") }).strict(),
  skillBase
    .extend({
      type: z.literal("context"),
      receiptIdentity: rawIdentitySchema,
      bodyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      completeBody: z.boolean(),
    })
    .strict(),
]);

/** The only production writer of new Resource activity. Raw identities live only at this backend boundary. */
export class ResourceActivityEvidenceService {
  private readonly retentionTimer: ReturnType<typeof setInterval>;
  private readonly pendingProvider = new Map<
    string,
    ProviderCapabilityObservation
  >();
  private readonly active = new Map<
    string,
    { lineage: ActivityLineage; routeKey: string | null }
  >();
  private readonly cancellationWaiters = new Map<
    string,
    (outcome: CapabilityReceipt["outcome"]) => void
  >();
  private readonly keys = new Map<number, Buffer>();
  private readonly now: () => Date;
  constructor(
    private readonly dependencies: ResourceActivityEvidenceDependencies,
  ) {
    if (
      !Number.isSafeInteger(dependencies.keyVersion) ||
      dependencies.keyVersion < 1 ||
      dependencies.evidenceKey.byteLength < 32
    )
      throw new Error("Resource evidence key unavailable.");
    this.keys.set(
      dependencies.keyVersion,
      Buffer.from(dependencies.evidenceKey),
    );
    for (const [version, key] of Object.entries(
      dependencies.previousKeys ?? {},
    )) {
      if (
        !Number.isSafeInteger(Number(version)) ||
        Number(version) < 1 ||
        Number(version) === dependencies.keyVersion ||
        key.byteLength < 32
      )
        throw new Error("Invalid previous resource evidence key.");
      this.keys.set(Number(version), Buffer.from(key));
    }
    this.now = dependencies.now ?? (() => new Date());
    this.retentionTimer = setInterval(
      () => {
        try {
          this.pruneRetention();
        } catch {
          console.error("resource_activity_retention_failed");
        }
      },
      24 * 60 * 60 * 1000,
    );
    this.retentionTimer.unref();
  }
  registerSessionRoute(
    rawLineage: ActivityLineage,
    rawSessionId: string,
    runId: string,
  ): void {
    const lineage = activityLineageSchema.parse(rawLineage);
    if (!this.dependencies.repository.isAttested(lineage))
      throw new Error("Unattested activity session route.");
    const routeKey = this.sessionKey(lineage, rawSessionId);
    const existing = this.dependencies.repository.getSessionRoute(routeKey);
    if (existing) {
      if (
        existing.runId === runId &&
        existing.assignmentGenerationId === lineage.assignmentGenerationId &&
        existing.catalogGenerationId === lineage.catalogGenerationId &&
        existing.adapterContractVersion === lineage.adapterContractVersion
      )
        return;
      this.dependencies.quarantine(lineage);
      throw new Error("Conflicting activity session route.");
    }
    this.dependencies.repository.registerSessionRoute({
      routeKey,
      runId,
      worktreeId: lineage.worktreeId,
      provider: lineage.provider,
      providerVersion: lineage.providerVersion,
      adapterContractVersion: lineage.adapterContractVersion,
      runtimeGenerationId: lineage.runtimeGenerationId,
      assignmentGenerationId: lineage.assignmentGenerationId,
      catalogGenerationId: lineage.catalogGenerationId,
      registeredAt: this.now(),
      retiredAt: null,
    });
  }
  ingestHost(input: {
    lineage: ActivityLineage;
    identity: ResourceIdentity;
    observation: CapabilityHostObservation;
  }) {
    const lineage = activityLineageSchema.parse(input.lineage);
    const identity = activityResourceIdentitySchema.parse(input.identity);
    const event = capabilityHostObservationSchema.parse(input.observation);
    if (
      identity.resourceKind !== "capability" ||
      identity.resourceId !== event.capabilityId ||
      identity.resourceVersion !== event.capabilityVersion
    )
      return this.reject(lineage, "security_conflict", event.invocationId);
    const correlationKey = this.correlationKey(lineage, event.invocationId);
    const anchoredOutcome =
      event.type === "outcome" &&
      this.dependencies.repository.hasEvidenceKey(
        "correlation",
        correlationKey,
      );
    if (
      !this.dependencies.repository.isAttested(lineage, anchoredOutcome) ||
      !this.dependencies.repository.containsResource(lineage, identity)
    )
      return this.reject(lineage, "evidence_gap", event.invocationId);
    const base = this.base(
      lineage,
      identity,
      `host-${event.type}`,
      event.invocationId,
      "capability-host/v1",
    );
    const observation: ResourceActivityObservation =
      event.type === "entered"
        ? {
            ...base,
            type: "capability_host_entered",
            activityId: randomUUID(),
            correlationKey,
          }
        : {
            ...base,
            type: "capability_host_outcome",
            correlationKey,
            outcome: event.outcome,
          };
    const result = this.apply(observation, undefined, event.toolName);
    if (event.type === "entered" && result.disposition === "applied")
      this.active.set(correlationKey, { lineage, routeKey: null });
    if (event.type === "outcome") {
      this.active.delete(correlationKey);
      this.cancellationWaiters.get(correlationKey)?.(event.outcome);
      for (const [key, pending] of this.pendingProvider) {
        if (
          pending.type === "terminal" &&
          pending.lineage.runtimeGenerationId === lineage.runtimeGenerationId &&
          pending.lineage.worktreeId === lineage.worktreeId &&
          pending.receipt.invocationId === event.invocationId
        ) {
          this.pendingProvider.delete(key);
          const paired = this.ingestProvider(pending);
          result.events.push(...paired.events);
        }
      }
    }
    return result;
  }
  registerInvocationDispatch(
    rawLineage: ActivityLineage,
    rawSessionId: string,
    invocationId: string,
    providerContract: string,
  ): void {
    const lineage = activityLineageSchema.parse(rawLineage);
    const active = this.active.get(this.correlationKey(lineage, invocationId));
    const routeKey = this.sessionKey(lineage, rawSessionId);
    const route = this.dependencies.repository.getSessionRoute(routeKey);
    const qualified = this.dependencies.providerContracts.some(
      (contract) =>
        contract.name === providerContract &&
        contract.provider === lineage.provider &&
        contract.providerVersion === lineage.providerVersion &&
        contract.adapterContractVersion === lineage.adapterContractVersion,
    );
    if (
      !active ||
      !route ||
      !qualified ||
      route.catalogGenerationId !== lineage.catalogGenerationId ||
      route.assignmentGenerationId !== lineage.assignmentGenerationId ||
      !this.dependencies.repository.isAttested(lineage) ||
      (active.routeKey && active.routeKey !== routeKey)
    ) {
      this.dependencies.quarantine(lineage);
      throw new Error("Capability cancellation ownership conflict.");
    }
    active.routeKey = routeKey;
  }
  async cancelInvocation(
    rawLineage: ActivityLineage,
    rawSessionId: string,
    invocationId: string,
  ): Promise<"cancelled"> {
    const lineage = activityLineageSchema.parse(rawLineage);
    const key = this.correlationKey(lineage, invocationId);
    const active = this.active.get(key);
    if (
      !active ||
      JSON.stringify(active.lineage) !== JSON.stringify(lineage) ||
      active.routeKey !== this.sessionKey(lineage, rawSessionId) ||
      this.cancellationWaiters.has(key)
    ) {
      this.dependencies.quarantine(lineage);
      throw new Error("Capability cancellation ownership is not exact.");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const terminal = new Promise<CapabilityReceipt["outcome"]>((resolve) =>
      this.cancellationWaiters.set(key, resolve),
    );
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "Capability cancellation acknowledgement or outcome missing.",
            ),
          ),
        this.dependencies.cancellationTimeoutMs ?? 10_000,
      );
    });
    try {
      if (
        !(await Promise.race([
          this.dependencies.cancelOwnedInvocation?.(lineage, invocationId) ??
            Promise.resolve(false),
          deadline,
        ]))
      )
        throw new Error("Capability cancellation acknowledgement missing.");
      if ((await Promise.race([terminal, deadline])) !== "cancelled")
        throw new Error("Capability cancellation was not confirmed.");
      return "cancelled";
    } catch (error) {
      this.dependencies.quarantine(lineage);
      throw error;
    } finally {
      clearTimeout(timer);
      this.cancellationWaiters.delete(key);
    }
  }
  ingestProvider(raw: ProviderCapabilityObservation) {
    const lineage = activityLineageSchema.parse(raw.lineage);
    const parsed = providerCapabilitySchema.safeParse(raw);
    if (!parsed.success)
      return this.reject(
        lineage,
        "format_drift",
        typeof raw.sourceIdentity === "string"
          ? raw.sourceIdentity
          : "invalid-provider-observation",
      );
    const input = parsed.data;
    const contract = this.dependencies.providerContracts.find(
      (value) =>
        value.name === input.providerContract &&
        value.provider === lineage.provider &&
        value.providerVersion === lineage.providerVersion &&
        value.adapterContractVersion === lineage.adapterContractVersion,
    );
    if (!contract)
      return this.reject(lineage, "provider_unqualified", input.sourceIdentity);
    const identity = contract.resolveTool(
      lineage,
      input.serverName,
      input.toolName,
    );
    if (
      !identity ||
      !this.dependencies.repository.containsResource(
        lineage,
        activityResourceIdentitySchema.parse(identity),
      )
    )
      return this.reject(lineage, "security_conflict", input.sourceIdentity);
    if (!this.dependencies.repository.isAttested(lineage, true))
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    const route = this.dependencies.repository.getSessionRoute(
      this.sessionKey(lineage, input.rawSessionId),
    );
    if (
      !route ||
      route.catalogGenerationId !== lineage.catalogGenerationId ||
      route.assignmentGenerationId !== lineage.assignmentGenerationId ||
      route.adapterContractVersion !== lineage.adapterContractVersion
    )
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    const requestKey = input.requestIdentity
      ? this.retainedDigest("request", [
          lineage.provider,
          lineage.providerVersion,
          String(lineage.adapterContractVersion),
          lineage.worktreeId,
          lineage.runtimeGenerationId,
          input.requestIdentity,
        ])
      : null;
    const base = this.base(
      lineage,
      identity,
      input.type,
      input.sourceIdentity,
      contract.name,
    );
    if (input.type === "request") {
      if (
        !requestKey ||
        (!this.dependencies.repository.isAttested(lineage) &&
          !this.dependencies.repository.hasEvidenceKey("request", requestKey))
      )
        return this.reject(lineage, "evidence_gap", input.sourceIdentity);
      return this.apply({
        ...base,
        type: "provider_request",
        activityId: randomUUID(),
        requestKey,
        runId: route.runId,
        mode: "explicit",
      });
    }
    if (input.type === "pre_entry_failure") {
      if (!requestKey)
        return this.reject(lineage, "evidence_gap", input.sourceIdentity);
      return this.apply({
        ...base,
        type: "pre_entry_outcome",
        requestKey,
        outcome: input.outcome,
      });
    }
    const receipt = capabilityReceiptSchema.safeParse(input.receipt);
    if (!receipt.success)
      return this.reject(lineage, "format_drift", input.sourceIdentity);
    const hostBase = this.base(
      lineage,
      identity,
      "host-entered",
      receipt.data.invocationId,
      "capability-host/v1",
    );
    const hostEntry: ResourceActivityObservation = {
      ...hostBase,
      type: "capability_host_entered",
      activityId: "unused",
      correlationKey: this.correlationKey(lineage, receipt.data.invocationId),
    };
    const hostDigest = this.dependencies.repository.getCanonicalDigest(
      "capability_host.entered",
      hostEntry.sourceEventKey,
    );
    if (
      !hostDigest &&
      this.dependencies.repository.hasEvidenceKey(
        "correlation",
        hostEntry.correlationKey,
      )
    )
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    const hostToolName = contract.resolveHostTool
      ? contract.resolveHostTool(lineage, input.serverName, input.toolName)
      : input.toolName;
    if (!hostToolName)
      return this.reject(lineage, "security_conflict", input.sourceIdentity);
    if (
      hostDigest &&
      hostDigest !== this.canonicalDigest(hostEntry, undefined, hostToolName)
    )
      return this.reject(lineage, "security_conflict", input.sourceIdentity);
    const result = this.apply(
      {
        ...base,
        type: "provider_capability_receipt",
        requestKey,
        correlationKey: this.correlationKey(lineage, receipt.data.invocationId),
        runId: route.runId,
        mode: "explicit",
        routingIntegrity: input.routingIntegrity ?? "verified",
      },
      receipt.data.outcome,
    );
    if (
      result.disposition === "unmatched" &&
      this.dependencies.repository.isAttested(lineage)
    ) {
      const pending = this.pendingProvider.get(base.sourceEventKey);
      if (pending && canonicalJson(pending) !== canonicalJson(input))
        return this.reject(lineage, "security_conflict", input.sourceIdentity);
      if (!pending && this.pendingProvider.size >= 1000)
        return this.reject(lineage, "evidence_gap", input.sourceIdentity);
      this.pendingProvider.set(base.sourceEventKey, structuredClone(input));
    }
    return result;
  }
  ingestSkill(raw: ProviderSkillObservation) {
    const lineage = activityLineageSchema.parse(raw.lineage);
    const parsed = providerSkillSchema.safeParse(raw);
    if (!parsed.success)
      return this.reject(
        lineage,
        "format_drift",
        typeof raw.sourceIdentity === "string"
          ? raw.sourceIdentity
          : "invalid-provider-observation",
      );
    const input = parsed.data;
    const contract = this.dependencies.providerContracts.find(
      (value) =>
        value.name === input.providerContract &&
        value.provider === lineage.provider &&
        value.providerVersion === lineage.providerVersion &&
        value.adapterContractVersion === lineage.adapterContractVersion,
    );
    if (!contract)
      return this.reject(lineage, "provider_unqualified", input.sourceIdentity);
    const identity = contract.resolveSkill?.(lineage, input.skillRoute);
    if (
      !identity ||
      identity.resourceKind !== "skill" ||
      !this.dependencies.repository.containsResource(lineage, identity)
    )
      return this.reject(lineage, "security_conflict", input.sourceIdentity);
    const route = this.dependencies.repository.getSessionRoute(
      this.sessionKey(lineage, input.rawSessionId),
    );
    if (
      !route ||
      route.assignmentGenerationId !== lineage.assignmentGenerationId ||
      route.catalogGenerationId !== lineage.catalogGenerationId ||
      route.adapterContractVersion !== lineage.adapterContractVersion
    )
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    const requestKey = input.requestIdentity
      ? this.retainedDigest("request", [
          lineage.provider,
          lineage.providerVersion,
          String(lineage.adapterContractVersion),
          lineage.worktreeId,
          lineage.runtimeGenerationId,
          input.requestIdentity,
        ])
      : null;
    const live = this.dependencies.repository.isAttested(lineage);
    if (
      !live &&
      (!this.dependencies.repository.isAttested(lineage, true) ||
        !requestKey ||
        !this.dependencies.repository.hasEvidenceKey("request", requestKey))
    )
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    const base = this.base(
      lineage,
      identity,
      `skill-${input.type}`,
      input.sourceIdentity,
      contract.name,
    );
    if (input.type === "request") {
      if (!requestKey)
        return this.reject(lineage, "evidence_gap", input.sourceIdentity);
      return this.apply({
        ...base,
        type: "provider_request",
        activityId: randomUUID(),
        requestKey,
        runId: route.runId,
        mode: input.mode,
      });
    }
    if (input.type === "failed") {
      if (!requestKey)
        return this.reject(lineage, "evidence_gap", input.sourceIdentity);
      return this.apply({
        ...base,
        type: "pre_entry_outcome",
        requestKey,
        outcome: "load_failed",
      });
    }
    const expectedBodyDigest = contract.resolveSkillBodyDigest
      ? contract.resolveSkillBodyDigest(lineage, input.skillRoute)
      : identity.resourceDigest;
    if (!input.completeBody || input.bodyDigest !== expectedBodyDigest)
      return this.reject(lineage, "evidence_gap", input.sourceIdentity);
    if (input.mode === "automatic" && !contract.automaticSkillContextQualified)
      return this.reject(lineage, "provider_unqualified", input.sourceIdentity);
    const correlationKey = this.retainedDigest("correlation", [
      lineage.worktreeId,
      lineage.runtimeGenerationId,
      "skill",
      input.receiptIdentity,
    ]);
    return this.apply({
      ...base,
      type: "skill_context_receipt",
      activityId: randomUUID(),
      requestKey,
      correlationKey,
      runId: route.runId,
      mode: input.mode,
      routingIntegrity: "verified",
    });
  }
  dispose(): void {
    clearInterval(this.retentionTimer);
    this.pendingProvider.clear();
    this.active.clear();
    for (const resolve of this.cancellationWaiters.values()) resolve("thrown");
    this.cancellationWaiters.clear();
    for (const key of this.keys.values()) key.fill(0);
    this.keys.clear();
  }
  getSnapshot(runId: string) {
    return this.dependencies.repository.getSnapshot(runId);
  }
  retireRuntime(lineage: ActivityLineage) {
    const snapshot = activityLineageSchema.parse(lineage);
    const events = this.dependencies.repository.retireRuntime(
      snapshot,
      this.now(),
    );
    for (const [key, active] of this.active)
      if (
        active.lineage.worktreeId === snapshot.worktreeId &&
        active.lineage.provider === snapshot.provider &&
        active.lineage.runtimeGenerationId === snapshot.runtimeGenerationId
      )
        this.active.delete(key);
    for (const [key, pending] of this.pendingProvider)
      if (
        pending.lineage.worktreeId === snapshot.worktreeId &&
        pending.lineage.provider === snapshot.provider &&
        pending.lineage.runtimeGenerationId === snapshot.runtimeGenerationId
      )
        this.pendingProvider.delete(key);
    this.publish(events);
    return events;
  }
  resolveCoverage(lineage: ActivityLineage): void {
    this.dependencies.repository.resolveCoverage(
      activityLineageSchema.parse(lineage),
      this.now(),
    );
  }
  pruneRetention() {
    return this.dependencies.repository.pruneRetention(this.now());
  }
  private canonicalDigest(
    observation: ResourceActivityObservation,
    providerOutcome?: CapabilityReceipt["outcome"],
    hostToolName?: string,
  ): string {
    const fields = Object.fromEntries(
      Object.entries(observation).filter(
        ([key]) => !["evidenceId", "observedAt", "activityId"].includes(key),
      ),
    );
    const version = Number(observation.sourceEventKey.split(":")[1].slice(1));
    return this.digest(
      "canonical",
      [canonicalJson({ ...fields, providerOutcome, hostToolName })],
      version,
    );
  }
  private apply(
    observation: ResourceActivityObservation,
    providerOutcome?: CapabilityReceipt["outcome"],
    hostToolName?: string,
  ) {
    const digest = this.canonicalDigest(
      observation,
      providerOutcome,
      hostToolName,
    );
    const result = this.dependencies.repository.applyObservation(
      observation,
      digest,
      providerOutcome,
    );
    if (result.quarantine) this.dependencies.quarantine(observation.lineage);
    this.publish(result.events);
    return { disposition: result.disposition, events: result.events };
  }
  private publish(
    events: readonly SessionResourceActivityChangedEvent[],
  ): void {
    for (const event of events) {
      try {
        this.dependencies.onChanged?.(event);
      } catch {
        console.error("resource_activity_delivery_failed");
      }
    }
  }
  private base(
    lineage: ActivityLineage,
    identity: ResourceIdentity,
    kind: string,
    rawIdentity: string,
    providerContract: string,
  ) {
    return {
      lineage,
      identity,
      evidenceId: randomUUID(),
      providerContract,
      observedAt: this.now(),
      sourceEventKey: this.retainedDigest("source", [
        kind,
        lineage.provider,
        lineage.providerVersion,
        String(lineage.adapterContractVersion),
        lineage.worktreeId,
        lineage.runtimeGenerationId,
        rawIdentity,
      ]),
    };
  }
  private correlationKey(lineage: ActivityLineage, receipt: string) {
    return this.retainedDigest("correlation", [
      lineage.worktreeId,
      lineage.runtimeGenerationId,
      "capability",
      receipt,
    ]);
  }
  private sessionKey(lineage: ActivityLineage, session: string) {
    const fields = [
      lineage.provider,
      lineage.providerVersion,
      lineage.worktreeId,
      lineage.runtimeGenerationId,
      session,
    ];
    for (const version of this.keys.keys()) {
      const key = this.digest("session-route", fields, version);
      if (this.dependencies.repository.getSessionRoute(key)) return key;
    }
    return this.digest("session-route", fields);
  }
  private retainedDigest(
    domain: "source" | "request" | "correlation",
    values: readonly string[],
  ): string {
    for (const version of this.keys.keys()) {
      const key = this.digest(domain, values, version);
      if (this.dependencies.repository.hasEvidenceKey(domain, key)) return key;
    }
    return this.digest(domain, values);
  }
  private digest(
    domain: string,
    values: readonly string[],
    version = this.dependencies.keyVersion,
  ): string {
    const key = this.keys.get(version);
    if (!key) throw new Error("Resource evidence key unavailable.");
    const mac = createHmac("sha256", key);
    for (const value of [`aw-resource-evidence/${domain}/v1`, ...values]) {
      const bytes = Buffer.from(value, "utf8");
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      mac.update(length);
      mac.update(bytes);
    }
    return `hmac:v${version}:${mac.digest("hex")}`;
  }
  private reject(
    lineage: ActivityLineage,
    kind:
      | "evidence_gap"
      | "security_conflict"
      | "provider_unqualified"
      | "format_drift",
    source: string,
  ) {
    this.dependencies.repository.recordCoverage({
      id: this.digest("coverage-id", [
        kind,
        lineage.provider,
        lineage.providerVersion,
        lineage.worktreeId,
        lineage.runtimeGenerationId,
        source,
      ]),
      worktreeId: lineage.worktreeId,
      provider: lineage.provider,
      providerVersion: lineage.providerVersion,
      adapterContractVersion: lineage.adapterContractVersion,
      runtimeGenerationId: lineage.runtimeGenerationId,
      assignmentGenerationId: this.dependencies.repository.isAttested(
        lineage,
        true,
      )
        ? lineage.assignmentGenerationId
        : null,
      catalogGenerationId: this.dependencies.repository.isAttested(
        lineage,
        true,
      )
        ? lineage.catalogGenerationId
        : null,
      sourceEventKey: this.digest("coverage", [
        kind,
        lineage.provider,
        lineage.providerVersion,
        lineage.worktreeId,
        lineage.runtimeGenerationId,
        source,
      ]),
      kind,
      observedAt: this.now(),
      resolvedAt: null,
    });
    if (kind === "security_conflict") this.dependencies.quarantine(lineage);
    return { disposition: "stale_rejected" as const, events: [] };
  }
}

function canonicalJson(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sorted(child)]),
      );
    return item;
  };
  return JSON.stringify(sorted(value));
}
