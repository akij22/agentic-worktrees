import { randomUUID } from "node:crypto";
import type { CodingAgentKind } from "./types";

export interface OwnedWorktreeRuntime {
  readonly agentKind: CodingAgentKind;
  readonly worktreeId: string;
  readonly generation: string;
  readonly providerVersion: string;
  stop(gracePeriodMs: number): Promise<void>;
  cancelOwnedWork?(): Promise<void>;
}

export interface WorktreeRuntimeFactory {
  create(input: {
    agentKind: CodingAgentKind;
    worktreeId: string;
    generation: string;
    namespaceId: string;
  }): Promise<OwnedWorktreeRuntime>;
}

export interface RuntimeAttestationVerifier {
  verify(input: RuntimeAttestationIdentity): Promise<boolean>;
  invalidate?(input: Pick<RuntimeAttestationIdentity, "worktreeId" | "agentKind" | "runtimeGeneration">): void;
}

export interface RuntimeAttestationIdentity {
  agentKind: CodingAgentKind;
  worktreeId: string;
  runtimeGeneration: string;
  providerVersion: string;
  assignmentGenerationId: string;
  catalogGenerationId: string;
}

export interface WorktreeRuntimeLease {
  readonly runtime: OwnedWorktreeRuntime;
  release(): void;
}

export interface WorktreeAdmissionLease {
  release(): void;
}

export type WorktreeAdmissionLane = "normal" | "exclusive" | "control";

export class WorktreeRuntimeStartupError extends Error {
  constructor(cause: unknown, readonly cleanupVerified: boolean) { super(cleanupVerified ? "Owned runtime activation failed." : "Owned runtime activation cleanup could not be verified.", { cause }); }
}

export interface AssignmentRuntimeReplacement {
  readonly generation: string;
  readonly namespaceId: string;
  stage(): Promise<OwnedWorktreeRuntime>;
  activate(): Promise<void>;
  rollback(): Promise<void>;
  discard(): Promise<void>;
  finalize(): Promise<void>;
}
interface ReplacementEntry {
  prior: RuntimeEntry;
  candidate?: RuntimeEntry;
  generation: string;
  staging?: Promise<OwnedWorktreeRuntime>;
  failed: boolean;
  cleanupVerified: boolean;
}

interface RuntimeEntry {
  runtime: OwnedWorktreeRuntime;
  leaseCount: number;
  lastReleasedAt: number;
  turnActive: boolean;
  turnWaiters: Array<{ resolve(release: () => void): void; reject(error: Error): void }>;
  quarantineReason: string | null;
  stopping?: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface WorktreeRuntimeManagerOptions {
  factory: WorktreeRuntimeFactory;
  attestationVerifier?: RuntimeAttestationVerifier;
  isPersistedSessionRoute?(route: Pick<SessionRoute,"agentKind"|"worktreeId"|"runId"|"externalSessionId">): boolean;
  now?: () => number;
  maximumRuntimes?: number;
  maximumRuntimesPerProvider?: number;
  shutdownGracePeriodMs?: number;
  idleTimeoutMs?: number;
  onRuntimeInvalidated?: (input: {
    agentKind: CodingAgentKind;
    worktreeId: string;
    runtimeGeneration: string;
    reason: string;
  }) => void;
}

interface SessionRoute {
  agentKind: CodingAgentKind;
  worktreeId: string;
  runId: string;
  externalSessionId: string;
  runtimeGeneration: string;
  assignmentGenerationId: string;
  catalogGenerationId: string;
}

type ProviderSessionAdmission = {
  signal?: AbortSignal;
  agentKind: CodingAgentKind;
  worktreeId: string;
  runId: string;
  operation: "create" | "resume" | "turn";
  externalSessionId?: string;
  assignmentGenerationId: string;
  catalogGenerationId: string;
};

interface CapacityWaiter {
  agentKind: CodingAgentKind;
  resolve(): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface AdmissionWaiter {
  lane: Exclude<WorktreeAdmissionLane, "control">;
  resolve(lease: WorktreeAdmissionLease): void;
  reject(error: Error): void;
}

interface AdmissionGate {
  readers: number;
  writer: boolean;
  queue: AdmissionWaiter[];
}

const runtimeKey = (agentKind: CodingAgentKind, worktreeId: string): string =>
  `${agentKind}\0${worktreeId}`;

export class WorktreeRuntimeManager {
  private readonly replacements = new Map<string, ReplacementEntry>();
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly startControllers = new Map<string, AbortController>();
  private readonly acquiring = new Map<string, number>();
  private readonly starts = new Map<string, Promise<RuntimeEntry>>();
  private readonly generationByKey = new Map<string, number>();
  private readonly capacityWaiters: CapacityWaiter[] = [];
  private readonly admissionGates = new Map<string, AdmissionGate>();
  private readonly sessionRoutes = new Map<string, SessionRoute>();
  private readonly removingWorktrees = new Set<string>();
  private readonly removedWorktrees = new Set<string>();
  private readonly now: () => number;
  private readonly maximumRuntimes: number;
  private readonly maximumRuntimesPerProvider: number;
  private readonly shutdownGracePeriodMs: number;
  private readonly idleTimeoutMs: number;
  private readonly generationEpoch = randomUUID();
  private reservedStarts = 0;
  private readonly reservedStartsByProvider = new Map<CodingAgentKind, number>();
  private pumpingCapacity = false;
  private shuttingDown = false;

  constructor(private readonly options: WorktreeRuntimeManagerOptions) {
    this.now = options.now ?? Date.now;
    this.maximumRuntimes = options.maximumRuntimes ?? 4;
    this.maximumRuntimesPerProvider = options.maximumRuntimesPerProvider ?? 4;
    this.shutdownGracePeriodMs = options.shutdownGracePeriodMs ?? 5_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    if (!Number.isInteger(this.maximumRuntimes) || this.maximumRuntimes < 1) {
      throw new Error("Runtime capacity must be a positive integer.");
    }
    if (!Number.isInteger(this.maximumRuntimesPerProvider)
      || this.maximumRuntimesPerProvider < 1) {
      throw new Error("Per-provider runtime capacity must be a positive integer.");
    }
  }

  async acquireRuntime(
    agentKind: CodingAgentKind,
    worktreeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorktreeRuntimeLease> {
    if (options.signal?.aborted) throw new Error("Runtime admission was cancelled.");
    if (this.shuttingDown) throw new Error("Runtime manager is shutting down.");
    if (this.removedWorktrees.has(worktreeId) || this.removingWorktrees.has(worktreeId)) throw new Error("Worktree runtime ownership was removed.");
    const key = runtimeKey(agentKind, worktreeId);
    const stopping = this.runtimes.get(key)?.stopping;
    if (stopping) {
      await this.abortable(stopping, options.signal);
      return this.acquireRuntime(agentKind, worktreeId, options);
    }
    this.acquiring.set(key, (this.acquiring.get(key) ?? 0) + 1);
    let entry: RuntimeEntry;
    try {
      const existing = this.runtimes.get(key);
      entry = existing ?? await this.abortable(this.starts.get(key)
        ?? this.startRuntime(key, agentKind, worktreeId), options.signal);
      if (this.shuttingDown) throw new Error("Runtime manager is shutting down.");
      if (this.removedWorktrees.has(worktreeId) || this.removingWorktrees.has(worktreeId)) throw new Error("Worktree runtime ownership was removed.");
      if (entry.quarantineReason) throw new Error("Worktree runtime is quarantined.");
      clearTimeout(entry.idleTimer);
      entry.leaseCount += 1;
    } finally {
      const remaining = (this.acquiring.get(key) ?? 1) - 1;
      if (remaining) this.acquiring.set(key, remaining);
      else {
        this.acquiring.delete(key);
        this.startControllers.get(key)?.abort();
      }
    }
    let released = false;
    return {
      runtime: entry.runtime,
      release: () => {
        if (released) return;
        released = true;
        entry.leaseCount -= 1;
        entry.lastReleasedAt = this.now();
        this.scheduleIdle(key, entry);
        void this.pumpCapacity();
      },
    };
  }

  /** A lifecycle snapshot for Assignment coordination; never starts a runtime. */
  inspectWorktree(worktreeId: string): {
    runtimes: readonly OwnedWorktreeRuntime[];
    busy: boolean;
    fingerprint: string;
    blockers: readonly ("active_turn" | "queued_follow_up" | "runtime_transition")[];
  } {
    const entries = [...this.runtimes.entries()].filter(([, entry]) => entry.runtime.worktreeId === worktreeId);
    const runtimes = entries.map(([, entry]) => entry.runtime).sort((a, b) => a.agentKind.localeCompare(b.agentKind));
    const unresolvedReplacement = [...this.replacements.values()].some(entry => entry.prior.runtime.worktreeId === worktreeId && entry.failed && !entry.cleanupVerified && !entry.candidate);
    const busy = unresolvedReplacement || entries.some(([, entry]) => entry.turnActive || entry.turnWaiters.length > 0 || !!entry.stopping)
      || [...this.starts.keys(), ...this.acquiring.keys()].some(key => key.endsWith(`\0${worktreeId}`));
    const blockers = new Set<"active_turn" | "queued_follow_up" | "runtime_transition">();
    for (const [, entry] of entries) { if (entry.turnActive) blockers.add("active_turn"); if (entry.turnWaiters.length) blockers.add("queued_follow_up"); if (entry.stopping) blockers.add("runtime_transition"); }
    if (busy && blockers.size === 0 || (this.admissionGates.get(worktreeId)?.readers ?? 0) > 0 && blockers.size === 0) blockers.add("runtime_transition");
    return { runtimes, busy, blockers: [...blockers], fingerprint: JSON.stringify(entries.map(([key, entry]) => [key, entry.runtime.generation, entry.turnActive, entry.turnWaiters.length, !!entry.stopping, entry.quarantineReason]).sort()) };
  }

  async acquireControlRuntime(agentKind: CodingAgentKind, worktreeId: string,
    runtimeGeneration: string): Promise<WorktreeRuntimeLease> {
    const key = runtimeKey(agentKind, worktreeId);
    const entry = this.runtimes.get(key);
    if (!entry || entry.runtime.generation !== runtimeGeneration || entry.stopping || this.shuttingDown) {
      throw new Error("Control runtime generation is unavailable.");
    }
    clearTimeout(entry.idleTimer);
    entry.leaseCount += 1;
    let released = false;
    return { runtime: entry.runtime, release: () => {
      if (released) return;
      released = true;
      entry.leaseCount -= 1;
      entry.lastReleasedAt = this.now();
      this.scheduleIdle(key, entry);
      void this.pumpCapacity();
    } };
  }

  /** Retire an exact owned participant while the Assignment writer holds admission. */
  async retireAssignmentRuntime(agentKind: CodingAgentKind, worktreeId: string, runtimeGeneration: string): Promise<void> {
    if (!this.admissionGates.get(worktreeId)?.writer) throw new Error("Assignment retirement requires exclusive admission.");
    const key = runtimeKey(agentKind, worktreeId), entry = this.runtimes.get(key);
    if (!entry || entry.runtime.generation !== runtimeGeneration || entry.leaseCount || entry.turnActive) throw new Error("Assignment runtime cannot be safely retired.");
    await entry.runtime.cancelOwnedWork?.(); await this.stopEntry(key, entry);
    const replacement = this.replacements.get(key);
    if (replacement) {
      if (replacement.staging) await replacement.staging;
      for (const owned of [replacement.prior, replacement.candidate]) if (owned && owned !== entry) await this.stopEntry(key, owned);
      this.replacements.delete(key);
    }
  }

  async recoverAssignmentReplacements(worktreeId: string): Promise<void> {
    if (!this.admissionGates.get(worktreeId)?.writer) throw new Error("Replacement recovery requires exclusive admission.");
    for (const [key, replacement] of this.replacements) {
      if (replacement.prior.runtime.worktreeId !== worktreeId) continue;
      if (replacement.staging) { try { await replacement.staging; } catch (error) { if (!replacement.cleanupVerified && !replacement.candidate) throw error; } }
      for (const owned of [replacement.candidate, replacement.prior]) if (owned) { if (owned.leaseCount || owned.turnActive) throw new Error("Replacement recovery still has owned work."); await owned.runtime.cancelOwnedWork?.(); await this.stopEntry(key, owned); }
      this.replacements.delete(key);
    }
  }

  /** Reserve one temporary owned candidate for an existing slot; ordinary capacity stays closed. */
  reserveAssignmentReplacement(agentKind: CodingAgentKind, worktreeId: string, priorGeneration: string): AssignmentRuntimeReplacement {
    const key = runtimeKey(agentKind, worktreeId), prior = this.runtimes.get(key);
    const requireWriter = () => { if (!this.admissionGates.get(worktreeId)?.writer || this.shuttingDown) throw new Error("Replacement requires owned exclusive Assignment admission."); };
    requireWriter();
    if (!prior || prior.runtime.generation !== priorGeneration || prior.turnActive || prior.stopping || this.replacements.has(key)) throw new Error("Replacement prior generation is unavailable.");
    const ordinal = (this.generationByKey.get(key) ?? 0) + 1; this.generationByKey.set(key, ordinal);
    const generation = `${this.generationEpoch}:${agentKind}:${worktreeId}:${ordinal}`, namespaceId = randomUUID();
    const entry: ReplacementEntry = { prior, generation, failed: false, cleanupVerified: true }; this.replacements.set(key, entry);
    const stage = (): Promise<OwnedWorktreeRuntime> => {
      requireWriter(); if (entry.staging) return entry.staging;
      entry.staging = (async () => {
        // A replacement is bounded to one extra process per existing owned slot. It cannot
        // consume the rollback candidate or wait for its own ordinary capacity to free.
        this.reservedStarts += 1;
        this.reservedStartsByProvider.set(agentKind, (this.reservedStartsByProvider.get(agentKind) ?? 0) + 1);
        try {
          const runtime = await this.options.factory.create({ agentKind, worktreeId, generation, namespaceId });
          if (runtime.agentKind !== agentKind || runtime.worktreeId !== worktreeId || runtime.generation !== generation || runtime.providerVersion !== prior.runtime.providerVersion) throw new Error("Replacement factory ownership or version mismatch.");
          entry.candidate = { runtime, leaseCount: 0, lastReleasedAt: this.now(), turnActive: false, turnWaiters: [], quarantineReason: null };
          return runtime;
        } catch (error) { entry.failed = true; entry.cleanupVerified = error instanceof WorktreeRuntimeStartupError && error.cleanupVerified; throw error; }
        finally { this.reservedStarts -= 1; this.reservedStartsByProvider.set(agentKind, (this.reservedStartsByProvider.get(agentKind) ?? 1) - 1); }
      })(); return entry.staging;
    };
    const discard = async () => {
      if (entry.staging) { try { await entry.staging; } catch { entry.failed = true; } }
      const wasActive = this.runtimes.get(key) === entry.candidate;
      if (entry.candidate) await this.stopEntry(key, entry.candidate);
      else if (entry.failed && !entry.cleanupVerified) throw new Error("Replacement startup ownership could not be verified.");
      if (wasActive && !this.runtimes.has(key)) this.runtimes.set(key, prior);
      this.replacements.delete(key);
    };
    return { generation, namespaceId, stage,
      activate: async () => { requireWriter(); if (!entry.candidate || entry.failed || this.runtimes.get(key) !== prior) throw new Error("Replacement is not staged against its prior generation."); this.runtimes.set(key, entry.candidate); },
      rollback: async () => { requireWriter(); await discard(); if (this.runtimes.get(key) !== prior || prior.quarantineReason || prior.stopping) throw new Error("Replacement prior generation is no longer verified."); },
      discard: async () => { requireWriter(); if (!this.replacements.has(key)) return; if (this.runtimes.get(key) === entry.candidate) throw new Error("An active replacement requires rollback or finalization."); await discard(); },
      finalize: async () => { requireWriter(); if (!entry.candidate || this.runtimes.get(key) !== entry.candidate) throw new Error("Replacement cannot finalize before activation."); await this.stopEntry(key, prior); this.replacements.delete(key); },
    };
  }
  ownsAssignmentReplacement(agentKind: CodingAgentKind, worktreeId: string, priorGeneration: string, targetGeneration: string): boolean {
    const entry = this.replacements.get(runtimeKey(agentKind, worktreeId));
    return !!entry && !entry.failed && !entry.prior.quarantineReason && !entry.candidate?.quarantineReason && entry.prior.runtime.generation === priorGeneration && entry.generation === targetGeneration;
  }

  async recoverRuntime(agentKind: CodingAgentKind, worktreeId: string,
    runtimeGeneration: string): Promise<WorktreeRuntimeLease> {
    const key = runtimeKey(agentKind, worktreeId);
    const entry = this.runtimes.get(key);
    if (!entry || entry.runtime.generation !== runtimeGeneration || !entry.quarantineReason) {
      throw new Error("Recovery requires the exact quarantined runtime generation.");
    }
    await entry.runtime.cancelOwnedWork?.();
    const admission = await this.acquireAdmission(worktreeId, "exclusive");
    try {
      if (this.runtimes.get(key) !== entry || entry.leaseCount) {
        throw new Error("Runtime changed or still has an owned lease during recovery.");
      }
      await this.stopEntry(key, entry);
    } finally { admission.release(); }
    return this.acquireRuntime(agentKind, worktreeId);
  }

  async evictIdle(options: { memoryPressure?: boolean } = {}): Promise<Array<{
    agentKind: CodingAgentKind;
    worktreeId: string;
    runtimeGeneration: string;
  }>> {
    const cutoff = options.memoryPressure ? Infinity : this.now() - this.idleTimeoutMs;
    const candidates = [...this.runtimes.entries()]
      .filter(([key, entry]) => this.isIdle(key, entry) && entry.lastReleasedAt <= cutoff)
      .sort((left, right) => left[1].lastReleasedAt - right[1].lastReleasedAt);
    const evicted = [];
    for (const [key, entry] of options.memoryPressure ? candidates.slice(0, 1) : candidates) {
      if (this.runtimes.get(key) !== entry || !this.isIdle(key, entry)) continue;
      await this.stopEntry(key, entry);

      evicted.push({
        agentKind: entry.runtime.agentKind,
        worktreeId: entry.runtime.worktreeId,
        runtimeGeneration: entry.runtime.generation,
      });
    }
    void this.pumpCapacity();
    return evicted;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const waiter of this.capacityWaiters.splice(0)) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(new Error("Runtime manager is shutting down."));
    }
    for (const gate of this.admissionGates.values()) {
      for (const waiter of gate.queue.splice(0)) waiter.reject(new Error("Runtime manager is shutting down."));
    }
    await Promise.allSettled([...this.starts.values()]);
    const replacementErrors: unknown[] = [];
    for (const [key, replacement] of this.replacements) {
      if (replacement.staging) { try { await replacement.staging; } catch (error) { if (!replacement.cleanupVerified) replacementErrors.push(error); } }
      const owned = [replacement.prior, replacement.candidate].filter((entry): entry is RuntimeEntry => !!entry);
      for (const entry of owned) { try { await this.stopEntry(key, entry); } catch (error) { replacementErrors.push(error); } }
      if (!replacementErrors.length) this.replacements.delete(key);
    }
    const entries = [...this.runtimes.entries()];
    await this.stopEntries(entries);
    if (replacementErrors.length) throw new AggregateError(replacementErrors, "Replacement shutdown could not verify every owned process.");
    for (const [key, entry] of entries) {
      if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
    }
    this.sessionRoutes.clear();
  }

  async stopWorktree(worktreeId: string, remove?: () => Promise<void>): Promise<void> {
    if (this.removingWorktrees.has(worktreeId)) throw new Error("Worktree removal is already in progress.");
    this.removingWorktrees.add(worktreeId);
    let admission: WorktreeAdmissionLease | undefined;
    try {
      for (const kind of ["codex", "opencode"] as const) {
        this.startControllers.get(runtimeKey(kind, worktreeId))?.abort();
      }
      await Promise.all([...this.runtimes.values()]
        .filter((entry) => entry.runtime.worktreeId === worktreeId)
        .map((entry) => entry.runtime.cancelOwnedWork?.()));
      admission = await this.acquireAdmission(worktreeId, "exclusive");
      await Promise.allSettled((["codex", "opencode"] as const).map((kind) =>
        this.starts.get(runtimeKey(kind, worktreeId))));
      for (const [key, replacement] of this.replacements) {
        if (replacement.prior.runtime.worktreeId !== worktreeId) continue;
        if (replacement.staging) await replacement.staging;
        for (const owned of [replacement.prior, replacement.candidate]) if (owned) { if (owned.leaseCount) throw new Error("Replacement still holds an owned lease."); await this.stopEntry(key, owned); }
        this.replacements.delete(key);
      }
      const entries = [...this.runtimes.entries()].filter(
        ([, entry]) => entry.runtime.worktreeId === worktreeId,
      );
      if (entries.some(([, entry]) => entry.leaseCount !== 0)) {
        throw new Error("Worktree runtime still has an owned lease.");
      }
      await this.stopEntries(entries);
      for (const [key, entry] of entries) {
        if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
        this.deleteRoutesForRuntime(entry.runtime);
      }
      await remove?.();
      this.removedWorktrees.add(worktreeId);
      void this.pumpCapacity();
    } finally {
      this.removingWorktrees.delete(worktreeId);
      admission?.release();
    }
  }

  async acquireProviderSession(
    input: ProviderSessionAdmission,
  ): Promise<WorktreeRuntimeLease> {
    let admission: WorktreeAdmissionLease | null = null;
    let runtimeLease: WorktreeRuntimeLease | null = null;
    let releaseTurn: (() => void) | null = null;
    try {
      runtimeLease = await this.acquireRuntime(input.agentKind, input.worktreeId, { signal: input.signal });
      const readyRuntime = runtimeLease.runtime;
      runtimeLease.release();
      runtimeLease = null;
      admission = await this.acquireAdmission(input.worktreeId, "normal", { signal: input.signal });
      if (this.runtimes.get(runtimeKey(input.agentKind, input.worktreeId))?.runtime !== readyRuntime) {
        throw new Error("Runtime changed while waiting for Assignment admission.");
      }
      runtimeLease = await this.acquireRuntime(input.agentKind, input.worktreeId, { signal: input.signal });
      const runtimeEntry = this.runtimes.get(runtimeKey(input.agentKind, input.worktreeId));
      if (!runtimeEntry || runtimeEntry.runtime !== runtimeLease.runtime) {
        throw new Error("Runtime changed during provider admission.");
      }
      if (runtimeEntry.quarantineReason) {
        throw new Error("Worktree runtime is quarantined.");
      }
      const verified = await this.options.attestationVerifier?.verify({
        agentKind: input.agentKind,
        worktreeId: input.worktreeId,
        runtimeGeneration: runtimeLease.runtime.generation,
        providerVersion: runtimeLease.runtime.providerVersion,
        assignmentGenerationId: input.assignmentGenerationId,
        catalogGenerationId: input.catalogGenerationId,
      });
      if (!verified) throw new Error("Runtime Assignment attestation is unavailable.");
      if (input.operation !== "create") {
        if (!input.externalSessionId) throw new Error("Provider session route is required.");
        const exactRoute = { ...input, externalSessionId: input.externalSessionId, runtimeGeneration: runtimeLease.runtime.generation };
        let route = this.sessionRoutes.get(this.sessionRouteKey(exactRoute));
        if (!route && input.operation === "resume" && this.options.isPersistedSessionRoute?.(exactRoute)) {
          this.registerSessionRoute(exactRoute);
          route = this.sessionRoutes.get(this.sessionRouteKey(exactRoute));
        }
        if (!route
          || route.worktreeId !== input.worktreeId
          || route.runId !== input.runId
          || route.runtimeGeneration !== runtimeLease.runtime.generation
          || route.assignmentGenerationId !== input.assignmentGenerationId
          || route.catalogGenerationId !== input.catalogGenerationId) {
          throw new Error("Provider session route lineage mismatch.");
        }
      }
      if (input.operation === "turn") {
        const entry = this.runtimes.get(runtimeKey(input.agentKind, input.worktreeId));
        if (!entry || entry.runtime !== runtimeLease.runtime) {
          throw new Error("Runtime changed during turn admission.");
        }
        releaseTurn = await this.acquireTurn(entry, input.signal);
        if (!await this.options.attestationVerifier?.verify({
          agentKind: input.agentKind, worktreeId: input.worktreeId,
          runtimeGeneration: runtimeLease.runtime.generation,
          providerVersion: runtimeLease.runtime.providerVersion,
          assignmentGenerationId: input.assignmentGenerationId,
          catalogGenerationId: input.catalogGenerationId,
        })) throw new Error("Runtime Assignment attestation is unavailable.");
      }
      if (input.signal?.aborted) throw new Error("Runtime admission was cancelled.");
      if (this.runtimes.get(runtimeKey(input.agentKind, input.worktreeId)) !== runtimeEntry
        || runtimeEntry.quarantineReason || runtimeEntry.stopping || this.shuttingDown) {
        throw new Error("Runtime admission was invalidated.");
      }
      let released = false;
      return {
        runtime: runtimeLease.runtime,
        release: () => {
          if (released) return;
          released = true;
          releaseTurn?.();
          runtimeLease?.release();
          admission?.release();
        },
      };
    } catch (error) {
      releaseTurn?.();
      runtimeLease?.release();
      admission?.release();
      throw error;
    }
  }

  private acquireTurn(entry: RuntimeEntry, signal?: AbortSignal): Promise<() => void> {
    if (!entry.turnActive) {
      entry.turnActive = true;
      return Promise.resolve(this.turnRelease(entry));
    }
    return this.enqueueRequest<() => void>((waiter) => {
      entry.turnWaiters.push(waiter);
      return () => {
        const index = entry.turnWaiters.indexOf(waiter);
        if (index >= 0) entry.turnWaiters.splice(index, 1);
      };
    }, signal);
  }

  private turnRelease(entry: RuntimeEntry): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = entry.turnWaiters.shift();
      if (next) next.resolve(this.turnRelease(entry));
      else entry.turnActive = false;
    };
  }

  registerSessionRoute(route: SessionRoute): void {
    const key = runtimeKey(route.agentKind, route.worktreeId);
    const runtime = this.runtimes.get(key)?.runtime;
    if (!runtime || runtime.generation !== route.runtimeGeneration) {
      throw new Error("Provider session route runtime generation mismatch.");
    }
    const routeKey = this.sessionRouteKey(route);
    const current = this.sessionRoutes.get(routeKey);
    if (current && (current.runId !== route.runId
      || current.worktreeId !== route.worktreeId
      || current.runtimeGeneration !== route.runtimeGeneration
      || current.assignmentGenerationId !== route.assignmentGenerationId
      || current.catalogGenerationId !== route.catalogGenerationId)) {
      this.quarantineRuntime(route.agentKind, route.worktreeId, route.runtimeGeneration, "route_conflict");
      throw new Error("Provider session route conflicts with another app run.");
    }
    this.sessionRoutes.set(routeKey, { ...route });
  }

  quarantineRuntime(
    agentKind: CodingAgentKind,
    worktreeId: string,
    runtimeGeneration: string,
    reason: string,
  ): void {
    const entry = this.runtimes.get(runtimeKey(agentKind, worktreeId));
    if (!entry || entry.runtime.generation !== runtimeGeneration) {
      throw new Error("Cannot quarantine a stale runtime generation.");
    }
    entry.quarantineReason = reason;
    this.options.attestationVerifier?.invalidate?.({ agentKind, worktreeId, runtimeGeneration });
    this.rejectTurns(entry, "Runtime admission was invalidated by quarantine.");
  }

  reportRuntimeExit(
    agentKind: CodingAgentKind,
    worktreeId: string,
    runtimeGeneration: string,
  ): void {
    const key = runtimeKey(agentKind, worktreeId);
    const replacement = this.replacements.get(key);
    if (replacement?.prior.runtime.generation === runtimeGeneration) replacement.prior.quarantineReason = "process_exit";
    if (replacement?.generation === runtimeGeneration) { replacement.failed = true; if (replacement.candidate) replacement.candidate.quarantineReason = "process_exit"; }
    const entry = this.runtimes.get(key);
    if (!entry || entry.runtime.generation !== runtimeGeneration) return;
    clearTimeout(entry.idleTimer);
    this.rejectTurns(entry, "Runtime exited.");
    this.runtimes.delete(key);
    this.deleteRoutesForRuntime(entry.runtime);
    this.options.attestationVerifier?.invalidate?.({ agentKind, worktreeId, runtimeGeneration });
    this.options.onRuntimeInvalidated?.({
      agentKind,
      worktreeId,
      runtimeGeneration,
      reason: "process_exit",
    });
    void this.pumpCapacity();
  }

  private scheduleIdle(key: string, entry: RuntimeEntry): void {
    clearTimeout(entry.idleTimer);
    if (!this.isIdle(key, entry) || this.shuttingDown) return;
    entry.idleTimer = setTimeout(() => {
      void this.evictIdle().catch(() => console.error("worktree_runtime_idle_shutdown_failed"));
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private rejectTurns(entry: RuntimeEntry, message: string): void {
    for (const waiter of entry.turnWaiters.splice(0)) waiter.reject(new Error(message));
  }

  private isIdle(key: string, entry: RuntimeEntry): boolean {
    const gate = this.admissionGates.get(entry.runtime.worktreeId);
    return !entry.stopping && !this.acquiring.get(key) && entry.leaseCount === 0
      && !entry.turnActive && !gate?.writer && entry.quarantineReason !== "shutdown_failed";
  }

  private async stopEntries(entries: Array<[string, RuntimeEntry]>): Promise<void> {
    const results = await Promise.allSettled(entries.map(([key, entry]) => this.stopEntry(key, entry)));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason),
      "Runtime shutdown failed: ownership or exit could not be verified.");
  }

  private stopEntry(key: string, entry: RuntimeEntry): Promise<void> {
    if (entry.stopping) return entry.stopping;
    clearTimeout(entry.idleTimer);
    this.rejectTurns(entry, "Runtime admission was invalidated by shutdown.");
    entry.stopping = Promise.resolve().then(async () => {
      await entry.runtime.stop(this.shutdownGracePeriodMs);
      if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
      this.deleteRoutesForRuntime(entry.runtime);
      this.options.attestationVerifier?.invalidate?.({ agentKind: entry.runtime.agentKind,
        worktreeId: entry.runtime.worktreeId, runtimeGeneration: entry.runtime.generation });
    }).catch((error: unknown) => {
      entry.quarantineReason = "shutdown_failed";
      entry.stopping = undefined;
      throw error;
    });
    return entry.stopping;
  }

  private deleteRoutesForRuntime(runtime: OwnedWorktreeRuntime): void {
    for (const [routeKey, route] of this.sessionRoutes) {
      if (route.agentKind === runtime.agentKind
        && route.worktreeId === runtime.worktreeId
        && route.runtimeGeneration === runtime.generation) {
        this.sessionRoutes.delete(routeKey);
      }
    }
  }

  resolveSessionRoute(input: Omit<SessionRoute, "runId">): { runId: string } | null {
    const entry = this.runtimes.get(runtimeKey(input.agentKind, input.worktreeId));
    if (!entry || entry.runtime.generation !== input.runtimeGeneration || entry.stopping
      || entry.quarantineReason) return null;
    const route = this.sessionRoutes.get(this.sessionRouteKey(input));
    if (!route || route.assignmentGenerationId !== input.assignmentGenerationId
      || route.catalogGenerationId !== input.catalogGenerationId) return null;
    return { runId: route.runId };
  }

  private sessionRouteKey(input: Pick<SessionRoute,
    "agentKind" | "worktreeId" | "runtimeGeneration" | "externalSessionId">): string {
    return JSON.stringify([input.agentKind, input.worktreeId, input.runtimeGeneration, input.externalSessionId]);
  }

  acquireAdmission(
    worktreeId: string,
    lane: WorktreeAdmissionLane,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorktreeAdmissionLease> {
    if (options.signal?.aborted) return Promise.reject(new Error("Runtime admission was cancelled."));
    if (this.shuttingDown) return Promise.reject(new Error("Runtime manager is shutting down."));
    if (lane === "control") return Promise.resolve({ release: () => undefined });
    if (this.removedWorktrees.has(worktreeId) || (lane === "normal" && this.removingWorktrees.has(worktreeId))) {
      return Promise.reject(new Error("Worktree runtime ownership was removed."));
    }
    const gate = this.admissionGates.get(worktreeId) ?? { readers: 0, writer: false, queue: [] };
    this.admissionGates.set(worktreeId, gate);
    const writerQueued = gate.queue.some((waiter) => waiter.lane === "exclusive");
    if (lane === "normal" && !gate.writer && !writerQueued) {
      gate.readers += 1;
      return Promise.resolve(this.admissionLease(worktreeId, gate, lane));
    }
    if (lane === "exclusive" && !gate.writer && gate.readers === 0) {
      gate.writer = true;
      return Promise.resolve(this.admissionLease(worktreeId, gate, lane));
    }
    return this.enqueueRequest<WorktreeAdmissionLease>((request) => {
      const waiter = { ...request, lane };
      gate.queue.push(waiter);
      return () => {
        const index = gate.queue.indexOf(waiter);
        if (index >= 0) gate.queue.splice(index, 1);
        this.pumpAdmission(worktreeId, gate);
      };
    }, options.signal);
  }

  private admissionLease(
    worktreeId: string,
    gate: AdmissionGate,
    lane: Exclude<WorktreeAdmissionLane, "control">,
  ): WorktreeAdmissionLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (lane === "exclusive") gate.writer = false;
        else gate.readers -= 1;
        this.pumpAdmission(worktreeId, gate);
        for (const [key, entry] of this.runtimes) {
          if (entry.runtime.worktreeId === worktreeId && this.isIdle(key, entry)) {
            entry.lastReleasedAt = this.now();
            this.scheduleIdle(key, entry);
          }
        }
        void this.pumpCapacity();
      },
    };
  }

  private pumpAdmission(worktreeId: string, gate: AdmissionGate): void {
    if (this.shuttingDown || this.removedWorktrees.has(worktreeId)) {
      for (const waiter of gate.queue.splice(0)) waiter.reject(new Error("Worktree runtime admission is unavailable."));
      return;
    }
    if (gate.writer || gate.readers > 0) return;
    const writerIndex = gate.queue.findIndex((waiter) => waiter.lane === "exclusive");
    if (writerIndex >= 0) {
      const [writer] = gate.queue.splice(writerIndex, 1);
      gate.writer = true;
      writer.resolve(this.admissionLease(worktreeId, gate, "exclusive"));
      return;
    }
    while (gate.queue[0]?.lane === "normal") {
      const reader = gate.queue.shift();
      if (!reader) break;
      gate.readers += 1;
      reader.resolve(this.admissionLease(worktreeId, gate, "normal"));
    }
    if (!gate.writer && gate.readers === 0 && gate.queue.length === 0) {
      this.admissionGates.delete(worktreeId);
    }
  }

  private enqueueRequest<T>(
    enqueue: (request: { resolve(value: T): void; reject(error: Error): void }) => () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("Runtime admission was cancelled."));
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        remove();
        cleanup();
        reject(new Error("Runtime admission was cancelled."));
      };
      const remove = enqueue({
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      });
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new Error("Runtime admission was cancelled."));
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error("Runtime admission was cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async reserveCapacity(agentKind: CodingAgentKind, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Runtime admission was cancelled.");
    if (this.hasCapacity(agentKind)) {
      this.reserveStart(agentKind);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: CapacityWaiter = { agentKind, resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.capacityWaiters.indexOf(waiter);
          if (index >= 0) this.capacityWaiters.splice(index, 1);
          reject(new Error("Runtime admission was cancelled."));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.capacityWaiters.push(waiter);
      void this.pumpCapacity();
    });
  }

  private reserveStart(agentKind: CodingAgentKind): void {
    this.reservedStarts += 1;
    this.reservedStartsByProvider.set(
      agentKind,
      (this.reservedStartsByProvider.get(agentKind) ?? 0) + 1,
    );
  }

  private hasCapacity(agentKind: CodingAgentKind): boolean {
    const providerCount = [...this.runtimes.values()].filter(
      (entry) => entry.runtime.agentKind === agentKind,
    ).length + (this.reservedStartsByProvider.get(agentKind) ?? 0);
    return this.runtimes.size + this.reservedStarts < this.maximumRuntimes
      && providerCount < this.maximumRuntimesPerProvider;
  }

  private async pumpCapacity(): Promise<void> {
    if (this.pumpingCapacity) return;
    this.pumpingCapacity = true;
    try {
      while (this.capacityWaiters.length > 0) {
        const nextWaiter = this.capacityWaiters[0];
        if (!nextWaiter) return;
        if (!this.hasCapacity(nextWaiter.agentKind)) {
          const providerCount = [...this.runtimes.values()].filter(
            (entry) => entry.runtime.agentKind === nextWaiter.agentKind,
          ).length + (this.reservedStartsByProvider.get(nextWaiter.agentKind) ?? 0);
          const providerAtCapacity = providerCount >= this.maximumRuntimesPerProvider;
          const candidate = [...this.runtimes.entries()]
            .filter(([key, entry]) => this.isIdle(key, entry)
              && (!providerAtCapacity || entry.runtime.agentKind === nextWaiter.agentKind))
            .sort((left, right) => left[1].lastReleasedAt - right[1].lastReleasedAt)[0];
          if (!candidate) return;
          const [key, entry] = candidate;
          try {
            await this.stopEntry(key, entry);
          } catch (error) {
            const waiterIndex = this.capacityWaiters.indexOf(nextWaiter);
            if (waiterIndex >= 0) this.capacityWaiters.splice(waiterIndex, 1);
            if (nextWaiter.signal && nextWaiter.onAbort) {
              nextWaiter.signal.removeEventListener("abort", nextWaiter.onAbort);
            }
            nextWaiter.reject(new Error("Runtime capacity eviction shutdown failed.", { cause: error }));
            continue;
          }
          if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
          if (this.capacityWaiters[0] !== nextWaiter) continue;
        }
        const waiter = this.capacityWaiters.shift();
        if (!waiter) return;
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        if (waiter.signal?.aborted) waiter.reject(new Error("Runtime admission was cancelled."));
        else {
          this.reserveStart(waiter.agentKind);
          waiter.resolve();
        }
      }
    } finally {
      this.pumpingCapacity = false;
    }
  }

  private async startRuntime(
    key: string,
    agentKind: CodingAgentKind,
    worktreeId: string,
  ): Promise<RuntimeEntry> {
    const pending = this.starts.get(key);
    if (pending) return pending;
    const controller = new AbortController();
    this.startControllers.set(key, controller);
    const generationNumber = (this.generationByKey.get(key) ?? 0) + 1;
    this.generationByKey.set(key, generationNumber);
    const generation = `${this.generationEpoch}:${agentKind}:${worktreeId}:${generationNumber}`;
    const start = (async () => {
      await this.reserveCapacity(agentKind, controller.signal);
      try {
        const runtime = await this.options.factory.create({
          agentKind, worktreeId, generation, namespaceId: randomUUID(),
        });
        if (runtime.agentKind !== agentKind || runtime.worktreeId !== worktreeId
          || runtime.generation !== generation) {
          throw new Error("Runtime factory returned an ownership or generation mismatch.");
        }
        const entry: RuntimeEntry = {
          runtime, leaseCount: 0, lastReleasedAt: this.now(), turnActive: false,
          turnWaiters: [], quarantineReason: null,
        };
        this.runtimes.set(key, entry);
        if (controller.signal.aborted && !this.shuttingDown) {
          await this.stopEntry(key, entry);
          throw new Error("Runtime admission was cancelled.");
        }
        return entry;
      } finally {
        this.reservedStarts -= 1;
        this.reservedStartsByProvider.set(agentKind,
          (this.reservedStartsByProvider.get(agentKind) ?? 1) - 1);
      }
    })();
    this.starts.set(key, start);
    try {
      return await start;
    } finally {
      if (this.starts.get(key) === start) {
        this.starts.delete(key);
        this.startControllers.delete(key);
      }
      void this.pumpCapacity();
    }
  }
}
