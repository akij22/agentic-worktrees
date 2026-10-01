import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSearchManifest } from "@agentic-worktrees/web-search";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { CapabilityRepository } from "./capability-repository";
import { CapabilityService } from "./capability-service";
import { createBundledCapability, permissionDigest } from "./catalog";

const webEntry = createBundledCapability(webSearchManifest, ["web_search"]);
const testCatalog = {
  list: () => [webEntry],
  get: (id: string) => {
    if (id !== webEntry.manifest.id) throw new Error("unknown");
    return webEntry;
  },
  refresh: async () => undefined,
};

const capabilityId = webEntry.manifest.id;

const configuredRepository = (repository: CapabilityRepository) => {
  repository.saveConfiguration(
    {
      capabilityId,
      version: webEntry.manifest.version,
      permissionDigest: permissionDigest(webEntry.manifest),
      configured: true,
    },
    [],
  );
};

describe("worktree-scoped Assignment", () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("foreign_keys=ON");
    sqlite.exec(bootstrapSchemaSql);
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('r',1,'o','r','o/r',0,0,'','','ready',?,?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO worktrees (id,repository_id,name,path,branch_name,status,created_at,updated_at) VALUES ('w','r','w','/tmp/w','main','ready',?,?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO worktrees (id,repository_id,name,path,branch_name,status,created_at,updated_at) VALUES ('w2','r','w2','/tmp/w2','feat/x','ready',?,?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,created_at,updated_at) VALUES ('run-1','r','w','Run','','idle',?,?)`,
      )
      .run(now, now);
  });

  afterEach(() => sqlite.close());


  const seedActiveSessionCapability = (
    repository: CapabilityRepository,
    runId: string,
  ) => {
    repository.transitionSessionCapability({
      runId,
      capabilityId,
      version: webEntry.manifest.version,
      to: "pending_activation",
    });
    repository.transitionSessionCapability({
      runId,
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });
  };

  const makeService = (
    repository: CapabilityRepository,
    overrides: Partial<{
      isAgentIdle: ReturnType<typeof vi.fn>;
      prepareSession: ReturnType<typeof vi.fn>;
      apply: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      setActiveCapabilities: ReturnType<typeof vi.fn>;
    }> = {},
  ) => {
    const setActiveCapabilities =
      overrides.setActiveCapabilities ?? vi.fn().mockResolvedValue(["tool"]);
    return new CapabilityService({
      repository,
      catalog: testCatalog,
      credentials: {} as never,
      hosts: { setActiveCapabilities, stopHost: vi.fn() } as never,
      activator: {
        isAgentIdle: overrides.isAgentIdle ?? vi.fn().mockResolvedValue(true),
        prepareSession:
          overrides.prepareSession ?? vi.fn().mockResolvedValue(undefined),
        apply: overrides.apply ?? vi.fn().mockResolvedValue(undefined),
        remove: overrides.remove ?? vi.fn().mockResolvedValue(undefined),
      } as never,
      getAgentKind: vi.fn().mockResolvedValue("codex"),
    });
  };

  it("reads the Assignment for a worktree that has no session yet", () => {
    const repository = new CapabilityRepository(sqlite);
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "pending_activation",
    });

    const service = makeService(repository);
    expect(service.listWorktreeCapabilities("w")).toEqual([
      expect.objectContaining({
        worktreeId: "w",
        capabilityId,
        state: "pending_activation",
      }),
    ]);
    expect(service.listWorktreeCapabilities("w2")).toEqual([]);
  });

  it("refuses to assign a capability that was never configured", async () => {
    const repository = new CapabilityRepository(sqlite);
    const service = makeService(repository);

    await expect(
      service.assignCapabilityToWorktree("w", capabilityId),
    ).rejects.toThrow(/configure/i);
    expect(repository.listWorktreeCapabilities("w")).toEqual([]);
  });

  it("keeps an assign with no live session in the applying state", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const service = makeService(repository);

    const result = await service.assignCapabilityToWorktree("w", capabilityId);

    // No runtime has proven it yet, so Enabled would be a lie.
    expect(result.state).toBe("pending_activation");
    expect(service.listInheritableWorktreeCapabilities("w")).toHaveLength(1);
  });

  it("settles on enabled once a live session on the worktree is reconciled", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const service = makeService(repository);
    seedActiveSessionCapability(repository, "run-1");

    const result = await service.assignCapabilityToWorktree("w", capabilityId);

    expect(result.state).toBe("active");
  });

  it("does not reconcile sessions belonging to another worktree", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const setActiveCapabilities = vi.fn().mockResolvedValue(["tool"]);
    const service = makeService(repository, { setActiveCapabilities });
    seedActiveSessionCapability(repository, "run-1");

    const result = await service.assignCapabilityToWorktree("w2", capabilityId);

    expect(setActiveCapabilities).not.toHaveBeenCalled();
    expect(result.state).toBe("pending_activation");
    expect(
      repository.getWorktreeCapability("w2", capabilityId)?.status,
    ).toBe("pending_activation");
    expect(
      repository.getWorktreeCapability("w", capabilityId),
    ).toBeUndefined();
  });

  it("reports a failure instead of claiming the worktree was reconciled", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const service = makeService(repository, {
      setActiveCapabilities: vi
        .fn()
        .mockRejectedValue(new Error("host unreachable")),
    });
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });
    seedActiveSessionCapability(repository, "run-1");

    await expect(
      service.revokeCapabilityFromWorktree("w", capabilityId),
    ).rejects.toThrow(/0 of 1/);
    expect(
      repository.getWorktreeCapability("w", capabilityId)?.status,
    ).toBe("activation_failed");
  });

  it("leaves an assign applying when no session has materialised it", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const setActiveCapabilities = vi.fn().mockResolvedValue(["tool"]);
    const service = makeService(repository, { setActiveCapabilities });
    // Mid-application, not yet active: there is nothing to reconcile yet.
    repository.transitionSessionCapability({
      runId: "run-1",
      capabilityId,
      version: webEntry.manifest.version,
      to: "pending_activation",
    });

    const result = await service.assignCapabilityToWorktree("w", capabilityId);

    expect(setActiveCapabilities).not.toHaveBeenCalled();
    expect(result.state).toBe("pending_activation");
  });

  it("revokes cleanly when no session holds the capability", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const service = makeService(repository);
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });

    const result = await service.revokeCapabilityFromWorktree("w", capabilityId);

    expect(result.state).toBe("deactivated");
    expect(service.listInheritableWorktreeCapabilities("w")).toHaveLength(0);
  });

  it("revokes the capability from a session that still holds it", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = makeService(repository, { remove });
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });
    seedActiveSessionCapability(repository, "run-1");

    const result = await service.revokeCapabilityFromWorktree("w", capabilityId);

    expect(remove).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe("deactivated");
    expect(
      repository.getSessionCapability("run-1", capabilityId)?.status,
    ).toBe("inactive");
  });

  it("emits a worktree scoped change event", async () => {
    const repository = new CapabilityRepository(sqlite);
    configuredRepository(repository);
    const service = makeService(repository);
    const events: unknown[] = [];
    service.subscribeToCapabilityEvents((event) => events.push(event));

    await service.assignCapabilityToWorktree("w", capabilityId);

    expect(events).toContainEqual(
      expect.objectContaining({
        scope: "worktree",
        worktreeId: "w",
        capabilityId,
        state: "pending_activation",
      }),
    );
  });

  it("inherits the Assignment into a new session as applying", () => {
    const repository = new CapabilityRepository(sqlite);
    const service = makeService(repository);
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });
    sqlite
      .prepare(
        `INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,created_at,updated_at) VALUES ('run-2','r','w','Run 2','','idle',?,?)`,
      )
      .run(Date.now(), Date.now());

    const inherited = service.inheritWorktreeCapabilitiesIntoSession("w", "run-2");

    expect(inherited).toEqual([capabilityId]);
    // pending_activation is what makes session creation prepare the runtime.
    expect(
      repository.getSessionCapability("run-2", capabilityId)?.status,
    ).toBe("pending_activation");
  });

  it("does not inherit a failed or revoked Assignment", () => {
    const repository = new CapabilityRepository(sqlite);
    const service = makeService(repository);
    for (const status of ["deactivated", "activation_failed"]) {
      repository.transitionWorktreeCapability({
        worktreeId: "w",
        capabilityId,
        version: webEntry.manifest.version,
        to: status,
      });
    }

    expect(service.inheritWorktreeCapabilitiesIntoSession("w", "run-1")).toEqual(
      [],
    );
    expect(
      repository.getSessionCapability("run-1", capabilityId),
    ).toBeUndefined();
  });

  it("does not double-seed a session that already holds the capability", () => {
    const repository = new CapabilityRepository(sqlite);
    const service = makeService(repository);
    repository.transitionWorktreeCapability({
      worktreeId: "w",
      capabilityId,
      version: webEntry.manifest.version,
      to: "active",
    });
    seedActiveSessionCapability(repository, "run-1");

    expect(service.inheritWorktreeCapabilitiesIntoSession("w", "run-1")).toEqual(
      [],
    );
    expect(
      repository.getSessionCapability("run-1", capabilityId)?.status,
    ).toBe("active");
  });

  it("resolves which worktree a run belongs to", () => {
    const repository = new CapabilityRepository(sqlite);
    expect(repository.getRunWorktreeId("run-1")).toBe("w");
    expect(repository.getRunWorktreeId("missing")).toBeUndefined();
  });
});
