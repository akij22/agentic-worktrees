import type { CapabilityResourceOwner } from "./capability-resource-owner";
import { randomUUID } from "node:crypto";
import { updateRecoverySchema, type UpdateRecovery } from "../../shared/packages/update-recovery";
import type { CapabilityUpdateConfiguration } from "./capability-update-configuration";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import type { InspectedCapabilityPackage } from "./package-inspector";
import type { CapabilityExecutableVerification } from "./package-verifier";
import type { ManagedPackageInstallationRecord, PackageOperationRecord } from "../../shared/packages/schemas";
import { ManagedPackageRepository } from "../packages/package-repository";
import { digestPackageTree } from "../packages/content-digest";
import type { ManagedPackageLayout } from "../packages/storage-layout";
import type { CapabilityRepository, InstalledConfigurationSnapshot } from "./capability-repository";

function isEnoent(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
export function isUnsupportedDirectorySyncError(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32" || typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["EPERM", "EINVAL", "ENOTSUP", "EISDIR", "ENOSYS"].includes(String(error.code));
}

export interface InstallerFileSystem {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  stat(path: string): ReturnType<typeof stat>;
  open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  writeFile(path: string, data: string | Buffer, options?: { mode: number }): Promise<void>;
  rm(path: string, options: { force: true; recursive?: true }): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

const realFileSystem: InstallerFileSystem = {
  mkdir, rename, readFile: (path) => readFile(path), stat, open, writeFile, rm,
  async syncDirectory(path) {
    let handle: FileHandle | undefined;
    try { handle = await open(path, "r"); await handle.sync(); }
    catch (error) { if (!isUnsupportedDirectorySyncError(error)) throw error; }
    finally { await handle?.close(); }
  },
};
export interface InstallerHooks {
  resourceOwner?():CapabilityResourceOwner|undefined;
  verifyCommittedPath?: (path: string, expectedDigest: string) => Promise<void>;
  refreshCatalog?: () => Promise<void>;
  fs?: InstallerFileSystem;
  logger?: (code: "package_install_cleanup_failed") => void;
}

export interface CapabilityUpdateCommit {
  readonly operationId: string;
  readonly ownerToken: string;
  readonly previous: ManagedPackageInstallationRecord;
  readonly current: ManagedPackageInstallationRecord;
}
export class CapabilityPackageInstaller {
  private readonly updates = new Map<CapabilityUpdateCommit, {
    pointer: Buffer;
    configuration: InstalledConfigurationSnapshot;
    expectedConfiguration: InstalledConfigurationSnapshot;
    expectedPointer: Buffer;
    operationId: string;
  }>();
  async prepareUpdateRecovery(inspected: InspectedCapabilityPackage, configuration: CapabilityUpdateConfiguration): Promise<UpdateRecovery> {
    const existing = this.repository.listUpdateRecoveries().find((row) => row.operationId === inspected.staged.operationId);
    if (existing) return existing;
    const previous = this.repository.getByPackageName(inspected.staged.packageName);
    if (!previous) throw new Error("package_update_failed");
    const before = this.capabilityRepository.snapshotInstalledConfiguration(previous.itemId);
    try {
      const pointer = JSON.parse((await (this.hooks.fs ?? realFileSystem).readFile(`${this.layout.activePointerPath(previous.itemId)}.json`)).toString());
      const recovery = updateRecoverySchema.parse({
        operationId: inspected.staged.operationId, ownerToken: randomUUID(), packageName: previous.packageName, capabilityId: previous.itemId, stage: "prepared",
        previousPointer: pointer,
        candidatePointer: { packageName: inspected.staged.packageName, capabilityId: previous.itemId, version: inspected.staged.resolvedVersion, integrity: inspected.staged.integrity, contentDigest: inspected.staged.contentDigest, manifestPath: inspected.packageMetadata.manifest, entryPath: inspected.packageMetadata.entry },
        previousInstallation: { ...previous, createdAt: previous.createdAt.getTime(), updatedAt: previous.updatedAt.getTime() },
        configuration: { ...before, installation: before.installation ? { ...before.installation, createdAt: before.installation.createdAt.getTime(), updatedAt: before.installation.updatedAt.getTime() } : undefined },
        sessions: this.capabilityRepository.snapshotSessionCapabilities(previous.itemId).records,
        obsoleteSecretRefs: configuration.obsoleteSecretRefs,
      });
      this.repository.createUpdateRecovery(recovery);
      return recovery;
    } catch { throw new Error("package_update_failed"); }
  }
  async commitUpdate(inspected: InspectedCapabilityPackage, verification: CapabilityExecutableVerification, configuration: CapabilityUpdateConfiguration, assertSessionsCurrent?: () => Promise<void>): Promise<CapabilityUpdateCommit> {
    const fs = this.hooks.fs ?? realFileSystem;
    const previous = this.repository.getByPackageName(inspected.staged.packageName);
    if (this.repository.snapshotOperation(inspected.staged.operationId)?.action !== "update") throw new Error("package_update_failed");
    if (!previous || previous.itemKind !== "capability" || previous.itemId !== inspected.descriptor.manifest.id || previous.activeVersion === inspected.staged.resolvedVersion)
      throw new Error("package_update_failed");
    const before = this.capabilityRepository.snapshotInstalledConfiguration(previous.itemId);
    let pointer: Buffer;
    try { pointer = await fs.readFile(`${this.layout.activePointerPath(previous.itemId)}.json`); }
    catch { throw new Error("package_update_failed"); }
    if (JSON.stringify(this.repository.getByPackageName(previous.packageName)) !== JSON.stringify(previous) ||
        JSON.stringify(this.capabilityRepository.snapshotInstalledConfiguration(previous.itemId)) !== JSON.stringify(before))
      throw new Error("package_update_failed");
    const recovery = await this.prepareUpdateRecovery(inspected, configuration);
    try {
      const current = await this.commitFresh(inspected, verification, configuration, assertSessionsCurrent);
      if(!this.hooks.resourceOwner?.())this.repository.advanceUpdateRecovery(recovery.operationId, recovery.ownerToken, "committed");
      const commit = Object.freeze({ operationId: recovery.operationId, ownerToken: recovery.ownerToken, previous, current });
      this.updates.set(commit, { pointer, configuration: before,
        expectedConfiguration: this.capabilityRepository.snapshotInstalledConfiguration(previous.itemId),
        expectedPointer: Buffer.from(JSON.stringify({ packageName: inspected.staged.packageName, capabilityId: previous.itemId, version: inspected.staged.resolvedVersion, integrity: inspected.staged.integrity, contentDigest: inspected.staged.contentDigest, manifestPath: inspected.packageMetadata.manifest, entryPath: inspected.packageMetadata.entry })),
        operationId: inspected.staged.operationId });
      return commit;
    } catch {
      try { await this.hooks.refreshCatalog?.(); } catch { throw new Error("package_update_failed"); }
      throw new Error("package_update_failed");
    }
  }
  async restoreUpdate(commit: CapabilityUpdateCommit): Promise<void> {
    const snapshot = this.updates.get(commit);
    if (!snapshot) throw new Error("package_update_failed");
    const fs = this.hooks.fs ?? realFileSystem;
    const pointer = `${this.layout.activePointerPath(commit.previous.itemId)}.json`;
    const matches = () => JSON.stringify(this.repository.getByPackageName(commit.current.packageName)) === JSON.stringify(commit.current) &&
      JSON.stringify(this.capabilityRepository.snapshotInstalledConfiguration(commit.current.itemId)) === JSON.stringify(snapshot.expectedConfiguration);
    try {
      const temporary = `${pointer}.${commit.ownerToken}.restore`;
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(snapshot.pointer); await handle.sync(); } finally { await handle.close(); }
      if (!(await fs.readFile(pointer)).equals(snapshot.expectedPointer) || !matches()) {
        await fs.rm(temporary, { force: true });
        throw new Error();
      }
      this.repository.advanceUpdateRecovery(commit.operationId, commit.ownerToken, "recovering");
      // PackageLock serializes cooperating writers. The comparison above cannot
      // provide filesystem CAS against an uncooperative writer; preserve atomic rename.
      await fs.rename(temporary, pointer);
      await fs.syncDirectory(dirname(pointer));
      this.runInTransaction(() => {
        if (!matches()) throw new Error("package_update_failed");
        this.repository.restoreInstallation(commit.previous.packageName, commit.previous);
        this.capabilityRepository.restoreInstalledConfiguration(snapshot.configuration);
        this.repository.failOperationCoherently(snapshot.operationId, "package_update_failed");
      });
      await this.hooks.refreshCatalog?.();
      this.updates.delete(commit);
    } catch { throw new Error("package_update_failed"); }
  }
  async assertUpdateRecoveryRestored(recovery: UpdateRecovery): Promise<void> {
    try {
      await this.hooks.refreshCatalog?.();
      const pointer = JSON.parse((await (this.hooks.fs ?? realFileSystem).readFile(`${this.layout.activePointerPath(recovery.capabilityId)}.json`)).toString());
      const record = this.repository.getByPackageName(recovery.packageName);
      const config = this.capabilityRepository.snapshotInstalledConfiguration(recovery.capabilityId);
      const normalizedRecord = record ? { ...record, createdAt: record.createdAt.getTime(), updatedAt: record.updatedAt.getTime() } : undefined;
      const normalizedConfiguration = { ...config, installation: config.installation ? { ...config.installation, createdAt: config.installation.createdAt.getTime(), updatedAt: config.installation.updatedAt.getTime() } : undefined };
      if (JSON.stringify(pointer) !== JSON.stringify(recovery.previousPointer) ||
          JSON.stringify(normalizedRecord) !== JSON.stringify(recovery.previousInstallation) ||
          JSON.stringify(normalizedConfiguration) !== JSON.stringify(recovery.configuration) ||
          !this.capabilityRepository.sessionCapabilitiesMatch(recovery.capabilityId, recovery.sessions)) throw new Error();
    } catch { throw new Error("package_update_failed"); }
  }
  finalizeUpdate(commit: CapabilityUpdateCommit): void {
    this.repository.finishUpdateRecovery(commit.operationId, commit.ownerToken);
    this.updates.delete(commit);
  }

  constructor(private readonly layout: ManagedPackageLayout, private readonly repository: ManagedPackageRepository, private readonly capabilityRepository: CapabilityRepository, private readonly runInTransaction: <T>(work: () => T) => T, private readonly hooks: InstallerHooks = {}) {}
  async commitFresh(inspected: InspectedCapabilityPackage, verification: CapabilityExecutableVerification, configuration?: CapabilityUpdateConfiguration, assertSessionsCurrent?: () => Promise<void>, preserveExistingConfiguration = false): Promise<ManagedPackageInstallationRecord> {
    const fs = this.hooks.fs ?? realFileSystem; const s = inspected.staged; const capabilityId = inspected.descriptor.manifest.id;
    const destination = this.layout.packageVersionRoot(capabilityId, s.resolvedVersion); const pointer = `${this.layout.activePointerPath(capabilityId)}.json`; const temp = `${pointer}.${process.pid}.tmp`;
    let snapshotsComplete = false; let operationSnapshot: PackageOperationRecord | undefined; let previousPointer: Buffer | undefined;
    let previousInstallation: ManagedPackageInstallationRecord | undefined; let previousConfiguration: InstalledConfigurationSnapshot | undefined;
    let expectedPointer: Buffer | undefined;
    const updatePointerMatches = async () => {
      if (!configuration) return true;
      try { return (await fs.readFile(pointer)).equals(expectedPointer ?? Buffer.alloc(0)); }
      catch { return false; }
    };
    let expectedUpdateInstallation: ManagedPackageInstallationRecord | undefined;
    let expectedUpdateConfiguration: InstalledConfigurationSnapshot | undefined;
    const updateStateMatches = () => !configuration || (JSON.stringify(this.repository.getByPackageName(s.packageName)) === JSON.stringify(expectedUpdateInstallation) && JSON.stringify(this.capabilityRepository.snapshotInstalledConfiguration(capabilityId)) === JSON.stringify(expectedUpdateConfiguration));
    let destinationExisted = false; let destinationDigest: string | undefined; let destinationOwnedByAttempt = false;
    const readOptional = async (path: string) => { try { return await fs.readFile(path); } catch (error) { if (isEnoent(error)) return undefined; throw error; } };
    const statOptional = async (path: string) => { try { return await fs.stat(path); } catch (error) { if (isEnoent(error)) return undefined; throw error; } };
    const owner=this.hooks.resourceOwner?.();
    let record:ManagedPackageInstallationRecord|undefined;
    let rollbackPromise:Promise<void>|undefined;
    const stage=async()=>{
      operationSnapshot = this.repository.snapshotOperation(s.operationId); if (!operationSnapshot) throw new Error("package_install_failed");
      if (verification.contentDigest !== s.contentDigest || verification.capabilityId !== capabilityId || verification.version !== s.resolvedVersion) throw new Error("package_verification_failed");
      previousInstallation = this.repository.getByPackageName(s.packageName); previousConfiguration = this.capabilityRepository.snapshotInstalledConfiguration(capabilityId); expectedUpdateInstallation = previousInstallation; expectedUpdateConfiguration = previousConfiguration;
      const existing = await statOptional(destination); destinationExisted = existing !== undefined; if (existing) destinationDigest = await digestPackageTree(destination);
      previousPointer = await readOptional(pointer); expectedPointer = previousPointer; snapshotsComplete = true;
      if (destinationExisted) { if (destinationDigest !== s.contentDigest) throw new Error("package_install_failed"); }
      else { await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 }); await fs.rename(s.packageRoot, destination); destinationOwnedByAttempt = true; }
      if ((await digestPackageTree(destination)) !== s.contentDigest) throw new Error("package_verification_failed");
      await this.hooks.verifyCommittedPath?.(destination, s.contentDigest);
      const data = { packageName: s.packageName, capabilityId, version: s.resolvedVersion, integrity: s.integrity, contentDigest: s.contentDigest, manifestPath: inspected.packageMetadata.manifest, entryPath: inspected.packageMetadata.entry };
      await fs.mkdir(this.layout.activeRoot, { recursive: true, mode: 0o700 });
      const file = await fs.open(temp, "w", 0o600); try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
      await assertSessionsCurrent?.();
      if (!updateStateMatches() || !(await updatePointerMatches())) throw new Error("package_update_failed");
      // Atomic publication under PackageLock; foreign writers do not participate in CAS.
      await fs.rename(temp, pointer);
      expectedPointer = Buffer.from(JSON.stringify(data));
      await fs.syncDirectory(dirname(pointer));
      await assertSessionsCurrent?.();
    };
    const commit=()=>{
      record = this.runInTransaction(() => { if (!updateStateMatches()) throw new Error("package_update_failed"); if (configuration) this.capabilityRepository.saveConfiguration({ capabilityId, version: s.resolvedVersion, permissionDigest: inspected.permissionDigest, configured: configuration.configured }, configuration.settings); else if (!preserveExistingConfiguration) this.capabilityRepository.initializeInstalledConfiguration(inspected.descriptor.manifest, inspected.permissionDigest); return this.repository.commitInstallation(s.operationId, { packageName: s.packageName, itemKind: "capability", itemId: capabilityId, requestedSpec: s.requestedSpec, activeVersion: s.resolvedVersion, activeIntegrity: s.integrity, activeContentDigest: s.contentDigest, trust: inspected.trust, reviewStatus: inspected.reviewStatus, permissionDigest: inspected.permissionDigest, state: "installed" }); });
      expectedUpdateInstallation=record;expectedUpdateConfiguration=this.capabilityRepository.snapshotInstalledConfiguration(capabilityId);
      const recovery=this.repository.listUpdateRecoveries().find(row=>row.operationId === s.operationId);
      if(owner && recovery)this.repository.advanceUpdateRecovery(recovery.operationId,recovery.ownerToken,"cleanup_pending");
    };
    const rollback=()=>rollbackPromise ??= (async()=>{
      if (configuration && snapshotsComplete && (!updateStateMatches() || !(await updatePointerMatches()))) {
        console.error("package_update_rollback_conflict");
        throw new Error("package_update_failed");
      }
      const expected = { operationId: s.operationId, packageName: s.packageName, requestedSpec: s.requestedSpec }; let cleanupFailed = false;
      if (!snapshotsComplete) { if (operationSnapshot) { try { this.repository.compensateFailedInstall(operationSnapshot, expected, "package_install_failed"); } catch { cleanupFailed = true; } } }
      else if (operationSnapshot && previousConfiguration) {
        try { this.runInTransaction(() => { this.repository.restoreInstallation(s.packageName, previousInstallation); this.capabilityRepository.restoreInstalledConfiguration(previousConfiguration!); this.repository.compensateFailedInstall(operationSnapshot!, expected, "package_install_failed"); }); } catch { cleanupFailed = true; }
        try { if (previousPointer !== undefined) await fs.writeFile(pointer, previousPointer, { mode: 0o600 }); else await fs.rm(pointer, { force: true }); } catch { cleanupFailed = true; }
        try { await fs.rm(temp, { force: true }); } catch { cleanupFailed = true; }
        if (destinationOwnedByAttempt) { try { await fs.rm(destination, { recursive: true, force: true }); } catch { cleanupFailed = true; } }
      }
      if (cleanupFailed && operationSnapshot) {
        try { this.runInTransaction(() => { this.repository.markInstallationInvalid({ packageName: s.packageName, itemKind: "capability", itemId: capabilityId, requestedSpec: s.requestedSpec, activeVersion: s.resolvedVersion, activeIntegrity: s.integrity, activeContentDigest: s.contentDigest, trust: inspected.trust, reviewStatus: inspected.reviewStatus, permissionDigest: inspected.permissionDigest, state: "invalid" }, "package_install_failed"); this.repository.failOperationCoherently(s.operationId, "package_install_failed"); }); } catch { /* startup reconciliation still has the original operation */ }
        (this.hooks.logger ?? ((code) => console.error(code)))("package_install_cleanup_failed");
      }
      if(cleanupFailed)throw new Error("package_install_cleanup_failed");
      if(owner)await this.hooks.refreshCatalog?.();
    })();
    const finalize=async()=>{await this.hooks.refreshCatalog?.();if(!updateStateMatches())throw new Error("package_update_failed");};
    try {
      if(owner)await owner.publish(inspected,configuration,{stage,commit,rollback,finalize});
      else {await stage();commit();await finalize();}
      if(!record)throw new Error("package_install_failed");
      return record;
    } catch(cause) {
      // A committed Assignment cannot be undone by restoring only the package row.
      if(owner && record && JSON.stringify(this.repository.getByPackageName(s.packageName))===JSON.stringify(record)) {
        this.repository.markInstallationInvalid({...record,activeVersion:s.resolvedVersion,activeIntegrity:s.integrity,activeContentDigest:s.contentDigest,permissionDigest:inspected.permissionDigest,state:"invalid"},"package_install_failed");
        throw new Error("package_install_failed");
      }
      try {await rollback();} catch {console.error("package_install_cleanup_failed");}
      const message=cause instanceof Error && cause.message === "package_verification_failed" ? "package_verification_failed" : "package_install_failed";
      throw new Error(message);

    }
  }
}
