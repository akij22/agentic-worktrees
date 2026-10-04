import { createHash } from "node:crypto";
import { join } from "node:path";
import type Sqlite from "better-sqlite3";
import type {
  ActivityLineage,
  SessionResourceActivityChangedEvent,
} from "../shared/resource-activity";
import type {
  AssignmentParticipantAttestation,
  ResourceAssignmentGeneration,
} from "../shared/assignments";
import { WorktreeResourceAssignmentService } from "./assignments/worktree-resource-assignment-service";
import { ApplicationResourceCatalog } from "./assignments/application-resource-catalog";
import { AssignmentCoordinatorStore } from "./assignments/assignment-coordinator-store";
import {
  ResourceActivityEvidenceService,
  type ProviderEvidenceContract,
} from "./resource-activity/resource-activity-evidence-service";
import { ResourceActivityRepository } from "./resource-activity/resource-activity-repository";
import {
  WorktreeRuntimeManager,
  type OwnedWorktreeRuntime,
  WorktreeRuntimeStartupError,
} from "./coding-agents/worktree-runtime-manager";
import { DatabaseRuntimeAttestationVerifier } from "./coding-agents/worktree-runtime-attestation-verifier";
import { CodexWorktreeRuntimeFactory } from "./coding-agents/codex-worktree-runtime-factory";
import { OpenCodeWorktreeRuntimeFactory } from "./coding-agents/opencode-worktree-runtime-factory";
import {
  CODEX_ACTIVITY_CONTRACT,
  CODEX_RUNTIME_VERSION,
  codexBodyDigest,
  createCodexEvidenceContract,
  type CodexWorktreeRuntimeOptions,
  type CodexOwnedHostObservation,
} from "./coding-agents/codex-worktree-runtime";
import {
  OPENCODE_ACTIVITY_CONTRACT,
  OPENCODE_RUNTIME_VERSION,
  openCodeEffectiveStateDigest,
  createOpenCodeEvidenceContract,
  type OpenCodeWorktreeRuntimeOptions,
} from "./coding-agents/opencode-worktree-runtime";
import type {
  CodingAgentAdapter,
  CodingAgentKind,
  CodingAgentEvent,
  CodingAgentTurnInput,
} from "./coding-agents/types";
import type {
  CapabilityCatalogEntry,
  CapabilityCatalog,
} from "./capabilities/catalog";
import type { CapabilityHostManager } from "./capabilities/capability-host-manager";
import type {
  CapabilitySettingRecord,
  CapabilityRepository,
} from "./capabilities/capability-repository";
import type { CapabilityResourceOwner } from "./capabilities/capability-resource-owner";
import { createManagedPackageLayout } from "./packages/storage-layout";
import type { ValidatedSkillPackage } from "./skills/skill-validation";

interface RuntimeDependencies {
  sqlite: Sqlite.Database;
  resources?: ApplicationResourceCatalog;
  userDataPath: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  evidenceKey: Uint8Array;
  keyVersion?: number;
  previousKeys?: Readonly<Record<number, Uint8Array>>;
  capabilityHosts?: {
    catalog: CapabilityCatalog;
    repository: CapabilityRepository;
    resolveSecret(
      capabilityId: string,
      settingKey: string,
    ): Promise<string | undefined>;
    bundlePath?: string;
  };
  executable(kind: CodingAgentKind): string;
  /** Trusted main-process model endpoint; never accepted from Resource IPC. */
  modelProvider?: CodexWorktreeRuntimeOptions["modelProvider"];
  onActivityChanged?(event: SessionResourceActivityChangedEvent): void;
  onEvent?(
    kind: CodingAgentKind,
    worktreeId: string,
    generation: string,
    event: CodingAgentEvent,
  ): void;
}
interface RuntimePlan {
  lineage: ActivityLineage;
  digest?: string;
  projectionDigest: string;
  options: CodexWorktreeRuntimeOptions & OpenCodeWorktreeRuntimeOptions;
  hosts?: CapabilityHostManager;
  stopOwnedHosts?(): Promise<void>;
}
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const contractKey = (lineage: ActivityLineage) =>
  `${lineage.provider}:${lineage.runtimeGenerationId}:${lineage.catalogGenerationId}`;
/** Application-owned lifecycle and exact provider dispatch. Renderer projections cannot grant admission. */
export class ApplicationResourceRuntime {
  readonly manager: WorktreeRuntimeManager;
  readonly assignment: WorktreeResourceAssignmentService;
  readonly activity: ResourceActivityEvidenceService;
  private readonly repository: ResourceActivityRepository;
  private readonly turns = new Map<
    string,
    {
      adapter: CodingAgentAdapter;
      directory: string;
      sessionId: string;
      lineage: ActivityLineage;
      finish(): void;
      completion: Promise<void>;
    }
  >();
  private readonly plans = new Map<string, RuntimePlan>();
  private readonly ownedHosts = new Map<
    string,
    { hosts: CapabilityHostManager; lineage: ActivityLineage }
  >();
  private readonly contracts = new Map<
    string,
    { contract: ProviderEvidenceContract; retiredAt?: number }
  >();
  private readonly codex: CodexWorktreeRuntimeFactory;
  private readonly opencode: OpenCodeWorktreeRuntimeFactory;
  private readonly store: AssignmentCoordinatorStore;
  private readonly resources: ApplicationResourceCatalog;
  private stopping?: Promise<void>;
  constructor(private readonly dependencies: RuntimeDependencies) {
    this.store = new AssignmentCoordinatorStore(dependencies.sqlite);
    this.resources =
      dependencies.resources ??
      new ApplicationResourceCatalog(
        dependencies.sqlite,
        dependencies.userDataPath,
      );
    this.repository = new ResourceActivityRepository(dependencies.sqlite);
    const verifier = new DatabaseRuntimeAttestationVerifier(
      dependencies.sqlite,
    );
    const storageRoot = join(dependencies.userDataPath, "worktree-runtimes");
    this.codex = new CodexWorktreeRuntimeFactory({
      storageRoot: join(storageRoot, "codex"),
      loadPlan: async (input) => {
        this.prepareContractCapacity();
        const executablePath = dependencies.executable("codex");
        const options = (await this.loadOptions(
          input,
        )) as CodexWorktreeRuntimeOptions;
        this.contracts.set(contractKey(options.lineage), {
          contract: createCodexEvidenceContract(options),
        });
        return {
          executablePath,
          options,
          stopOwnedHosts: this.plans.get(input.generation)?.stopOwnedHosts,
        };
      },
      onExit: (wt, generation, cleanupFailed) =>
        this.handleRuntimeExit("codex", wt, generation, cleanupFailed),
    });
    this.opencode = new OpenCodeWorktreeRuntimeFactory({
      storageRoot: join(storageRoot, "opencode"),
      loadPlan: async (input) => {
        this.prepareContractCapacity();
        const executablePath = dependencies.executable("opencode");
        const options = (await this.loadOptions(
          input,
        )) as OpenCodeWorktreeRuntimeOptions;
        this.contracts.set(contractKey(options.lineage), {
          contract: createOpenCodeEvidenceContract(options),
        });
        return {
          executablePath,
          options,
          stopOwnedHosts: this.plans.get(input.generation)?.stopOwnedHosts,
        };
      },
      onExit: (wt, generation, cleanupFailed) =>
        this.handleRuntimeExit("opencode", wt, generation, cleanupFailed),
    });
    this.manager = new WorktreeRuntimeManager({
      factory: {
        create: async (input) => {
          let runtime;
          try {
            runtime = await (input.agentKind === "codex"
              ? this.codex.create(input)
              : this.opencode.create(input));
          } catch (error) {
            if (
              error instanceof WorktreeRuntimeStartupError &&
              error.cleanupVerified
            )
              this.retirePlan(input.generation);
            throw error;
          }
          const unsubscribe = runtime.adapter.subscribe((event) =>
            dependencies.onEvent?.(
              input.agentKind,
              input.worktreeId,
              input.generation,
              event,
            ),
          );
          return {
            ...runtime,
            stop: async (options) => {
              try {
                await runtime.stop(options);
                this.retirePlan(input.generation);
              } finally {
                unsubscribe();
              }
            },
          };
        },
      },
      attestationVerifier: verifier,
      isPersistedSessionRoute: (route) =>
        Boolean(
          dependencies.sqlite
            .prepare(
              `SELECT 1 FROM runs r
        JOIN coding_agent_sessions s ON s.run_id=r.id JOIN coding_agent_installations i ON i.id=s.installation_id
        WHERE r.id=? AND r.worktree_id=? AND i.kind=? AND i.id=? AND s.external_session_id=?`,
            )
            .get(
              route.runId,
              route.worktreeId,
              route.agentKind,
              route.agentKind,
              route.externalSessionId,
            ),
        ),
    });
    this.activity = new ResourceActivityEvidenceService({
      repository: this.repository,
      keyVersion: dependencies.keyVersion ?? 1,
      evidenceKey: dependencies.evidenceKey,
      previousKeys: dependencies.previousKeys,
      onChanged: () => this.publishActivityOutbox(),
      providerContracts: [this.contract("codex"), this.contract("opencode")],
      quarantine: (lineage) =>
        this.manager.quarantineRuntime(
          lineage.provider,
          lineage.worktreeId,
          lineage.runtimeGenerationId,
          "evidence_conflict",
        ),
      cancelOwnedInvocation: async (lineage, invocationId) => {
        const plan = this.plans.get(lineage.runtimeGenerationId);
        if (!plan || JSON.stringify(plan.lineage) !== JSON.stringify(lineage))
          return false;
        return (
          plan.hosts?.cancelInvocation(
            lineage.runtimeGenerationId,
            lineage.runtimeGenerationId,
            invocationId,
          ) ?? false
        );
      },
    });
    this.assignment = new WorktreeResourceAssignmentService({
      sqlite: dependencies.sqlite,
      runtimeManager: this.manager,
      resources: this.resources,
      providers: {
        prepare: async (runtime, target, prior) =>
          this.prepareParticipant(runtime, target, prior),
      },
    });
  }
  private async stopOwnedHost(generation: string): Promise<void> {
    const owned = this.ownedHosts.get(generation);
    if (!owned) return;
    await owned.hosts.stopOwnedHost(generation, generation);
    this.ownedHosts.delete(generation);
  }
  private prepareContractCapacity(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [key, value] of this.contracts)
      if (value.retiredAt !== undefined && value.retiredAt < cutoff)
        this.contracts.delete(key);
    if (this.contracts.size >= 10_000)
      throw new Error("Owned Resource contract capacity is unavailable.");
  }
  private retirePlan(generation: string): void {
    const plan = this.plans.get(generation);
    if (plan) {
      const retained = this.contracts.get(contractKey(plan.lineage));
      if (retained) retained.retiredAt = Date.now();
      this.plans.delete(generation);
    }
  }
  private handleRuntimeExit(
    kind: CodingAgentKind,
    worktreeId: string,
    generation: string,
    cleanupFailed: boolean,
  ): void {
    if (cleanupFailed) {
      if (
        this.manager
          .inspectWorktree(worktreeId)
          .runtimes.some(
            (runtime) =>
              runtime.agentKind === kind && runtime.generation === generation,
          )
      )
        this.manager.quarantineRuntime(
          kind,
          worktreeId,
          generation,
          "owned_exit_cleanup_unavailable",
        );
      else this.manager.reportRuntimeExit(kind, worktreeId, generation);
      return;
    }
    this.manager.reportRuntimeExit(kind, worktreeId, generation);
    this.retirePlan(generation);
  }
  private contract(provider: CodingAgentKind): ProviderEvidenceContract {
    const find = (lineage: ActivityLineage) =>
      this.contracts.get(contractKey(lineage))?.contract;
    return {
      name:
        provider === "codex"
          ? CODEX_ACTIVITY_CONTRACT
          : OPENCODE_ACTIVITY_CONTRACT,
      provider,
      providerVersion:
        provider === "codex" ? CODEX_RUNTIME_VERSION : OPENCODE_RUNTIME_VERSION,
      adapterContractVersion: 1,
      automaticSkillContextQualified: provider === "opencode",
      resolveTool: (l, s, t) => find(l)?.resolveTool(l, s, t) ?? null,
      resolveHostTool: (l, s, t) => find(l)?.resolveHostTool?.(l, s, t) ?? null,
      resolveSkill: (l, s) => find(l)?.resolveSkill?.(l, s) ?? null,
      resolveSkillBodyDigest: (l, s) =>
        find(l)?.resolveSkillBodyDigest?.(l, s) ?? null,
    };
  }
  private async loadOptions(
    input: {
      agentKind: CodingAgentKind;
      worktreeId: string;
      generation: string;
      namespaceId: string;
    },
    target?: ResourceAssignmentGeneration,
  ) {
    const cached = this.plans.get(input.generation);
    if (cached) return cached.options;
    if (
      [...this.ownedHosts].some(
        ([generation, owned]) =>
          generation !== input.generation &&
          owned.lineage.provider === input.agentKind &&
          owned.lineage.worktreeId === input.worktreeId &&
          !this.plans.has(generation),
      )
    )
      throw new Error("Unverified owned Host startup requires recovery.");
    const state = this.store.load(input.worktreeId);
    const worktree = this.dependencies.sqlite
      .prepare("SELECT path FROM worktrees WHERE id=?")
      .get(input.worktreeId) as { path: string } | undefined;
    if (!state || !worktree)
      throw new Error("Runtime Resources are unavailable.");
    const generation = target ?? state.verifiedGeneration;
    await this.resources.prepare(generation);
    const skills = await Promise.all(
      generation.resources
        .filter((r) => r.kind === "skill")
        .map((r) => this.resources.loadSkill(r)),
    );
    const lineage: ActivityLineage = {
      worktreeId: input.worktreeId,
      provider: input.agentKind,
      providerVersion:
        input.agentKind === "codex"
          ? CODEX_RUNTIME_VERSION
          : OPENCODE_RUNTIME_VERSION,
      adapterContractVersion: 1,
      runtimeGenerationId: input.generation,
      assignmentRevision:
        target && state.attempt?.kind === "resource_update"
          ? (BigInt(state.revision) + 1n).toString()
          : state.revision,
      assignmentGenerationId: generation.id,
      catalogGenerationId: `catalog:${digest({ generation: input.generation, assignment: generation.id }).slice(7)}`,
    };
    const capabilities: CodexWorktreeRuntimeOptions["capabilities"][number][] =
      [];
    const capabilityTools: CodexWorktreeRuntimeOptions["capabilityTools"][number][] =
      [];
    const listeners = new Set<(input: CodexOwnedHostObservation) => void>();
    let hosts: CapabilityHostManager | undefined;
    const assignedCapabilities = generation.resources.filter(
      (r) => r.kind === "capability",
    );
    if (assignedCapabilities.length) {
      const owner = this.dependencies.capabilityHosts;
      if (!owner) throw new Error("Owned Capability Host is unavailable.");
      const stagedPlans = assignedCapabilities.map((resource) =>
        this.resources.capabilityPlan(resource),
      );
      const entries = assignedCapabilities.map(
        (resource, index) =>
          stagedPlans[index]?.entry ??
          owner.catalog.get(resource.id, resource.version),
      );
      if (
        entries.some(
          (entry, index) =>
            entry.manifest.version !== assignedCapabilities[index].version ||
            entry.blocked,
        )
      )
        throw new Error("Owned Capability catalog is unavailable.");
      const frozenCatalog: CapabilityCatalog = {
        list: () => entries,
        get: (id, version) => {
          const entry = entries.find(
            (entry) =>
              entry.manifest.id === id &&
              (!version || entry.manifest.version === version),
          );
          if (!entry)
            throw new Error("Capability is outside the owned catalog.");
          return entry;
        },
        refresh: async () => {
          throw new Error("Owned catalog is immutable.");
        },
      };
      const { createElectronCapabilityHostManager } = await import(
        "./capabilities/capability-host-manager"
      );
      hosts = createElectronCapabilityHostManager(
        owner.resolveSecret,
        frozenCatalog,
        {
          onObservation: (ownerId, runtimeGeneration, observation) => {
            if (
              ownerId !== input.generation ||
              runtimeGeneration !== input.generation
            )
              return;
            for (const listener of listeners)
              listener({
                runtimeGeneration,
                serverName: "aw_resources",
                observation,
              });
          },
        },
        owner.bundlePath,
        this.dependencies.environment,
      );
      const settings = Object.fromEntries(
        assignedCapabilities.map((resource, index) => [
          resource.id,
          Object.fromEntries(
            (
              stagedPlans[index]?.settings ??
              owner.repository.getSettings(resource.id)
            )
              .filter((setting) => setting.value !== undefined)
              .map((setting) => [setting.key, setting.value]),
          ),
        ]),
      );
      this.ownedHosts.set(input.generation, { hosts, lineage });
      let connection;
      try {
        connection = await hosts.ensureHost(
          input.generation,
          assignedCapabilities.map((resource) => resource.id),
          settings,
          input.generation,
        );
      } catch (error) {
        try {
          await this.stopOwnedHost(input.generation);
        } catch {
          throw new WorktreeRuntimeStartupError(error, false);
        }
        throw new WorktreeRuntimeStartupError(error, true);
      }
      capabilities.push({
        serverName: "aw_resources",
        profileId: "aw_resources",
        url: connection.url,
        authorizationHeader: `Bearer ${connection.bearerToken}`,
      });
      for (const [index, entry] of entries.entries())
        for (const toolName of entry.toolNames) {
          const resource = assignedCapabilities[index];
          capabilityTools.push({
            serverName: "aw_resources",
            toolName,
            hostToolName: toolName,
            identity: {
              resourceKind: "capability",
              resourceId: resource.id,
              resourceVersion: resource.version,
              resourceDigest: resource.contentDigest,
            },
          });
        }
    }
    const options = {
      namespaceRoot: join(
        this.dependencies.userDataPath,
        "worktree-runtimes",
        input.agentKind,
        input.namespaceId,
      ),
      directory: worktree.path,
      lineage,
      skills,
      capabilities,
      capabilityTools,
      subscribeHostObservations: (
        listener: (input: CodexOwnedHostObservation) => void,
      ) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      environment: this.dependencies.environment,
      evidence: this.activity,
      modelProvider: this.dependencies.modelProvider,
      onVerified: async (effectiveStateDigest: string) => {
        plan.digest = effectiveStateDigest;
      },
      verifyAttestation: (l: ActivityLineage) =>
        new DatabaseRuntimeAttestationVerifier(this.dependencies.sqlite).verify(
          {
            agentKind: l.provider,
            worktreeId: l.worktreeId,
            runtimeGeneration: l.runtimeGenerationId,
            providerVersion: l.providerVersion,
            assignmentGenerationId: l.assignmentGenerationId,
            catalogGenerationId: l.catalogGenerationId,
          },
        ),
      onUnavailable: (l: ActivityLineage) =>
        new DatabaseRuntimeAttestationVerifier(
          this.dependencies.sqlite,
        ).invalidate({
          agentKind: l.provider,
          worktreeId: l.worktreeId,
          runtimeGeneration: l.runtimeGenerationId,
        }),
    };
    const plan: RuntimePlan = {
      lineage,
      options,
      hosts,
      stopOwnedHosts: hosts
        ? () => this.stopOwnedHost(input.generation)
        : undefined,
      projectionDigest: digest({ lineage, resources: generation.resources }),
    };
    this.plans.set(input.generation, plan);
    return options;
  }
  private async prepareParticipant(
    runtime: OwnedWorktreeRuntime,
    target: ResourceAssignmentGeneration,
    prior: ResourceAssignmentGeneration,
  ) {
    const plan = this.plans.get(runtime.generation);
    if (!plan?.digest || plan.lineage.assignmentGenerationId !== prior.id)
      throw new Error("Runtime activation plan is unavailable.");
    const attestation = (
      p: RuntimePlan,
      generation: string,
      effectiveStateDigest: string,
    ): AssignmentParticipantAttestation => ({
      agentKind: runtime.agentKind,
      runtimeGenerationId: generation,
      assignmentGenerationId: p.lineage.assignmentGenerationId,
      catalogGenerationId: p.lineage.catalogGenerationId,
      providerVersion: runtime.providerVersion,
      adapterContractVersion: 1,
      effectiveStateDigest,
      skillIsolation:
        runtime.agentKind === "codex" ? "not_enforced" : "enforced",
      attestedAt: new Date().toISOString(),
    });
    const priorExpected = attestation(plan, runtime.generation, plan.digest);
    if (target.id === prior.id)
      return {
        expected: priorExpected,
        priorExpected,
        projectionDigest: plan.projectionDigest,
        priorProjectionDigest: plan.projectionDigest,
        stage: async () => undefined,
        activate: async () => undefined,
        verify: async () => priorExpected,
        rollback: async () => priorExpected,
        discard: async () => undefined,
        finalize: async () => undefined,
      };
    this.dependencies.executable(runtime.agentKind);
    const replacement = this.manager.reserveAssignmentReplacement(
      runtime.agentKind,
      runtime.worktreeId,
      runtime.generation,
    );
    try {
      const options = await this.loadOptions(
        {
          agentKind: runtime.agentKind,
          worktreeId: runtime.worktreeId,
          generation: replacement.generation,
          namespaceId: replacement.namespaceId,
        },
        target,
      );
      const prepared = this.plans.get(replacement.generation);
      if (!prepared)
        throw new Error("Replacement activation plan is unavailable.");
      const expectedDigest =
        runtime.agentKind === "codex"
          ? codexBodyDigest(
              JSON.stringify({
                lineage: options.lineage,
                skills: options.skills.map((s) => s.identity),
                tools: options.capabilityTools,
                skillIsolation: "not_enforced",
              }),
            )
          : openCodeEffectiveStateDigest(options);
      const expected = attestation(
        prepared,
        replacement.generation,
        expectedDigest,
      );
      return {
        expected,
        priorExpected,
        projectionDigest: prepared.projectionDigest,
        priorProjectionDigest: plan.projectionDigest,
        stage: async () => {
          await replacement.stage();
        },
        activate: () => replacement.activate(),
        verify: async () => {
          if (prepared.digest !== expected.effectiveStateDigest)
            throw new Error("Replacement verification mismatch.");
          return expected;
        },
        rollback: async () => {
          await replacement.rollback();
          return priorExpected;
        },
        discard: async () => {
          await replacement.discard();
          await prepared.stopOwnedHosts?.();
          this.retirePlan(replacement.generation);
        },
        finalize: () => replacement.finalize(),
      };
    } catch (error) {
      await replacement.discard();
      await this.plans.get(replacement.generation)?.stopOwnedHosts?.();
      this.retirePlan(replacement.generation);
      throw error;
    }
  }

  adapter(
    kind: CodingAgentKind,
    worktreeId: string,
    generation: string,
  ): CodingAgentAdapter {
    return kind === "codex"
      ? this.codex.getAdapter(worktreeId, generation)
      : this.opencode.getAdapter(worktreeId, generation);
  }
  private publishActivityOutbox(): void {
    if (!this.dependencies.onActivityChanged) return;
    for (;;) {
      const events = this.repository.listPendingOutbox();
      if (!events.length) return;
      for (const record of events) {
        this.dependencies.onActivityChanged(record.event);
        this.repository.markOutboxPublished(record.event.eventId, new Date());
      }
    }
  }
  async start(): Promise<void> {
    await this.assignment.reconcileStartup();
    this.activity.pruneRetention();
    this.publishActivityOutbox();
  }
  packageResourceOwner(): CapabilityResourceOwner {
    return {
      activeRuns: (id) => {
        const worktrees = this.store.listWorktrees().filter((idOfWorktree) => {
          const state = this.store.load(idOfWorktree);
          return [
            ...(state?.desiredGeneration.resources ?? []),
            ...(state?.verifiedGeneration.resources ?? []),
          ].some(
            (resource) => resource.kind === "capability" && resource.id === id,
          );
        });
        return worktrees
          .flatMap((worktreeId) =>
            (
              this.dependencies.sqlite
                .prepare(
                  "SELECT r.id FROM runs r JOIN coding_agent_sessions s ON s.run_id=r.id WHERE r.worktree_id=? AND r.status IN ('idle','busy') ORDER BY r.id",
                )
                .all(worktreeId) as Array<{ id: string }>
            ).map((row) => row.id),
          )
          .sort();
      },
      publish: async (inspected, configuration, transaction) => {
        const entry: CapabilityCatalogEntry = {
          manifest: inspected.descriptor.manifest,
          reviewStatus: inspected.reviewStatus,
          trust: inspected.trust,
          source: "npm",
          packageName: inspected.staged.packageName,
          toolNames: inspected.descriptor.tools.map((tool) => tool.name),
          runtime: {
            kind: "managed",
            capabilityId: inspected.descriptor.manifest.id,
            packageName: inspected.staged.packageName,
            version: inspected.staged.resolvedVersion,
            packageRoot: createManagedPackageLayout(
              this.dependencies.userDataPath,
            ).packageVersionRoot(
              inspected.descriptor.manifest.id,
              inspected.staged.resolvedVersion,
            ),
            manifest: inspected.packageMetadata.manifest,
            entry: inspected.packageMetadata.entry,
            contentDigest: inspected.staged.contentDigest,
          },
        };
        const settings =
          configuration?.settings ??
          Object.entries(entry.manifest.settings).map(([key, setting]) => ({
            key,
            ...("default" in setting && setting.default !== undefined
              ? { value: setting.default }
              : {}),
          }));
        const configured =
          configuration?.configured ??
          Object.values(entry.manifest.settings).every(
            (setting) =>
              !setting.required ||
              ("default" in setting && setting.default !== undefined),
          );
        const staged = configured
          ? this.resources.stageCapability(entry, settings)
          : undefined;
        try {
          await this.assignment.distribute({
            kind: "capability",
            id: entry.manifest.id,
            targetVersion: configured ? entry.manifest.version : null,
            operationId: inspected.staged.operationId,
            stageResource: () => transaction.stage(),
            commitResource: () => transaction.commit(),
            rollbackResource: () => transaction.rollback(),
            finalizeResource: () => transaction.finalize(),
          });
        } finally {
          staged?.release();
        }
      },
      remove: (id, operationId, transaction) =>
        this.assignment.distribute({
          kind: "capability",
          id,
          targetVersion: null,
          operationId,
          stageResource: () => transaction.stage(),
          commitResource: () => transaction.commit(),
          rollbackResource: () => transaction.rollback(),
          finalizeResource: () => transaction.finalize(),
        }),
    };
  }
  async configureCapability(
    entry: CapabilityCatalogEntry,
    settings: readonly CapabilitySettingRecord[],
    commit: () => void,
  ): Promise<void> {
    const staged = this.resources.stageCapability(entry, settings);
    try {
      await this.assignment.distribute({
        kind: "capability",
        id: staged.identity.id,
        targetVersion: staged.identity.version,
        commitResource: commit,
      });
    } finally {
      staged.release();
    }
  }
  async installSkill(
    validated: ValidatedSkillPackage,
    owner: {
      stage(): Promise<void>;
      commit(): void;
      rollback(): Promise<void>;
    },
  ): Promise<void> {
    const staged = this.resources.stageSkill(validated);
    try {
      await this.assignment.distribute({
        kind: "skill",
        id: staged.identity.id,
        targetVersion: staged.identity.version,
        stageResource: () => owner.stage(),
        commitResource: () => owner.commit(),
        rollbackResource: () => owner.rollback(),
      });
    } finally {
      staged.release();
    }
  }
  async withSession<T extends { id: string }>(
    request: {
      worktreeId: string;
      agentKind: CodingAgentKind;
      runId: string;
      operation: "create" | "resume";
      externalSessionId?: string;
    },
    operation: (adapter: CodingAgentAdapter) => Promise<T>,
  ): Promise<T> {
    return this.assignment.withSessionAdmission(request, async (lease) => {
      const adapter = this.adapter(
        request.agentKind,
        request.worktreeId,
        lease.runtime.generation,
      );
      const result = await operation(adapter);
      this.manager.registerSessionRoute({
        ...request,
        externalSessionId: result.id,
        runtimeGeneration: lease.runtime.generation,
        assignmentGenerationId: lease.assignmentGenerationId,
        catalogGenerationId: lease.catalogGenerationId,
      });
      return result;
    });
  }
  isTurnActive(runId: string): boolean {
    return this.turns.has(runId);
  }
  async submitTurn(
    request: {
      worktreeId: string;
      agentKind: CodingAgentKind;
      runId: string;
      externalSessionId: string;
    },
    input: CodingAgentTurnInput,
  ): Promise<void> {
    return this.submitOperation(request, input, "prompt");
  }
  async compact(
    request: {
      worktreeId: string;
      agentKind: CodingAgentKind;
      runId: string;
      externalSessionId: string;
    },
    input: { providerId: string; modelId: string },
  ): Promise<void> {
    return this.submitOperation(request, { ...input, content: "" }, "compact");
  }
  private async submitOperation(
    request: {
      worktreeId: string;
      agentKind: CodingAgentKind;
      runId: string;
      externalSessionId: string;
    },
    input: CodingAgentTurnInput,
    operation: "prompt" | "compact",
  ): Promise<void> {
    if (this.turns.has(request.runId))
      throw Object.assign(new Error("A turn is already active."), {
        code: "assignment_waiting_for_idle",
      });
    const state = this.store.load(request.worktreeId);
    const selected = input.explicitSkill
      ? state?.verifiedGeneration.resources.find(
          (r) =>
            r.kind === "skill" &&
            r.id === input.explicitSkill?.id &&
            r.version === input.explicitSkill.version,
        )
      : undefined;
    if (input.explicitSkill && !selected)
      throw Object.assign(
        new Error("Skill is unavailable in this Assignment."),
        { code: "resource_unavailable" },
      );
    let accepted!: () => void, rejectAcceptance!: (error: unknown) => void;
    const acceptance = new Promise<void>((resolve, reject) => {
      accepted = resolve;
      rejectAcceptance = reject;
    });
    const completion = this.assignment.withTurnAdmission(
      {
        ...request,
        explicitResources: selected
          ? [
              {
                kind: selected.kind,
                id: selected.id,
                version: selected.version,
              },
            ]
          : [],
      },
      async (lease) => {
        const adapter = this.adapter(
          request.agentKind,
          request.worktreeId,
          lease.runtime.generation,
        );
        const plan = this.plans.get(lease.runtime.generation);
        if (!plan) throw new Error("Owned activation plan is unavailable.");
        let finish!: () => void;
        const drained = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const unsubscribe = adapter.subscribe((event) => {
          if (
            event.type === "server.exit" ||
            (event.sessionId === request.externalSessionId &&
              (event.type === "session.idle" ||
                event.type === "session.error" ||
                (event.type === "session.status" &&
                  event.properties &&
                  typeof event.properties === "object" &&
                  "status" in event.properties &&
                  event.properties.status &&
                  typeof event.properties.status === "object" &&
                  "type" in event.properties.status &&
                  event.properties.status.type === "idle")))
          )
            finish();
        });
        const turn = { ...input };
        if (plan.options.capabilities.length)
          turn.capabilityProfileId = plan.options.capabilities[0].profileId;
        if (turn.explicitSkill)
          turn.explicitSkill = {
            ...turn.explicitSkill,
            name: turn.explicitSkill.id,
            path: join(
              plan.options.namespaceRoot,
              request.agentKind === "codex" ? "skills" : "projection",
              turn.explicitSkill.id,
              "SKILL.md",
            ),
          };
        this.turns.set(request.runId, {
          adapter,
          directory: plan.options.directory,
          sessionId: request.externalSessionId,
          lineage: plan.lineage,
          finish,
          completion,
        });
        try {
          if (operation === "compact")
            await adapter.compact(
              plan.options.directory,
              request.externalSessionId,
              turn,
            );
          else
            await adapter.sendPrompt(
              plan.options.directory,
              request.externalSessionId,
              turn,
            );
          accepted();
          await drained;
        } finally {
          unsubscribe();
          this.turns.delete(request.runId);
        }
      },
    );
    void completion.catch((error) => {
      rejectAcceptance(error);
      console.error("resource_turn_unavailable");
    });
    await acceptance;
  }
  async abort(runId: string): Promise<void> {
    const turn = this.turns.get(runId);
    if (!turn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await turn.adapter.abort(turn.directory, turn.sessionId);
      await Promise.race([
        turn.completion,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned turn drain is unavailable.")),
            5_000,
          );
        }),
      ]);
    } catch (error) {
      if (this.turns.get(runId) === turn)
        this.manager.quarantineRuntime(
          turn.lineage.provider,
          turn.lineage.worktreeId,
          turn.lineage.runtimeGenerationId,
          "turn_drain_unavailable",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  stop(): Promise<void> {
    return (this.stopping ??= this.stopOwnedResources());
  }
  private async stopOwnedResources(): Promise<void> {
    const failures: unknown[] = [];
    for (const [runId, turn] of this.turns) {
      try {
        await this.abort(runId);
      } catch (error) {
        failures.push(error);
        await turn.adapter.stop();
        turn.finish();
      }
    }
    try {
      await this.manager.shutdown();
    } catch (error) {
      failures.push(error);
    }
    for (const generation of this.ownedHosts.keys()) {
      try {
        await this.stopOwnedHost(generation);
      } catch (error) {
        failures.push(error);
      }
    }
    this.activity.dispose();
    if (failures.length)
      throw new AggregateError(
        failures,
        "Owned turn shutdown required recovery.",
      );
  }
}
