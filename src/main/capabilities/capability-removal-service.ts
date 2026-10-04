import type { CapabilityResourceOwner } from "./capability-resource-owner";
import { randomUUID } from "node:crypto";
import { capabilityRemovalInspectionSchema, packageRemovalInspectRequestSchema, packageRemoveRequestSchema, packageErrorCodeSchema, type CapabilityRemovalInspection, type PackageRemovalInspectRequest, type PackageRemoveRequest, type CapabilityDistributionProgress } from "../../shared/packages/schemas";
import type { RemovalRecovery } from "../../shared/packages/removal-recovery";
import { ManagedPackageRepository } from "../packages/package-repository";
import { CapabilityRepository } from "./capability-repository";
import type { InstalledCapabilityCatalog } from "./installed-catalog";
import type { CapabilitySessionPackageCoordinator } from "./capability-session-package-coordinator";
import type { CapabilityCredentialStore } from "./capability-credential-store";
import { ConsentLeaseRegistry, type PackageLockOwner } from "./consent-lease-registry";
import { CapabilityRemovalInstaller, serialRemovalConfiguration, serialRemovalInstallation } from "./capability-removal-installer";

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const safe = (cause?: unknown, fallback = "package_remove_failed") => {
  const parsed = packageErrorCodeSchema.safeParse(cause instanceof Error ? cause.message : fallback);
  const code = parsed.success ? parsed.data : "package_remove_failed";
  const error = Object.assign(new Error(code), { code }); error.stack = undefined; return Object.freeze(error);
};
export class CapabilityRemovalService {
  constructor(private readonly deps: {
    repository: ManagedPackageRepository; capabilities: CapabilityRepository;
    catalog: Pick<InstalledCapabilityCatalog, "get" | "refresh">;
    coordinator?: CapabilitySessionPackageCoordinator;
    resourceOwner?():CapabilityResourceOwner|undefined;
    credentials?: Pick<CapabilityCredentialStore, "removeSecret">;
    registry: ConsentLeaseRegistry; installer: CapabilityRemovalInstaller;
    emit(operationId: string, stage: CapabilityDistributionProgress["stage"], status: CapabilityDistributionProgress["status"], extra?: Partial<CapabilityDistributionProgress>): void;
  }) {}
  async inspect(input: PackageRemovalInspectRequest): Promise<CapabilityRemovalInspection> {
    const parsed = packageRemovalInspectRequestSchema.safeParse(input);
    if (!parsed.success) throw safe(undefined, "package_source_invalid");
    const { repository, capabilities, coordinator, registry, catalog } = this.deps;
    const resourceOwner=this.deps.resourceOwner?.();
    const upfront = repository.getByPackageName(parsed.data.packageName);
    if (!upfront || upfront.itemKind !== "capability") throw safe(undefined, "package_not_found");
    if (!coordinator) throw safe();
    try { coordinator.assertManagedCapability(upfront.itemId); } catch { throw safe(undefined, "package_blocked"); }
    const operationId = randomUUID(); let created = false;
    const lease = registry.start({
      operationId,
      acquire: async () => {
        const installation = repository.getByPackageName(parsed.data.packageName);
        if (!installation || installation.itemKind !== "capability" || !installation.activeVersion || !installation.activeIntegrity || !installation.activeContentDigest) throw safe(undefined, "package_not_found");
        if (repository.listRemovalRecoveries().some((row) => row.packageName === installation.packageName)) throw safe(undefined, "package_busy");
        coordinator.assertManagedCapability(installation.itemId);
        if (!catalog.get(installation.itemId, installation.activeVersion)) throw safe(undefined, "package_not_found");
        repository.beginOperation({ operationId, action: "remove", stage: "removing", packageName: installation.packageName, requestedSpec: installation.requestedSpec }); created = true;
        return { installation, configuration: capabilities.snapshotInstalledConfiguration(installation.itemId), sessions: capabilities.snapshotSessionCapabilities(installation.itemId), runIds:resourceOwner?.activeRuns(installation.itemId) ?? coordinator.listActiveRuns(installation.itemId) };
      },
      inspect: (review, timing) => {
        const installation = review.installation;
        const count = review.runIds.length;
        repository.markAwaitingConsent(operationId, { packageName: installation.packageName, version: installation.activeVersion!, integrity: installation.activeIntegrity!, contentDigest: installation.activeContentDigest! });
        this.deps.emit(operationId, "removing", "awaiting_consent", { action: "remove", packageName: installation.packageName, capabilityId: installation.itemId, activeRunCount: count });
        return Object.freeze(capabilityRemovalInspectionSchema.parse({ inspectionId: operationId, packageName: installation.packageName, capabilityId: installation.itemId, activeVersion: installation.activeVersion, activeIntegrity: installation.activeIntegrity, activeContentDigest: installation.activeContentDigest, activeRunCount: count, expiresAt: new Date(timing.expiresAt).toISOString() }));
      },
      accept: async (payload: PackageRemoveRequest, review, owner) => {
        const accepted = packageRemoveRequestSchema.safeParse(payload);
        const installation = review.installation, capabilityId = installation.itemId;
        const runIds = [...review.runIds];
        if (!accepted.success || accepted.data.inspectionId !== operationId || accepted.data.packageName !== installation.packageName || accepted.data.acceptedActiveVersion !== installation.activeVersion || accepted.data.acceptedActiveRunCount !== runIds.length) throw safe(undefined, "package_permission_denied");
        const assertReviewed = () => {
          const current = repository.getByPackageName(installation.packageName);
          if (!current || !same(serialRemovalInstallation(current), serialRemovalInstallation(installation)) || !same(serialRemovalConfiguration(capabilities.snapshotInstalledConfiguration(capabilityId)), serialRemovalConfiguration(review.configuration)) || !capabilities.sessionCapabilitiesMatch(capabilityId, review.sessions.records)) throw safe(undefined, "package_permission_denied");
        };
        assertReviewed(); if(!resourceOwner)await coordinator.assertRunsIdle(runIds); assertReviewed(); owner.assertHealthy();
        if (review.configuration.settings.some((setting) => setting.secretRef) && !this.deps.credentials) throw safe();
        owner.setPhase?.("committing");
        const recovery = await this.deps.installer.prepare(operationId, installation, review.configuration, review.sessions);
        if(resourceOwner) {
          if(!same(resourceOwner.activeRuns(capabilityId),review.runIds))throw safe(undefined,"package_permission_denied");
          try {
            await this.deps.installer.commit(recovery,async()=>{owner.assertHealthy();if(!capabilities.sessionCapabilitiesMatch(capabilityId,review.sessions.records))throw safe();});
            await this.cleanup(recovery,owner);
            this.deps.emit(operationId,"removing","completed",{action:"remove",packageName:installation.packageName,capabilityId,activeRunCount:runIds.length});
            return;
          } catch {
            repository.advanceRemovalRecovery(operationId,recovery.ownerToken,"conflict","package_remove_failed");
            repository.quarantineRemovalRecoveries();
            await catalog.refresh();
            throw safe();
          }
        }
        let deactivated = false;
        let expectedSessions = review.sessions;
        try {
          assertReviewed();
          if (runIds.length) { await coordinator.deactivateRuns(capabilityId); deactivated = true; }
          expectedSessions = capabilities.snapshotSessionCapabilities(capabilityId);
          await this.deps.installer.commit(recovery, async () => {
            await coordinator.assertRunsIdle(runIds); owner.assertHealthy();
            if (!capabilities.sessionCapabilitiesMatch(capabilityId, expectedSessions.records) || coordinator.listActiveRuns(capabilityId).length !== 0) throw safe();
          });
          repository.advanceRemovalRecovery(operationId, recovery.ownerToken, "cleanup_pending");
          if (deactivated) coordinator.finalizeDeactivation(capabilityId);
        } catch {
          try {
            if (!capabilities.sessionCapabilitiesMatch(capabilityId, expectedSessions.records)) throw safe();
            await this.deps.installer.restore(recovery);
            if (deactivated) await coordinator.reactivateRuns(capabilityId, installation.activeVersion!, runIds);
            if (!capabilities.sessionCapabilitiesMatch(capabilityId, review.sessions.records)) throw safe();
            await this.deps.installer.cleanup(recovery);
            repository.finishRemovalRecovery(operationId, recovery.ownerToken);
          } catch {
            repository.advanceRemovalRecovery(operationId, recovery.ownerToken, "conflict", "package_remove_failed");
            repository.quarantineRemovalRecoveries();
            try { await catalog.refresh(); } catch { /* Durable journal and DB activation gate remain authoritative. */ }
          }
          throw safe();
        }
        await this.cleanup(recovery, owner);
        this.deps.emit(operationId, "removing", "completed", { action: "remove", packageName: installation.packageName, capabilityId, activeRunCount: runIds.length });
      },
      terminal: (outcome) => {
        if (!created || outcome.reason === "completed") return;
        if (outcome.reason === "cancelled") repository.cancelOperation(operationId);
        else repository.failOperationCoherently(operationId, outcome.code);
        this.deps.emit(operationId, "removing", outcome.reason === "cancelled" ? "cancelled" : "failed", { action: "remove", packageName: upfront.packageName, capabilityId: upfront.itemId, ...(outcome.reason !== "cancelled" ? { errorCode: outcome.code } : {}) });
      },
      cleanup: async () => { /* Removal cleanup is journal-owned, never npm acquisition cleanup. */ },
    });
    try { return await lease.ready; } catch (error) { throw safe(error); }
  }
  async remove(input: PackageRemoveRequest): Promise<void> {
    const parsed = packageRemoveRequestSchema.safeParse(input);
    if (!parsed.success) throw safe(undefined, "package_permission_denied");
    try { await this.deps.registry.accept(parsed.data.inspectionId, parsed.data); } catch (error) { throw safe(error); }
  }
  private async cleanup(row: RemovalRecovery, owner: PackageLockOwner): Promise<void> {
    try {
      owner.assertHealthy();
      if (this.deps.repository.getByPackageName(row.packageName)) throw safe();
      await this.deps.installer.cleanup(row);
      const retained = new Set(this.deps.capabilities.getSettings(row.capabilityId).flatMap((setting) => "secretRef" in setting ? [setting.secretRef] : []));
      for (const setting of row.configuration.settings) {
        if ("secretRef" in setting && !retained.has(setting.secretRef)) {
          if (!this.deps.credentials) throw safe();
          await this.deps.credentials.removeSecret(setting.secretRef);
        }
      }
      owner.assertHealthy();
      this.deps.repository.completeRemovalOperation(row.operationId);
      this.deps.repository.finishRemovalRecovery(row.operationId, row.ownerToken);
    } catch {
      this.deps.repository.advanceRemovalRecovery(row.operationId, row.ownerToken, "cleanup_pending", "package_remove_failed");
      throw safe();
    }
  }
  async reconcile(owner: PackageLockOwner): Promise<void> {
    this.deps.repository.quarantineRemovalRecoveries();
    for (const row of this.deps.repository.listRemovalRecoveries()) {
      if (row.stage !== "cleanup_pending") continue;
      await this.cleanup(row, owner);
    }
  }
}
