import type { CapabilityResourceOwner } from "./capability-resource-owner";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { ManagedPackageInstallationRecord } from "../../shared/packages/schemas";
import { removalRecoverySchema, type RemovalRecovery } from "../../shared/packages/removal-recovery";
import type { ManagedPackageLayout } from "../packages/storage-layout";
import { ManagedPackageRepository } from "../packages/package-repository";
import { digestPackageTree } from "../packages/content-digest";
import { CapabilityRepository, type InstalledConfigurationSnapshot, type SessionCapabilitySnapshot } from "./capability-repository";

export const serialRemovalInstallation = (record: ManagedPackageInstallationRecord) => ({ ...record, createdAt: record.createdAt.getTime(), updatedAt: record.updatedAt.getTime() });
export const serialRemovalConfiguration = (snapshot: InstalledConfigurationSnapshot) => ({ ...snapshot, installation: snapshot.installation ? { ...snapshot.installation, createdAt: snapshot.installation.createdAt.getTime(), updatedAt: snapshot.installation.updatedAt.getTime() } : undefined });
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const absent = (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
export interface RemovalInstallerHooks { resourceOwner?():CapabilityResourceOwner|undefined; refreshCatalog(): Promise<void>; fs?: Partial<Pick<typeof fs, "rename" | "rm" | "readFile" | "mkdir" | "lstat" | "readdir">>; }

/** Removal uses reversible pointer/GC renames. Physical GC is post-commit cleanup. */
export class CapabilityRemovalInstaller {
  private readonly files;
  constructor(private readonly layout: ManagedPackageLayout, private readonly repository: ManagedPackageRepository, private readonly capabilities: CapabilityRepository, private readonly transaction: <T>(work: () => T) => T, private readonly hooks: RemovalInstallerHooks) { this.files = { ...fs, ...hooks.fs }; }
  private pointer(row: RemovalRecovery) { return `${this.layout.activePointerPath(row.capabilityId)}.json`; }
  private staging(row: RemovalRecovery) { return join(this.layout.stagingOperationRoot(row.operationId), `removal-${row.ownerToken}`); }
  private async exists(path: string): Promise<boolean> { try { await this.files.lstat(path); return true; } catch (error) { if (absent(error)) return false; throw error; } }
  private retainedVersions(capabilityId: string, stableVersion: string): Set<string> {
    return new Set([stableVersion, ...this.capabilities.listSessionCapabilitiesByCapabilityId(capabilityId).map((row) => row.version), ...this.repository.listUpdateRecoveries().filter((row) => row.capabilityId === capabilityId).flatMap((row) => [row.previousPointer.version, row.candidatePointer.version]), ...this.repository.listRemovalRecoveries().filter((row) => row.capabilityId === capabilityId).map((row) => row.previousInstallation.activeVersion)]);
  }
  async prepare(operationId: string, installation: ManagedPackageInstallationRecord, configuration: InstalledConfigurationSnapshot, sessions: SessionCapabilitySnapshot): Promise<RemovalRecovery> {
    try {
      const retained = this.retainedVersions(installation.itemId, installation.activeVersion ?? "");
      const directory = join(this.layout.packagesRoot, installation.itemId);
      const gcVersions: RemovalRecovery["gcVersions"] = [];
      for (const version of await this.files.readdir(directory)) {
        const root = this.layout.packageVersionRoot(installation.itemId, version);
        if (retained.has(version)) continue;
        const entry = await this.files.lstat(root);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error();
        gcVersions.push({ version, contentDigest: await digestPackageTree(root) });
      }
      const row = removalRecoverySchema.parse({ operationId, ownerToken: randomUUID(), packageName: installation.packageName, capabilityId: installation.itemId, stage: "prepared", previousInstallation: serialRemovalInstallation(installation), pointerText: await this.files.readFile(`${this.layout.activePointerPath(installation.itemId)}.json`, "utf8"), configuration: serialRemovalConfiguration(configuration), sessions: sessions.records, gcVersions });
      this.assertState(row, false);
      if (!this.capabilities.sessionCapabilitiesMatch(row.capabilityId, sessions.records)) throw new Error();
      this.repository.createRemovalRecovery(row);
      return row;
    } catch { throw new Error("package_remove_failed"); }
  }
  private assertState(row: RemovalRecovery, removed: boolean): void {
    const current = this.repository.getByPackageName(row.packageName);
    const config = serialRemovalConfiguration(this.capabilities.snapshotInstalledConfiguration(row.capabilityId));
    if (removed ? current !== undefined || config.installation !== undefined || config.settings.length !== 0 : !current || !same(serialRemovalInstallation(current), row.previousInstallation) || !same(config, row.configuration)) throw new Error("package_remove_failed");
  }
  async commit(row: RemovalRecovery, guard: () => Promise<void>): Promise<void> {
    const owner=this.hooks.resourceOwner?.();
    const stage=async()=>{
      await guard(); this.assertState(row, false);
      if (await this.files.readFile(this.pointer(row), "utf8") !== row.pointerText) throw new Error();
      await this.files.mkdir(join(this.staging(row), "gc"), { recursive: true, mode: 0o700 });
      await guard(); this.assertState(row, false);
      // PackageLock owns cooperating writers; foreign pointers observed here are refused.
      if (await this.files.readFile(this.pointer(row), "utf8") !== row.pointerText) throw new Error();
      await this.files.rename(this.pointer(row), join(this.staging(row), "pointer.json"));
      this.repository.advanceRemovalRecovery(row.operationId, row.ownerToken, "detached");
    };
    const commit=()=>{
      this.transaction(() => {
        this.assertState(row, false);
        this.repository.deleteInstallation(row.packageName);
        this.capabilities.restoreInstalledConfiguration({ capabilityId: row.capabilityId, installation: undefined, settings: [] });
        this.repository.advanceRemovalRecovery(row.operationId, row.ownerToken, "committed");
      });
      if(owner)this.repository.advanceRemovalRecovery(row.operationId,row.ownerToken,"cleanup_pending");
    };
    const finalize=async()=>{
      await this.hooks.refreshCatalog();
      for (const version of row.gcVersions) {
        await guard(); this.assertState(row, true);
        if (this.retainedVersions(row.capabilityId, row.previousInstallation.activeVersion).has(version.version)) throw new Error();
        const root = this.layout.packageVersionRoot(row.capabilityId, version.version);
        if (await digestPackageTree(root) !== version.contentDigest) throw new Error();
        await this.files.rename(root, join(this.staging(row), "gc", version.version));
      }
      await guard(); this.assertState(row, true);
    };
    try {
      if(owner)await owner.remove(row.capabilityId,row.operationId,{stage,commit,rollback:()=>this.restore(row),finalize});
      else {await stage();commit();await finalize();}
    } catch { throw new Error("package_remove_failed"); }
  }
  async restore(row: RemovalRecovery): Promise<void> {
    try {
      const current = this.repository.getByPackageName(row.packageName);
      this.assertState(row, !current);
      for (const version of [...row.gcVersions].reverse()) {
        const staged = join(this.staging(row), "gc", version.version), destination = this.layout.packageVersionRoot(row.capabilityId, version.version);
        if (!await this.exists(staged)) continue;
        if (await this.exists(destination) || await digestPackageTree(staged) !== version.contentDigest) throw new Error();
        await this.files.rename(staged, destination);
      }
      const backup = join(this.staging(row), "pointer.json");
      if (await this.exists(backup)) {
        if (await this.exists(this.pointer(row)) || await this.files.readFile(backup, "utf8") !== row.pointerText) throw new Error();
        await this.files.rename(backup, this.pointer(row));
      } else if (await this.files.readFile(this.pointer(row), "utf8") !== row.pointerText) throw new Error();
      this.transaction(() => {
        this.assertState(row, !current);
        this.repository.restoreInstallation(row.packageName, { ...row.previousInstallation, createdAt: new Date(row.previousInstallation.createdAt), updatedAt: new Date(row.previousInstallation.updatedAt) });
        const installation = row.configuration.installation;
        this.capabilities.restoreInstalledConfiguration({ ...row.configuration, installation: installation ? { ...installation, createdAt: new Date(installation.createdAt), updatedAt: new Date(installation.updatedAt) } : undefined });
      });
      await this.hooks.refreshCatalog();
      this.assertState(row, false);
    } catch { throw new Error("package_remove_failed"); }
  }
  async cleanup(row: RemovalRecovery): Promise<void> {
    try { await this.files.rm(this.staging(row), { recursive: true, force: true }); }
    catch { throw new Error("package_remove_failed"); }
  }
}
