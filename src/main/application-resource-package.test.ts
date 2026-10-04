import { Worker } from "node:worker_threads";
import { configureDatabaseUserDataPath, getSqlite } from "./database/client";
import { CapabilityDistributionService } from "./capabilities/capability-distribution-service";
import { DisposableCapabilityPackageVerifier } from "./capabilities/package-verifier";
import { NpmPackageAcquirer } from "./packages/npm-acquirer";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  chmod,
  rm,
  readdir,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
const children = vi.hoisted(
  () => new Set<import("node:worker_threads").Worker>(),
);
vi.mock("electron", async () => {
  const { Worker } = await import("node:worker_threads");
  return {
    utilityProcess: {
      fork: (
        file: string,
        _args: unknown,
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        const worker = new Worker(file, { env: options.env });
        children.add(worker);
        worker.once("exit", () => children.delete(worker));
        return Object.assign(worker, {
          kill: () => {
            void worker.terminate();
            return true;
          },
        });
      },
    },
  };
});
import { OPENCODE_BUILTIN_TOOLS } from "./coding-agents/opencode-worktree-runtime";
import { bootstrapSchemaSql } from "./database/bootstrap";
import { ResourceCutover } from "./database/resource-cutover";
import { ApplicationResourceRuntime } from "./application-resource-runtime";
import { ApplicationResourceCatalog } from "./assignments/application-resource-catalog";
import { DatabaseAssignmentMigrationCatalog } from "./assignments/database-assignment-migration-catalog";
import { CapabilityRemovalInstaller } from "./capabilities/capability-removal-installer";
import { CapabilityPackageInstaller } from "./capabilities/capability-package-installer";
import { CapabilityPackageInspector } from "./capabilities/package-inspector";
import { CapabilityRepository } from "./capabilities/capability-repository";
import { InstalledCapabilityCatalog } from "./capabilities/installed-catalog";
import {
  createCapabilityCatalog,
  getBundledCapability,
} from "./capabilities/catalog";
import { ManagedPackageRepository } from "./packages/package-repository";
import { createManagedPackageLayout } from "./packages/storage-layout";
import { digestPackageTree } from "./packages/content-digest";

it("holds every affected Assignment while publishing a managed Capability update", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-release-package-")),
  );
  configureDatabaseUserDataPath(root);
  const db = getSqlite();
  db.pragma("foreign_keys=ON");
  db.exec(bootstrapSchemaSql);
  const packages = new ManagedPackageRepository(db),
    capabilities = new CapabilityRepository(db),
    layout = createManagedPackageLayout(root);
  const installed = new InstalledCapabilityCatalog(layout, packages),
    catalog = createCapabilityCatalog(installed);
  let runtime: ApplicationResourceRuntime | undefined;
  const installer = new CapabilityPackageInstaller(
    layout,
    packages,
    capabilities,
    (work) => db.transaction(work)(),
    {
      refreshCatalog: () => catalog.refresh(),
      resourceOwner: () => runtime?.packageResourceOwner(),
    },
  );
  const stage = async (version: string, action: "install" | "update") => {
    const operationId = `package-${version}`,
      packageName = "@test/release",
      packageRoot = join(layout.stagingOperationRoot(operationId), "package");
    await mkdir(packageRoot, { recursive: true });
    const manifest = {
      ...getBundledCapability("agentic-worktrees.url-fetch").manifest,
      id: "test.release",
      name: "Release",
      version,
      permissions: { network: [], secrets: [] },
      settings: {},
    };
    const descriptor = {
      manifest,
      tools: [
        {
          name: "release_tool",
          description: "Synthetic release tool",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ],
    };
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: packageName,
        version,
        type: "module",
        agenticWorktrees: {
          kind: "capability",
          manifest: "./capability.json",
          entry: "./index.js",
        },
      }),
    );
    await writeFile(
      join(packageRoot, "capability.json"),
      JSON.stringify(descriptor),
    );
    await writeFile(
      join(packageRoot, "index.js"),
      `const descriptor=${JSON.stringify(descriptor)};export default {...descriptor,tools:descriptor.tools.map(tool=>({...tool,execute:async()=>({content:[{type:"text",text:"Synthetic result"}]})}))};`,
    );
    const contentDigest = await digestPackageTree(packageRoot),
      requestedSpec = `${packageName}@${version}`;
    packages.beginOperation({
      operationId,
      action,
      stage: "installing",
      packageName,
      requestedSpec,
    });
    const inspected = await new CapabilityPackageInspector().inspect(
      {
        operationId,
        packageRoot,
        packageName,
        resolvedVersion: version,
        requestedSpec,
        integrity: "sha512-synthetic",
        contentDigest,
        packageJson: { name: packageName, version },
      },
      { trust: "community", reviewStatus: "unreviewed" },
    );
    return {
      inspected,
      verification: {
        capabilityId: manifest.id,
        version,
        contentDigest,
        toolNames: ["release_tool"],
      },
    };
  };
  try {
    const first = await stage("1.0.0", "install");
    await installer.commitFresh(first.inspected, first.verification);
    db.exec(
      "INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)",
    );
    db.prepare(
      "INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w',?,'b','linked','ready',1,1)",
    ).run(root);
    db.exec(
      "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','','idle','idle',0,1,1)",
    );
    const migrationCatalog = new DatabaseAssignmentMigrationCatalog(
      db,
      catalog,
    );
    new ResourceCutover(db, migrationCatalog).run();
    const executable = join(root, "provider");
    await writeFile(
      executable,
      `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
    );
    await chmod(executable, 0o700);
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        completeOnInterrupt: true,
        servers: [
          {
            name: "aw_resources",
            runtimeStatus: "connected",
            tools: { release_tool: {} },
          },
        ],
      }),
    );
    const opencode = join(root, "opencode-provider");
    await writeFile(
      opencode,
      `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/opencode-runtime-provider.mjs"), "utf8")}`,
    );
    await chmod(opencode, 0o700);
    await writeFile(
      join(root, "provider-fixture.json"),
      JSON.stringify({
        version: "1.18.30",
        tools: OPENCODE_BUILTIN_TOOLS,
        exitAfterPrompt: true,
        baselineSkills: [
          {
            name: "customize-opencode",
            location: "<built-in>",
            description:
              "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
            content: await readFile(
              resolve(
                "src/main/coding-agents/fixtures/opencode-1.18.30-customize.txt",
              ),
              "utf8",
            ),
          },
        ],
        baselineCommands: await Promise.all(
          ["initialize", "review"].map(async (name) => ({
            name: name === "initialize" ? "init" : name,
            source: "command",
            template: await readFile(
              resolve(
                `src/main/coding-agents/fixtures/opencode-1.18.30-${name}.txt`,
              ),
              "utf8",
            ),
          })),
        ),
      }),
    );
    db.exec(
      "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('open-run','repo','wt','t','','idle','idle',0,1,1)",
    );
    runtime = new ApplicationResourceRuntime({
      sqlite: db,
      userDataPath: root,
      environment: {},
      evidenceKey: Buffer.alloc(32, 9),
      executable: (kind) => (kind === "codex" ? executable : opencode),
      resources: new ApplicationResourceCatalog(
        db,
        root,
        migrationCatalog,
        catalog,
      ),
      capabilityHosts: {
        catalog,
        repository: capabilities,
        resolveSecret: async () => undefined,
        bundlePath: resolve(".vite/build/capability-host.js"),
      },
    });
    await runtime.start();
    await runtime.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [{ kind: "capability", id: "test.release", version: "1.0.0" }],
    });
    await runtime.assignment.waitForReconciliation("wt");
    const session = await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "create",
      },
      (adapter) =>
        adapter.createSession(root, "Release", {
          runId: "run",
          modelId: "fixture",
        }),
    );
    db.prepare(
      "INSERT INTO coding_agent_installations (id,kind,name,executable_path,version,enabled,last_verified_at,created_at,updated_at) VALUES ('codex','codex','Codex',?,'0.154.0',1,1,1,1)",
    ).run(executable);
    db.prepare(
      "INSERT INTO coding_agent_sessions (run_id,installation_id,external_session_id,provider_id,model_id,created_at,updated_at) VALUES ('run','codex',?,'openai','fixture',1,1)",
    ).run(session.id);
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: session.id,
      },
      { content: "Hold update", providerId: "openai", modelId: "fixture" },
    );
    const next = await stage("2.0.0", "update"),
      update = installer.commitUpdate(next.inspected, next.verification, {
        configured: true,
        settings: [],
        obsoleteSecretRefs: [],
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect((await runtime.assignment.get("wt", "codex")).phase).toBe(
      "waiting_for_idle",
    );
    expect(packages.getByPackageName("@test/release")?.activeVersion).toBe(
      "1.0.0",
    );
    await runtime.abort("run");
    const updated = await update;
    installer.finalizeUpdate(updated);
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual([
      expect.objectContaining({
        id: "test.release",
        version: "2.0.0",
        verified: true,
      }),
    ]);
    expect(packages.getByPackageName("@test/release")?.activeVersion).toBe(
      "2.0.0",
    );
    expect(children.size).toBe(1);
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.1",
        completeOnInterrupt: true,
        servers: [
          {
            name: "aw_resources",
            runtimeStatus: "connected",
            tools: { release_tool: {} },
          },
        ],
      }),
    );
    const rejected = await stage("3.0.0", "update");
    await expect(
      installer.commitUpdate(rejected.inspected, rejected.verification, {
        configured: true,
        settings: [],
        obsoleteSecretRefs: [],
      }),
    ).rejects.toThrow("package_update_failed");
    expect(packages.getByPackageName("@test/release")?.activeVersion).toBe(
      "2.0.0",
    );
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual([
      expect.objectContaining({
        id: "test.release",
        version: "2.0.0",
        verified: true,
      }),
    ]);
    expect(children.size).toBe(1);
    for (const recovery of packages.listUpdateRecoveries()) {
      await installer.assertUpdateRecoveryRestored(recovery);
      packages.finishUpdateRecovery(recovery.operationId, recovery.ownerToken);
    }
    const distribution = new CapabilityDistributionService({
      layout,
      repository: packages,
      capabilityRepository: capabilities,
      installedCatalog: installed,
      resourceOwner: () => runtime?.packageResourceOwner(),
      sessionCoordinator: {
        listActiveRuns: () => [],
        activeRunCount: () => 0,
        assertRunsIdle: async () => undefined,
        reloadRuns: async () => undefined,
        restoreRuns: async () => undefined,
        finalizeDeactivation: () => undefined,
        deactivateRuns: async () => undefined,
        reactivateRuns: async () => undefined,
        assertManagedCapability: () => undefined,
      },
      acquirer: new NpmPackageAcquirer(layout, {
        resolve: async (sourceSpec) => ({
          requestedSpec: sourceSpec,
          packageName: "@test/release",
          resolvedVersion: "3.0.1",
          integrity: "sha512-synthetic",
        }),
        extract: async (_source, destination) => {
          await mkdir(destination, { recursive: true });
          const manifest = {
            ...getBundledCapability("agentic-worktrees.url-fetch").manifest,
            id: "test.release",
            name: "Release",
            version: "3.0.1",
            permissions: { network: [], secrets: [] },
            settings: {},
          };
          const descriptor = {
            manifest,
            tools: [
              {
                name: "release_tool",
                description: "Synthetic release tool",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          };
          await writeFile(
            join(destination, "package.json"),
            JSON.stringify({
              name: "@test/release",
              version: "3.0.1",
              type: "module",
              agenticWorktrees: {
                kind: "capability",
                manifest: "./capability.json",
                entry: "./index.js",
              },
            }),
          );
          await writeFile(
            join(destination, "capability.json"),
            JSON.stringify(descriptor),
          );
          await writeFile(
            join(destination, "index.js"),
            `const descriptor=${JSON.stringify(descriptor)};export default {...descriptor,tools:descriptor.tools.map(tool=>({...tool,execute:async()=>({content:[{type:"text",text:"Synthetic result"}]})}))};`,
          );
        },
      }),
      verifier: new DisposableCapabilityPackageVerifier({
        launch: () => {
          const worker = new Worker(
            resolve(".vite/build/capability-package-verifier.js"),
          );
          children.add(worker);
          worker.once("exit", () => children.delete(worker));
          return {
            postMessage: (message) => worker.postMessage(message),
            onMessage: (listener) => {
              worker.on("message", listener);
            },
            onExit: (listener) => {
              worker.on("exit", listener);
            },
            kill: () => {
              void worker.terminate();
              return true;
            },
          };
        },
      }),
    });
    const priorSequence = (await runtime.assignment.get("wt", "codex"))
      .projectionSequence;
    const review = await distribution.inspect({
      sourceSpec: "@test/release@3.0.1",
      intent: "update",
    });
    await expect(
      distribution.update({
        inspectionId: review.inspectionId,
        acceptedPackageName: "@test/release",
        packageName: "@test/release",
        acceptedVersion: review.resolvedVersion,
        acceptedIntegrity: review.integrity,
        acceptedPermissionDigest: review.permissionDigest,
        acceptedDowngrade: false,
        acceptedActiveRunCount: 1,
      }),
    ).rejects.toThrow("package_update_failed");
    expect(
      (await runtime.assignment.get("wt", "codex")).projectionSequence,
    ).not.toBe(priorSequence);
    expect(packages.getByPackageName("@test/release")).toMatchObject({
      activeVersion: "2.0.0",
      state: "installed",
    });
    expect(
      (await runtime.assignment.get("wt", "codex")).admission.canSend,
    ).toBe(true);
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        completeOnInterrupt: true,
        servers: [
          {
            name: "aw_resources",
            runtimeStatus: "connected",
            tools: { release_tool: {} },
          },
        ],
      }),
    );

    const available = packages.getByPackageName("@test/release");
    if (!available) throw new Error("Installed fixture is missing.");
    packages.markInstallationInvalid(
      {
        ...available,
        activeVersion: "2.0.0",
        activeIntegrity: "sha512-synthetic",
        activeContentDigest: next.inspected.staged.contentDigest,
        permissionDigest: next.inspected.permissionDigest,
        state: "invalid",
      },
      "package_install_failed",
    );
    await catalog.refresh();
    expect(await runtime.assignment.get("wt", "codex")).toMatchObject({
      admission: { canSend: false },
      resources: [{ id: "test.release", status: "unavailable" }],
    });
    await expect(
      runtime.submitTurn(
        {
          worktreeId: "wt",
          agentKind: "codex",
          runId: "run",
          externalSessionId: session.id,
        },
        {
          content: "Refuse quarantined package",
          providerId: "openai",
          modelId: "fixture",
        },
      ),
    ).rejects.toThrow();
    packages.restoreInstallation("@test/release", available);
    await catalog.refresh();
    await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "resume",
        externalSessionId: session.id,
      },
      (adapter) => adapter.getSession(root, session.id, { runId: "run" }),
    );
    const openSession = await runtime.withSession(
      {
        worktreeId: "wt",
        agentKind: "opencode",
        runId: "open-run",
        operation: "create",
      },
      (adapter) =>
        adapter.createSession(root, "Exit qualification", {
          runId: "open-run",
          modelId: "fixture",
        }),
    );
    expect(children.size).toBe(2);
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "opencode",
        runId: "open-run",
        externalSessionId: openSession.id,
      },
      { content: "Exit provider", providerId: "fixture", modelId: "fixture" },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(children.size).toBe(1);
    expect(
      runtime.manager
        .inspectWorktree("wt")
        .runtimes.filter((owned) => owned.agentKind === "opencode"),
    ).toHaveLength(0);
    await runtime.submitTurn(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: session.id,
      },
      { content: "Hold removal", providerId: "openai", modelId: "fixture" },
    );
    const removal = new CapabilityRemovalInstaller(
      layout,
      packages,
      capabilities,
      (work) => db.transaction(work)(),
      {
        refreshCatalog: () => catalog.refresh(),
        resourceOwner: () => runtime?.packageResourceOwner(),
      },
    );
    const current = packages.getByPackageName("@test/release");
    if (!current) throw new Error("Installed fixture is missing.");
    packages.beginOperation({
      operationId: "remove-package",
      action: "remove",
      stage: "removing",
      packageName: current.packageName,
      requestedSpec: current.requestedSpec,
    });
    const recovery = await removal.prepare(
      "remove-package",
      current,
      capabilities.snapshotInstalledConfiguration("test.release"),
      capabilities.snapshotSessionCapabilities("test.release"),
    );
    const removed = removal.commit(recovery, async () => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect((await runtime.assignment.get("wt", "codex")).phase).toBe(
      "waiting_for_idle",
    );
    expect(packages.getByPackageName("@test/release")).toBeDefined();
    await runtime.abort("run");
    await removed;
    expect((await runtime.assignment.get("wt", "codex")).resources).toEqual([]);
    expect(packages.getByPackageName("@test/release")).toBeUndefined();
    expect(children.size).toBe(0);
  } finally {
    try {
      await runtime?.stop();
    } finally {
      await Promise.all([...children].map((child) => child.terminate()));
      db.close();
      await removeFixture(root);
    }
  }
});
async function removeFixture(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) await removeFixture(join(root, entry.name));
  await rm(root, { recursive: true, force: true });
}
