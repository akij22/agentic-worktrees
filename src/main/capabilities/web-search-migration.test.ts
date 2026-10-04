import BetterSqlite3 from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { ManagedPackageRepository } from "../packages/package-repository";
import { CapabilityRepository } from "./capability-repository";
import {
  WEB_SEARCH_MIGRATION,
  WebSearchMigration,
} from "./web-search-migration";

const id = WEB_SEARCH_MIGRATION.capabilityId;

describe("WebSearchMigration", () => {
  let db: BetterSqlite3.Database;
  let capabilities: CapabilityRepository;
  let packages: ManagedPackageRepository;
  beforeEach(() => {
    db = new BetterSqlite3(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(bootstrapSchemaSql);
    const now = 1234;
    db.prepare(
      "INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'','','ready',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO worktrees (id,repository_id,name,path,branch_name,status,created_at,updated_at) VALUES ('wt','repo','wt','/tmp/wt','main','ready',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,created_at,updated_at) VALUES ('run','repo','wt','Run','','idle',?,?)",
    ).run(now, now);
    capabilities = new CapabilityRepository(db);
    packages = new ManagedPackageRepository(db);
  });
  afterEach(() => db.close());

  const seed = (digest = WEB_SEARCH_MIGRATION.permissionDigest) => {
    capabilities.saveConfiguration(
      {
        capabilityId: id,
        version: "0.1.0",
        permissionDigest: digest,
        configured: true,
      },
      [
        { key: "providerMode", value: "auto" },
        { key: "resultLimit", value: 9 },
        { key: "exaApiKey", secretRef: "encrypted-ref:unchanged" },
      ],
    );
    capabilities.transitionSessionCapability({
      runId: "run",
      capabilityId: id,
      version: "0.1.0",
      to: "pending_activation",
    });
    capabilities.transitionSessionCapability({
      runId: "run",
      capabilityId: id,
      version: "0.1.0",
      to: "active",
    });
  };
  const fixture = (
    options: {
      acquireFails?: boolean;
      descriptor?: typeof WEB_SEARCH_MIGRATION.descriptor;
      officialDescriptor?: typeof WEB_SEARCH_MIGRATION.descriptor;
      inspectedPermissionDigest?: string;
    } = {},
  ) => {
    const staged = {
      operationId: "replaced",
      requestedSpec: WEB_SEARCH_MIGRATION.requestedSpec,
      packageName: WEB_SEARCH_MIGRATION.packageName,
      resolvedVersion: "0.1.0",
      integrity: "sha512-reviewed",
      contentDigest: "a".repeat(64),
      packageRoot: "/staged",
      releaseNotes: "",
    };
    const acquired = vi.fn(async (operationId: string) => {
      if (options.acquireFails) throw new Error("offline");
      return { ...staged, operationId };
    });
    const inspected = vi.fn(async (value: typeof staged) => ({
      staged: value,
      packageMetadata: {
        kind: "capability" as const,
        manifest: "./capability.json",
        entry: "./dist/index.js",
      },
      descriptor: options.descriptor ?? WEB_SEARCH_MIGRATION.descriptor,
      permissionDigest:
        options.inspectedPermissionDigest ??
        WEB_SEARCH_MIGRATION.permissionDigest,
      trust: "official" as const,
      reviewStatus: "official-reviewed" as const,
    }));
    const installer = vi.fn(
      async (
        value: Awaited<ReturnType<typeof inspected>>,
        _verification: unknown,
        _configuration: unknown,
        _assert: unknown,
        preserve: boolean,
      ) => {
        expect(preserve).toBe(true);
        return packages.commitInstallation(value.staged.operationId, {
          packageName: value.staged.packageName,
          itemKind: "capability",
          itemId: id,
          requestedSpec: value.staged.requestedSpec,
          activeVersion: value.staged.resolvedVersion,
          activeIntegrity: value.staged.integrity,
          activeContentDigest: value.staged.contentDigest,
          trust: "official",
          reviewStatus: "official-reviewed",
          permissionDigest: value.permissionDigest,
          state: "installed",
        });
      },
    );
    const findCapability = vi.fn(async () => ({
      capabilityId: id,
      packageName: WEB_SEARCH_MIGRATION.packageName,
      releaseSpec: "0.1.0",
      descriptor: options.officialDescriptor ?? WEB_SEARCH_MIGRATION.descriptor,
      publisher: "Agentic Worktrees",
      minimumAppVersion: "1.0.0",
      blockedVersions: [],
      releaseNotes: "",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const verifier = vi.fn(
      async (value: Awaited<ReturnType<typeof inspected>>) => ({
        capabilityId: id,
        version: "0.1.0",
        contentDigest: value.staged.contentDigest,
        toolNames: value.descriptor.tools.map(
          (tool: { name: string }) => tool.name,
        ),
      }),
    );
    const migration = new WebSearchMigration({
      capabilities,
      packages,
      officialCatalog: { findCapability: findCapability as never },
      acquirer: {
        acquire: acquired as never,
        discard: vi.fn(async () => undefined),
      },
      inspector: { inspect: inspected as never },
      verifier: { verify: verifier as never },
      installer: { commitFresh: installer as never },
      lock: {
        runExclusive: async (
          work: (owner: { assertHealthy(): void }) => Promise<unknown>,
        ) => work({ assertHealthy() { return undefined; } }),
      } as never,
    });
    return {
      migration,
      findCapability,
      acquired,
      inspected,
      verifier,
      installer,
    };
  };

  it("migrates the exact reviewed installation without duplicate consent and preserves data and sessions byte-for-byte", async () => {
    seed();
    const before = capabilities.snapshotInstalledConfiguration(id);
    const sessions = capabilities.snapshotSessionCapabilities(id);
    const f = fixture();
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migrated");
    expect(f.installer).toHaveBeenCalledOnce();
    expect(capabilities.snapshotInstalledConfiguration(id)).toEqual(before);
    expect(capabilities.snapshotSessionCapabilities(id)).toEqual(sessions);
    expect(
      packages.getByPackageName(WEB_SEARCH_MIGRATION.packageName)?.state,
    ).toBe("installed");
  });

  it("records an offline download as durable pending without false installation or session loss", async () => {
    seed();
    const sessions = capabilities.snapshotSessionCapabilities(id);
    const f = fixture({ acquireFails: true });
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migration_pending");
    expect(
      packages.getByPackageName(WEB_SEARCH_MIGRATION.packageName),
    ).toMatchObject({ state: "migration_pending", activeVersion: undefined });
    expect(capabilities.snapshotSessionCapabilities(id)).toEqual(sessions);
    expect(f.installer).not.toHaveBeenCalled();
  });

  it("keeps changed permissions pending for normal review without downloading", async () => {
    seed("changed-reviewed-digest");
    const f = fixture();
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migration_pending");
    expect(f.acquired).not.toHaveBeenCalled();
    expect(
      packages.getByPackageName(WEB_SEARCH_MIGRATION.packageName)
        ?.acceptedPermissionDigest,
    ).toBe("changed-reviewed-digest");
  });

  it("does not install Web Search in a fresh database", async () => {
    const f = fixture();
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("not_needed");
    expect(f.acquired).not.toHaveBeenCalled();
    expect(packages.list()).toEqual([]);
  });

  it("rejects a mutated Official descriptor before package work and preserves every legacy row", async () => {
    seed();
    const configuration = capabilities.snapshotInstalledConfiguration(id);
    const sessions = capabilities.snapshotSessionCapabilities(id);
    const changed = { ...WEB_SEARCH_MIGRATION.descriptor, tools: [] };
    const f = fixture({ officialDescriptor: changed });
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migration_pending");
    expect(f.findCapability).toHaveBeenCalledOnce();
    expect(f.acquired).not.toHaveBeenCalled();
    expect(f.inspected).not.toHaveBeenCalled();
    expect(f.verifier).not.toHaveBeenCalled();
    expect(f.installer).not.toHaveBeenCalled();
    expect(capabilities.snapshotInstalledConfiguration(id)).toEqual(
      configuration,
    );
    expect(capabilities.snapshotSessionCapabilities(id)).toEqual(sessions);
  });

  it("persists an inspector permission mismatch as pending without changing legacy data", async () => {
    seed();
    const configuration = capabilities.snapshotInstalledConfiguration(id);
    const sessions = capabilities.snapshotSessionCapabilities(id);
    const f = fixture({
      inspectedPermissionDigest: "inspector-changed-digest",
    });
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migration_pending");
    expect(f.inspected).toHaveBeenCalledOnce();
    expect(f.verifier).not.toHaveBeenCalled();
    expect(f.installer).not.toHaveBeenCalled();
    expect(
      packages.getByPackageName(WEB_SEARCH_MIGRATION.packageName),
    ).toMatchObject({
      state: "migration_pending",
      activeVersion: undefined,
      acceptedPermissionDigest: WEB_SEARCH_MIGRATION.permissionDigest,
    });
    expect(capabilities.snapshotInstalledConfiguration(id)).toEqual(
      configuration,
    );
    expect(capabilities.snapshotSessionCapabilities(id)).toEqual(sessions);
  });

  it("normalizes a non-installed managed record to durable migration pending", async () => {
    seed();
    packages.saveMigrationPending({
      packageName: WEB_SEARCH_MIGRATION.packageName,
      itemKind: "capability",
      itemId: id,
      requestedSpec: WEB_SEARCH_MIGRATION.requestedSpec,
      trust: "official",
      reviewStatus: "official-reviewed",
      permissionDigest: WEB_SEARCH_MIGRATION.permissionDigest,
    });
    db.prepare(
      "UPDATE managed_package_installations SET state='invalid', active_version='0.1.0', active_integrity='old-integrity', active_content_digest=?, error_code='package_install_failed' WHERE package_name=?",
    ).run("b".repeat(64), WEB_SEARCH_MIGRATION.packageName);
    const before = capabilities.snapshotInstalledConfiguration(id);
    const sessions = capabilities.snapshotSessionCapabilities(id);
    const f = fixture();
    await expect(
      f.migration.reconcile(new AbortController().signal),
    ).resolves.toBe("migration_pending");
    const pending = packages.getByPackageName(WEB_SEARCH_MIGRATION.packageName);
    expect(pending).toMatchObject({
      state: "migration_pending",
      activeVersion: undefined,
    });
    expect(pending?.errorCode).toBeUndefined();
    expect(f.findCapability).not.toHaveBeenCalled();
    expect(capabilities.snapshotInstalledConfiguration(id)).toEqual(before);
    expect(capabilities.snapshotSessionCapabilities(id)).toEqual(sessions);
  });

  it("retries a pending migration and is idempotent after success", async () => {
    seed();
    const offline = fixture({ acquireFails: true });
    await offline.migration.reconcile(new AbortController().signal);
    const online = fixture();
    await expect(
      online.migration.retry(new AbortController().signal),
    ).resolves.toBe("migrated");
    await expect(
      online.migration.retry(new AbortController().signal),
    ).resolves.toBe("migrated");
    expect(online.installer).toHaveBeenCalledOnce();
  });
});
