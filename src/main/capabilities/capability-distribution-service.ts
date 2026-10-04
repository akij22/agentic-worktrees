import type { CapabilityResourceOwner } from "./capability-resource-owner";
import { randomUUID } from "node:crypto";
import { CapabilityRemovalInstaller } from "./capability-removal-installer";
import { CapabilityRemovalService } from "./capability-removal-service";
import { type PackageRemovalInspectRequest, type PackageRemoveRequest, type CapabilityRemovalInspection,
  capabilityUpdateSchema,
  packageNameSchema,
  type CapabilityUpdateDto,
  capabilityPackageInspectionSchema,
  capabilityDistributionProgressSchema,
  packageErrorCodeSchema,
  packageInspectRequestSchema,
  packageInstallRequestSchema,
  packageUpdateRequestSchema,
  type PackageUpdateRequest,
  type CapabilityPackageInspectionDto,
  type CapabilityDistributionProgress,
  type PackageErrorCode,
  type PackageInspectRequest,
  type PackageInstallRequest,
} from "../../shared/packages/schemas";
import { gt, lt, valid } from "semver";
import npa from "npm-package-arg";
import { InstalledCapabilityCatalog } from "./installed-catalog";
import {
  planCapabilityUpdateConfiguration,
  type CapabilityUpdateConfiguration,
} from "./capability-update-configuration";
import type { CapabilitySessionPackageCoordinator } from "./capability-session-package-coordinator";
import type { CapabilityCredentialStore } from "./capability-credential-store";
import { NpmPackageMetadata } from "../packages/npm-metadata";
import {
  capabilityDetailSchema,
  type CapabilitySummaryDto,
  type CapabilityDetailDto,
} from "../../shared/capabilities/schemas";
import {
  NpmPackageAcquirer,
  type StagedNpmPackage,
} from "../packages/npm-acquirer";
import {
  CapabilityPackageInspector,
  type InspectedCapabilityPackage,
} from "./package-inspector";
import type { CapabilityPackageVerifier } from "./package-verifier";
import { CapabilityPackageInstaller } from "./capability-package-installer";
import { ManagedPackageRepository } from "../packages/package-repository";
import type { ManagedPackageLayout } from "../packages/storage-layout";
import { OfficialCatalogService } from "../packages/catalog/official-catalog";
import { PackageLock } from "../packages/package-lock";
import { listBundledCapabilities, toCapabilitySummaryDto } from "./catalog";
import { CapabilityRepository } from "./capability-repository";
import {
  ConsentLeaseRegistry,
  type ConsentLeaseScheduler,
} from "./consent-lease-registry";
import { getSqlite } from "../database/client";
import type { WebSearchMigration, WebSearchMigrationResult } from "./web-search-migration";

const freeze = <T>(value: T): Readonly<T> => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>))
      freeze(child);
    Object.freeze(value);
  }
  return value;
};

const updateFailure = (cause: unknown, fallback: PackageErrorCode = "package_update_failed") => {
  const parsed = packageErrorCodeSchema.safeParse(cause instanceof Error ? cause.message : undefined);
  const code = parsed.success ? parsed.data : fallback;
  const error = Object.assign(new Error(code), { code });
  error.stack = undefined;
  return Object.freeze(error);
};

const detail = (
  inspected: InspectedCapabilityPackage,
  configured: boolean,
): CapabilityDetailDto => {
  const m = inspected.descriptor.manifest;
  return freeze(
    capabilityDetailSchema.parse({
      ...m,
      settings: Object.entries(m.settings ?? {}).map(([key, setting]) => ({
        key,
        ...setting,
      })),
      state: configured ? "ready" : "needs_setup",
      secretConfigured: configured,
      installationState: "installed",
      source: "npm",
      packageName: inspected.staged.packageName,
      trust: inspected.trust,
      reviewStatus: inspected.reviewStatus,
      activeRunCount: 0,
      providedTools: inspected.descriptor.tools.map((t) => t.name),
      permissionDigest: inspected.permissionDigest,
    }),
  );
};

export class CapabilityDistributionService {
  private readonly removal: CapabilityRemovalService;
  private readonly actions = new Map<string, "install" | "update">();
  private readonly listeners = new Set<
    (event: CapabilityDistributionProgress) => void
  >();
  private readonly repository: ManagedPackageRepository;
  private readonly capabilityRepository: CapabilityRepository;
  private readonly lock: PackageLock;
  private readonly registry: ConsentLeaseRegistry;
  private readonly acquirer: NpmPackageAcquirer;
  private readonly inspector: CapabilityPackageInspector;
  private readonly installer: CapabilityPackageInstaller;
  private readonly installedCatalog: Pick<
    InstalledCapabilityCatalog,
    "get" | "list" | "refresh"
  >;
  constructor(
    private readonly deps: {
      layout: ManagedPackageLayout;
      acquirer?: NpmPackageAcquirer;
      metadata?: Pick<NpmPackageMetadata, "resolve">;
      installedCatalog?: Pick<InstalledCapabilityCatalog, "get" | "list" | "refresh">;
      sessionCoordinator?: CapabilitySessionPackageCoordinator;
      resourceOwner?():CapabilityResourceOwner|undefined;
      credentials?: Pick<CapabilityCredentialStore, "removeSecret">;
      inspector?: CapabilityPackageInspector;
      verifier: CapabilityPackageVerifier;
      installer?: CapabilityPackageInstaller;
      removalInstaller?: CapabilityRemovalInstaller;
      repository?: ManagedPackageRepository;
      capabilityRepository?: CapabilityRepository;
      officialCatalog?: OfficialCatalogService;
      packageLock?: PackageLock;
      clock?: () => number;
      scheduler?: ConsentLeaseScheduler;
      webSearchMigration?: WebSearchMigration;
    },
  ) {
    this.repository = deps.repository ?? new ManagedPackageRepository();
    this.capabilityRepository =
      deps.capabilityRepository ?? new CapabilityRepository(getSqlite());
    this.lock =
      deps.packageLock ?? new PackageLock(deps.layout.root + "/.packages.lock");
    this.acquirer = deps.acquirer ?? new NpmPackageAcquirer(deps.layout);
    this.inspector = deps.inspector ?? new CapabilityPackageInspector();
    this.installedCatalog =
      deps.installedCatalog ??
      new InstalledCapabilityCatalog(deps.layout, this.repository);
    this.installer =
      deps.installer ??
      new CapabilityPackageInstaller(
        deps.layout,
        this.repository,
        this.capabilityRepository,
        <T>(work: () => T) => getSqlite().transaction(work)(),
        { refreshCatalog: () => this.installedCatalog.refresh(),resourceOwner:deps.resourceOwner },
      );
    this.registry = new ConsentLeaseRegistry({
      lock: this.lock,
      clock: deps.clock ?? Date.now,
      scheduler: deps.scheduler ?? { setTimeout, clearTimeout },
    });
    this.removal = new CapabilityRemovalService({
      repository: this.repository, capabilities: this.capabilityRepository, catalog: this.installedCatalog,
      coordinator: deps.sessionCoordinator, resourceOwner:deps.resourceOwner, credentials: deps.credentials, registry: this.registry,
      installer: deps.removalInstaller ?? new CapabilityRemovalInstaller(deps.layout, this.repository, this.capabilityRepository, <T>(work: () => T) => getSqlite().transaction(work)(), { refreshCatalog: () => this.installedCatalog.refresh(),resourceOwner:deps.resourceOwner }),
      emit: (id, stage, status, extra) => this.emit(id, stage, status, extra),
    });
  }
  subscribe(
    listener: (event: CapabilityDistributionProgress) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(
    operationId: string,
    stage: CapabilityDistributionProgress["stage"],
    status: CapabilityDistributionProgress["status"],
    extra: Partial<CapabilityDistributionProgress> = {},
  ) {
    const event = Object.freeze(
      capabilityDistributionProgressSchema.parse({
        operationId,
        action: this.actions.get(operationId) ?? "install",
        stage,
        status,
        updatedAt: new Date().toISOString(),
        ...extra,
      }),
    );
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* observers are isolated */
      }
    }
  }
  async checkForUpdates(packageName?: string): Promise<CapabilityUpdateDto[]> {
    if (
      packageName !== undefined &&
      !packageNameSchema.safeParse(packageName).success
    )
      throw new Error("package_source_invalid");
    const installations =
      packageName === undefined
        ? this.repository.list("capability")
        : [this.repository.getByPackageName(packageName)];
    if (
      installations.some(
        (record) => !record || record.itemKind !== "capability",
      )
    )
      throw new Error("package_not_found");
    const updates: CapabilityUpdateDto[] = [];
    for (const installation of installations) {
      if (!installation?.activeVersion || !valid(installation.activeVersion))
        continue;
      let official;
      if (installation.trust === "official") {
        try {
          official = await (
            this.deps.officialCatalog ?? new OfficialCatalogService()
          ).findCapability(installation.itemId);
        } catch {
          throw new Error("package_download_failed");
        }
        if (
          !official ||
          official.packageName !== installation.packageName ||
          official.capabilityId !== installation.itemId ||
          official.blockedVersions.includes(official.releaseSpec)
        )
          throw new Error("package_blocked");
      }
      let candidate;
      try {
        candidate = await (
          this.deps.metadata ?? new NpmPackageMetadata()
        ).resolve(
          official
            ? `${installation.packageName}@${official.releaseSpec}`
            : installation.packageName,
        );
      } catch (error) {
        const code = packageErrorCodeSchema.safeParse(
          error instanceof Error ? error.message : undefined,
        );
        throw new Error(code.success ? code.data : "package_download_failed");
      }
      if (
        candidate.packageName !== installation.packageName ||
        !valid(candidate.version) ||
        (official && candidate.version !== official.releaseSpec)
      )
        throw new Error("package_manifest_invalid");
      if (!gt(candidate.version, installation.activeVersion)) continue;
      updates.push(
        freeze(
          capabilityUpdateSchema.parse({
            packageName: installation.packageName,
            capabilityId: installation.itemId,
            currentVersion: installation.activeVersion,
            candidateVersion: candidate.version,
            ...((official?.releaseNotes ?? candidate.releaseNotes) !== undefined
              ? {
                  releaseNotes:
                    official?.releaseNotes ?? candidate.releaseNotes,
                }
              : {}),
            downgrade: false,
            requiresReview: true,
            activeRunCount: this.deps.resourceOwner?.()?.activeRuns(installation.itemId).length ?? this.capabilityRepository
              .listSessionCapabilitiesByCapabilityId(installation.itemId)
              .filter((record) => record.status === "active").length,
          }),
        ),
      );
    }
    return updates;
  }

  async listMarketplaceCapabilities(): Promise<CapabilitySummaryDto[]> {
    const officialCatalog = this.deps.officialCatalog ?? new OfficialCatalogService();
    const official = await officialCatalog.load();
    const summaries = new Map<string, CapabilitySummaryDto>(
      listBundledCapabilities().map((entry) => [
        entry.manifest.id,
        toCapabilitySummaryDto(entry, "available"),
      ]),
    );
    // The embedded catalog is metadata for safe migration identity checks, not
    // proof that its npm artifact is published. Only a verified remote/cache
    // catalog may advertise downloadable packages.
    const advertisedEntries =
      official.source === "fallback" ? [] : official.snapshot.entries;
    for (const entry of advertisedEntries) {
      if (summaries.has(entry.capabilityId)) continue;
      summaries.set(
        entry.capabilityId,
        toCapabilitySummaryDto(
          {
            manifest: entry.descriptor.manifest,
            reviewStatus: "official-reviewed",
            trust: "official",
            source: "npm",
            packageName: entry.packageName,
            toolNames: entry.descriptor.tools.map((tool) => tool.name),
            runtime: {
              kind: "managed",
              capabilityId: entry.capabilityId,
              packageName: entry.packageName,
              version: entry.releaseSpec,
              packageRoot: "",
              manifest: "",
              entry: "",
              contentDigest: "",
            },
          },
          "available",
        ),
      );
    }
    for (const installed of this.installedCatalog.list()) {
      const configuration = this.capabilityRepository.getInstallation(installed.record.itemId);
      summaries.set(
        installed.record.itemId,
        {
          ...toCapabilitySummaryDto(
            {
              manifest: installed.descriptor.manifest,
              reviewStatus: installed.record.reviewStatus,
              trust: installed.record.trust,
              source: "npm",
              packageName: installed.record.packageName,
              blocked: installed.record.state === "blocked",
              toolNames: installed.descriptor.tools.map((tool) => tool.name),
              runtime: {
                kind: "managed",
                capabilityId: installed.record.itemId,
                packageName: installed.record.packageName,
                version: installed.record.activeVersion!,
                packageRoot: installed.packageRoot,
                manifest: installed.manifestRelativePath,
                entry: installed.entryRelativePath,
                contentDigest: installed.record.activeContentDigest!,
              },
            },
            installed.record.state === "blocked"
              ? "unavailable"
              : configuration?.configured
                ? "ready"
                : "needs_setup",
          ),
          installationState: installed.record.state === "blocked" ? "blocked" : "installed",
        },
      );
    }
    for (const record of this.repository.list("capability")) {
      if (record.state !== "migration_pending") continue;
      const summary = summaries.get(record.itemId);
      if (summary?.source === "npm")
        summaries.set(record.itemId, {
          ...summary,
          packageName: record.packageName,
          trust: record.trust,
          reviewStatus: record.reviewStatus,
          installationState: "migration_pending",
        });
    }
    return [...summaries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }
  async getInstalledCapability(
    _packageName: string,
  ): Promise<CapabilityDetailDto> {
    throw new Error("package_not_found");
  }
  async inspect(
    input: PackageInspectRequest,
  ): Promise<CapabilityPackageInspectionDto> {
    const parsed = packageInspectRequestSchema.safeParse(input);
    if (!parsed.success) throw input?.intent === "update" ? updateFailure(undefined, "package_source_invalid") : new Error("package_source_invalid");
    const request = parsed.data;
    const id = randomUUID();
    this.actions.set(id, request.intent);
    const controller = new AbortController();
    let inspectedForAccept: InspectedCapabilityPackage | undefined;
    let updateConfiguration: CapabilityUpdateConfiguration | undefined;
    let priorInstallation: ReturnType<
      ManagedPackageRepository["getByPackageName"]
    >;
    let priorConfiguration: ReturnType<
      CapabilityRepository["snapshotInstalledConfiguration"]
    >;
    let updateMetadata: CapabilityUpdateDto | undefined;
    let operationCreated = false;
    const coded = (error: unknown, fallback: PackageErrorCode): Error => {
      const candidate = error instanceof Error ? error.message : undefined;
      const parsed = packageErrorCodeSchema.safeParse(candidate);
      return new Error(parsed.success ? parsed.data : fallback);
    };
    const lease = this.registry.start<
      StagedNpmPackage,
      CapabilityPackageInspectionDto,
      PackageInstallRequest | PackageUpdateRequest,
      CapabilityDetailDto
    >({
      operationId: id,
      acquire: async () => {
        this.repository.beginOperation({
          operationId: id,
          action: request.intent,
          stage: "resolving",
          requestedSpec: request.sourceSpec,
        });
        operationCreated = true;
        try {
          return await this.acquirer.acquire(
            id,
            request.sourceSpec,
            controller.signal,
            (stage) => this.emit(id, stage, "in_progress"),
          );
        } catch (error) {
          throw coded(error, "package_download_failed");
        }
      },
      inspect: async (staged, timing) => {
        if (this.repository.listRemovalRecoveries().some((row) => row.packageName === staged.packageName)) throw new Error("package_busy");
        priorInstallation = this.repository.getByPackageName(
          staged.packageName,
        );
        const officialId =
          request.intent === "update" && priorInstallation?.trust === "official"
            ? priorInstallation.itemId
            : request.officialCapabilityId;
        const official = officialId
          ? await (
              this.deps.officialCatalog ?? new OfficialCatalogService()
            ).findCapability(officialId)
          : undefined;
        if (officialId && !official) throw new Error("package_not_found");
        if (
          request.intent === "update" &&
          official &&
          (official.packageName !== staged.packageName ||
            official.blockedVersions.includes(staged.resolvedVersion))
        )
          throw new Error("package_blocked");
        let inspected: InspectedCapabilityPackage;
        try {
          inspected = await this.inspector.inspect(
            staged,
            official
              ? {
                  trust: "official",
                  reviewStatus: "official-reviewed",
                  officialEntry: official,
                }
              : { trust: "community", reviewStatus: "unreviewed" },
          );
        } catch (error) {
          throw coded(error, "package_manifest_invalid");
        }
        inspectedForAccept = inspected;
        const collision = this.repository.getByItemId(
          "capability",
          inspected.descriptor.manifest.id,
        );
        if (request.intent === "install") {
          if (priorInstallation || collision)
            throw new Error("package_blocked");
        } else {
          if (
            !priorInstallation ||
            priorInstallation.itemKind !== "capability" ||
            priorInstallation.itemId !== inspected.descriptor.manifest.id ||
            collision?.packageName !== staged.packageName ||
            !priorInstallation.activeVersion ||
            priorInstallation.activeVersion === staged.resolvedVersion
          )
            throw new Error("package_update_failed");
          const catalog = this.installedCatalog;
          await catalog.refresh();
          const old = catalog.get(
            priorInstallation.itemId,
            priorInstallation.activeVersion,
          );
          if (!old) throw new Error("package_update_failed");
          priorConfiguration =
            this.capabilityRepository.snapshotInstalledConfiguration(
              priorInstallation.itemId,
            );
          updateConfiguration = planCapabilityUpdateConfiguration(
            old.descriptor.manifest,
            inspected.descriptor.manifest,
            priorConfiguration.settings,
          );
          updateMetadata = capabilityUpdateSchema.parse({
            packageName: staged.packageName,
            capabilityId: priorInstallation.itemId,
            currentVersion: priorInstallation.activeVersion,
            candidateVersion: staged.resolvedVersion,
            releaseNotes: official?.releaseNotes ?? staged.releaseNotes ?? "",
            permissionChanged:
              priorInstallation.acceptedPermissionDigest !==
              inspected.permissionDigest,
            requiresSetup: !updateConfiguration.configured,
            downgrade: lt(
              staged.resolvedVersion,
              priorInstallation.activeVersion,
            ),
            requiresReview: false,
            activeRunCount:
              this.deps.resourceOwner?.()?.activeRuns(priorInstallation.itemId).length ?? this.capabilityRepository.listActiveRunsByCapabilityId(
                priorInstallation.itemId,
              ).length,
          });
        }
        this.repository.markAwaitingConsent(id, {
          packageName: staged.packageName,
          version: staged.resolvedVersion,
          integrity: staged.integrity,
          contentDigest: staged.contentDigest,
        });
        const dto = capabilityPackageInspectionSchema.parse({
          inspectionId: id,
          packageName: staged.packageName,
          requestedSpec: staged.requestedSpec,
          resolvedVersion: staged.resolvedVersion,
          integrity: staged.integrity,
          contentDigest: staged.contentDigest,
          trust: inspected.trust,
          reviewStatus: inspected.reviewStatus,
          releaseNotes: official?.releaseNotes ?? staged.releaseNotes ?? "",
          capability: detail(inspected, false),
          permissionDigest: inspected.permissionDigest,
          expiresAt: new Date(timing.expiresAt).toISOString(),
          ...(updateMetadata ? { update: updateMetadata } : {}),
        });
        this.emit(id, "verifying", "awaiting_consent", {
          packageName: staged.packageName,
          capabilityId: inspected.descriptor.manifest.id,
        });
        return freeze(dto);
      },
      onCancel: () => controller.abort(new Error("package_cancelled")),
      accept: async (payload, staged, owner) => {
        if (
          !inspectedForAccept ||
          payload.acceptedPackageName !== staged.packageName ||
          payload.acceptedVersion !== staged.resolvedVersion ||
          payload.acceptedIntegrity !== staged.integrity ||
          payload.acceptedPermissionDigest !==
            inspectedForAccept.permissionDigest
        )
          throw new Error("package_permission_denied");
        if ((request.intent === "update") !== ("packageName" in payload))
          throw new Error("package_permission_denied");
        const found = inspectedForAccept;
        if (request.intent === "update") {
          const accepted = packageUpdateRequestSchema.parse(payload);
          if (
            accepted.packageName !== staged.packageName ||
            !priorInstallation ||
            !updateMetadata ||
            !updateConfiguration ||
            JSON.stringify(
              this.repository.getByPackageName(staged.packageName),
            ) !== JSON.stringify(priorInstallation) ||
            JSON.stringify(
              this.capabilityRepository.snapshotInstalledConfiguration(
                priorInstallation.itemId,
              ),
            ) !== JSON.stringify(priorConfiguration)
          )
            throw new Error("package_permission_denied");
          if (
            updateMetadata.downgrade &&
            (!accepted.acceptedDowngrade ||
              npa(staged.requestedSpec).type !== "version")
          )
            throw new Error("package_permission_denied");
        }
        try {
          owner.assertHealthy();
        } catch {
          throw new Error("package_busy");
        }
        owner.setPhase?.("verifying");
        let verification;
        try {
          verification = await this.deps.verifier.verify(
            found,
            controller.signal,
          );
        } catch (error) {
          throw coded(error, "package_verification_failed");
        }
        if (controller.signal.aborted)
          throw new Error("package_permission_denied");
        try {
          owner.assertHealthy();
        } catch {
          throw new Error("package_busy");
        }
        if (
          verification.capabilityId !== found.descriptor.manifest.id ||
          verification.version !== found.descriptor.manifest.version ||
          verification.contentDigest !== found.staged.contentDigest ||
          verification.toolNames.length !== found.descriptor.tools.length ||
          verification.toolNames.some(
            (name, index) => name !== found.descriptor.tools[index]?.name,
          )
        )
          throw new Error("package_verification_failed");
        owner.setPhase?.("committing");
        if (request.intent === "update") {
          const accepted = packageUpdateRequestSchema.parse(payload);
          const coordinator = this.deps.sessionCoordinator;
          const resourceOwner=this.deps.resourceOwner?.();
          if (
            !coordinator ||
            !priorInstallation?.activeVersion ||
            !updateConfiguration
          )
            throw new Error("package_update_failed");
          const capabilityId = found.descriptor.manifest.id;
          if (
            updateConfiguration.obsoleteSecretRefs.length &&
            !this.deps.credentials
          )
            throw new Error("package_update_failed");
          const sessionBefore =
            this.capabilityRepository.snapshotSessionCapabilities(capabilityId);
          const runIds = [...(resourceOwner?.activeRuns(capabilityId) ?? coordinator.listActiveRuns(capabilityId))];
          if (runIds.length !== accepted.acceptedActiveRunCount)
            throw new Error("package_permission_denied");
          try {
            if(!resourceOwner)await coordinator.assertRunsIdle(runIds);
          } catch {
            throw new Error("package_update_failed");
          }
          if (
            JSON.stringify(
              [...(resourceOwner?.activeRuns(capabilityId) ?? coordinator.listActiveRuns(capabilityId))].sort(),
            ) !== JSON.stringify([...runIds].sort())
          )
            throw new Error("package_permission_denied");
          owner.assertHealthy();
          if (
            JSON.stringify(
              this.repository.getByPackageName(staged.packageName),
            ) !== JSON.stringify(priorInstallation) ||
            JSON.stringify(
              this.capabilityRepository.snapshotInstalledConfiguration(
                capabilityId,
              ),
            ) !== JSON.stringify(priorConfiguration)
          )
            throw new Error("package_update_failed");
          let commit:
            | Awaited<ReturnType<CapabilityPackageInstaller["commitUpdate"]>>
            | undefined;
          let deactivated = false;
          const recovery = await this.installer.prepareUpdateRecovery(found, updateConfiguration);
          try {
            if (!resourceOwner && !updateConfiguration.configured && runIds.length) {
              await coordinator.deactivateRuns(capabilityId);
              deactivated = true;
            }
            const expectedSessions = this.capabilityRepository.snapshotSessionCapabilities(capabilityId);
            commit = await this.installer.commitUpdate(
              found,
              verification,
              updateConfiguration,
              async () => {
                if(!resourceOwner)await coordinator.assertRunsIdle(runIds);
                owner.assertHealthy();
                if (!this.capabilityRepository.sessionCapabilitiesMatch(capabilityId, expectedSessions.records) ||
                    JSON.stringify(this.repository.getByPackageName(staged.packageName)) !== JSON.stringify(priorInstallation) ||
                    JSON.stringify(this.capabilityRepository.snapshotInstalledConfiguration(capabilityId)) !== JSON.stringify(priorConfiguration))
                  throw new Error("package_update_failed");
              },
            );
            if (!resourceOwner && updateConfiguration.configured && runIds.length)
              await coordinator.reloadRuns(
                capabilityId,
                staged.resolvedVersion,
              );
            owner.assertHealthy();
            if (deactivated) coordinator.finalizeDeactivation(capabilityId);
          } catch {
            if(resourceOwner) {
              try {
                // The Assignment owner has already compensated the package transaction.
                // Close only the package journal after proving its complete prior snapshot.
                await this.installer.assertUpdateRecoveryRestored(recovery);
                this.repository.finishUpdateRecovery(recovery.operationId,recovery.ownerToken);
              } catch {
                this.repository.advanceUpdateRecovery(recovery.operationId,recovery.ownerToken,"conflict","package_update_failed");
                this.repository.quarantineUpdateRecoveries();
                await this.installedCatalog.refresh();
              }
              throw new Error("package_update_failed");
            }
            try {
              if (
                !deactivated &&
                !this.capabilityRepository.sessionCapabilitiesMatch(
                  capabilityId,
                  sessionBefore.records,
                )
              )
                throw new Error("package_update_failed");
              if (commit) await this.installer.restoreUpdate(commit);
              if (deactivated)
                await coordinator.reactivateRuns(
                  capabilityId,
                  priorInstallation.activeVersion,
                );
              else if (commit && runIds.length)
                await coordinator.restoreRuns(
                  capabilityId,
                  priorInstallation.activeVersion,
                );
              await this.installer.assertUpdateRecoveryRestored(recovery);
              this.repository.finishUpdateRecovery(recovery.operationId, recovery.ownerToken);
            } catch {
              this.repository.advanceUpdateRecovery(recovery.operationId, recovery.ownerToken, "conflict", "package_update_failed");
              this.repository.quarantineUpdateRecoveries();
              await this.installedCatalog.refresh();
              throw new Error("package_update_failed");
            }
            throw new Error("package_update_failed");
          }
          this.repository.advanceUpdateRecovery(recovery.operationId, recovery.ownerToken, "cleanup_pending");
          for (const reference of updateConfiguration.obsoleteSecretRefs) {
            try {
              await this.deps.credentials?.removeSecret(reference);
            } catch {
              this.repository.advanceUpdateRecovery(recovery.operationId, recovery.ownerToken, "cleanup_pending", "package_update_failed");
              this.repository.quarantineUpdateRecoveries();
              await this.installedCatalog.refresh();
              throw new Error("package_update_failed");
            }
          }
          // A successful explicit update supersedes earlier quarantined attempts,
          // but their encrypted references remain journaled until cleanup succeeds.
          const retainedRefs = new Set(this.capabilityRepository.getSettings(capabilityId).flatMap((setting) => setting.secretRef ? [setting.secretRef] : []));
          for (const older of this.repository.listUpdateRecoveries().filter((row) => row.packageName === staged.packageName && row.operationId !== recovery.operationId)) {
            this.repository.advanceUpdateRecovery(older.operationId, older.ownerToken, "cleanup_pending");
            try {
              for (const reference of older.obsoleteSecretRefs) {
                if (!retainedRefs.has(reference)) {
                  if (!this.deps.credentials) throw new Error("package_update_failed");
                  await this.deps.credentials.removeSecret(reference);
                }
              }
              this.repository.finishUpdateRecovery(older.operationId, older.ownerToken);
            } catch {
              this.repository.quarantineUpdateRecoveries();
              await this.installedCatalog.refresh();
              throw new Error("package_update_failed");
            }
          }
          if (commit) this.installer.finalizeUpdate(commit);
          this.emit(id, "installing", "completed", {
            packageName: staged.packageName,
            capabilityId,
          });
          return freeze({
            ...detail(found, updateConfiguration.configured),
            activeRunCount: (resourceOwner?.activeRuns(capabilityId) ?? coordinator.listActiveRuns(capabilityId)).length,
          });
        }
        let record;
        try {
          record = await this.installer.commitFresh(found, verification);
        } catch (error) {
          throw coded(error, "package_install_failed");
        }
        const configured =
          record.state === "installed" &&
          Boolean(
            this.capabilityRepository.getInstallation(
              found.descriptor.manifest.id,
            )?.configured,
          );
        this.emit(id, "installing", "completed", {
          packageName: staged.packageName,
          capabilityId: found.descriptor.manifest.id,
        });
        return detail(found, configured);
      },
      terminal: (outcome) => {
        if (!operationCreated || outcome.reason === "completed") return;
        if (outcome.reason === "cancelled") this.repository.cancelOperation(id);
        else this.repository.failOperationCoherently(id, outcome.code);
        this.emit(
          id,
          inspectedForAccept ? "verifying" : "resolving",
          outcome.reason === "cancelled" ? "cancelled" : "failed",
          {
            ...(inspectedForAccept
              ? {
                  packageName: inspectedForAccept.staged.packageName,
                  capabilityId: inspectedForAccept.descriptor.manifest.id,
                }
              : {}),
            ...(outcome.reason !== "cancelled"
              ? { errorCode: outcome.code }
              : {}),
          },
        );
      },
      cleanup: async () => {
        try {
          if (operationCreated) await this.acquirer.discard(id);
        } finally {
          this.actions.delete(id);
        }
      },
    });
    return request.intent === "update" ? lease.ready.catch((error: unknown) => { throw updateFailure(error); }) : lease.ready;
  }
  async install(input: PackageInstallRequest): Promise<CapabilityDetailDto> {
    // Reject the update discriminator before the compatible schema strips unknown fields.
    if (input && typeof input === "object" && "packageName" in input)
      throw updateFailure(undefined, "package_permission_denied");
    const parsed = packageInstallRequestSchema.safeParse(input);
    if (!parsed.success) throw updateFailure(undefined, "package_permission_denied");
    const request = parsed.data;
    return this.registry.accept(request.inspectionId, request);
  }
  async update(input: PackageUpdateRequest): Promise<CapabilityDetailDto> {
    const parsed = packageUpdateRequestSchema.safeParse(input);
    if (!parsed.success) throw updateFailure(undefined, "package_permission_denied");
    const request = parsed.data;
    try { return await this.registry.accept(request.inspectionId, request); }
    catch (error) { throw updateFailure(error); }
  }
  inspectRemoval(input: PackageRemovalInspectRequest): Promise<CapabilityRemovalInspection> { return this.removal.inspect(input); }
  remove(input: PackageRemoveRequest): Promise<void> { return this.removal.remove(input); }
  async cancel(operationId: string) {
    return this.registry.cancel(operationId);
  }
  async reconcileWebSearchMigration(signal: AbortSignal): Promise<WebSearchMigrationResult> {
    return this.deps.webSearchMigration?.reconcile(signal) ?? "not_needed";
  }
  async retryPendingMigrations(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await this.deps.webSearchMigration?.retry(signal);
  }
  async reconcileInterruptedOperations() {
    return this.lock.runExclusive(async (owner) => {
    owner.assertHealthy();
    await this.removal.reconcile(owner);
    // Incomplete provider/filesystem compensation is never guessed at after restart.
    // Keep the snapshots and both executable versions available for explicit recovery.
    this.repository.quarantineUpdateRecoveries();
    await this.installedCatalog.refresh();
    const recoveries = this.repository.listUpdateRecoveries().sort((left, right) => {
      const current = (row: typeof left) => this.repository.getByPackageName(row.packageName)?.activeVersion === row.candidatePointer.version ? 1 : 0;
      return current(left) - current(right);
    });
    for (const recovery of recoveries) {
      if (recovery.stage !== "cleanup_pending" || !this.deps.credentials) continue;
      try {
        const retained = new Set(this.capabilityRepository.getSettings(recovery.capabilityId).flatMap((setting) => setting.secretRef ? [setting.secretRef] : []));
        for (const reference of recovery.obsoleteSecretRefs) if (!retained.has(reference)) await this.deps.credentials.removeSecret(reference);
        this.repository.completeRecoveredCleanup(recovery.operationId, recovery.ownerToken);
      } catch {
        this.repository.advanceUpdateRecovery(recovery.operationId, recovery.ownerToken, "cleanup_pending", "package_update_failed");
      }
    }
    await this.installedCatalog.refresh();
    owner.assertHealthy();
    });
  }
}
