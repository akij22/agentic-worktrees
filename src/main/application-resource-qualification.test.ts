import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Sqlite from "better-sqlite3";
import {
  mkdtemp,
  mkdir,
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
import { bootstrapSchemaSql } from "./database/bootstrap";
import { ResourceCutover } from "./database/resource-cutover";
import { ApplicationResourceRuntime } from "./application-resource-runtime";
import { ApplicationResourceCatalog } from "./assignments/application-resource-catalog";
import { DatabaseAssignmentMigrationCatalog } from "./assignments/database-assignment-migration-catalog";
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

import { validateSkillPackage } from "./skills/skill-validation";
import { localResponsesFixture } from "./coding-agents/fixtures/codex-local-responses-fixture";

it.skipIf(
  !process.env.AW_CODEX_QUALIFICATION_BINARY ||
    !process.env.AW_OPENCODE_QUALIFICATION_BINARY,
)(
  "qualifies explicit Skill and Capability use on both pinned providers through the application owner",
  async () => {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), "aw-release-package-")),
      ),
      db = new Sqlite(":memory:");
    await promisify(execFile)("git", ["init", "--quiet", root]);
    db.pragma("foreign_keys=ON");
    db.exec(bootstrapSchemaSql);
    const packages = new ManagedPackageRepository(db),
      capabilities = new CapabilityRepository(db),
      layout = createManagedPackageLayout(root);
    const installed = new InstalledCapabilityCatalog(layout, packages),
      catalog = createCapabilityCatalog(installed);
    let runtime: ApplicationResourceRuntime | undefined;
    const model = await localResponsesFixture(
      "mcp__aw_resources__release_tool",
    );
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
      const source = join(root, "alpha");
      await mkdir(source);
      const body =
        "---\nname: alpha\ndescription: Inert qualification instruction.\n---\nCall aw_resources_release_tool exactly once with empty input. Then reply SYNTHETIC_DONE. Do not use other tools or change files.\n";
      await writeFile(join(source, "SKILL.md"), body);
      const skill = await validateSkillPackage(source),
        path = join(
          root,
          "skills",
          "packages",
          "alpha",
          skill.descriptor.version,
        );
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "SKILL.md"), body);
      db.prepare(
        "INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,codex_compatibility,opencode_compatibility,automatic_invocation,state,created_at,updated_at) VALUES ('alpha',?,'local','fixture',?,'alpha','Qualification','supported','supported',1,'installed',1,1)",
      ).run(skill.descriptor.version, skill.contentDigest);
      db.exec(
        "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('open-run','repo','wt','t','','idle','idle',0,1,1)",
      );
      const migrationCatalog = new DatabaseAssignmentMigrationCatalog(
        db,
        catalog,
      );
      new ResourceCutover(db, migrationCatalog).run();
      const binaries = {
        codex: process.env.AW_CODEX_QUALIFICATION_BINARY,
        opencode: process.env.AW_OPENCODE_QUALIFICATION_BINARY,
      };
      runtime = new ApplicationResourceRuntime({
        sqlite: db,
        userDataPath: root,
        environment: { PATH: process.env.PATH },
        evidenceKey: Buffer.alloc(32, 9),
        modelProvider: {
          id: "qualification",
          name: "Local qualification",
          baseUrl: model.baseUrl,
        },
        executable: (kind) => {
          const binary = binaries[kind];
          if (!binary) throw new Error("Pinned provider is required.");
          return binary;
        },
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
        resources: [
          { kind: "capability", id: "test.release", version: "1.0.0" },
          { kind: "skill", id: "alpha", version: skill.descriptor.version },
        ],
      });
      await runtime.assignment.waitForReconciliation("wt");
      const sessions = new Map<
        "codex" | "opencode",
        { runId: string; externalSessionId: string }
      >();
      for (const kind of ["codex", "opencode"] as const) {
        const runId = kind === "codex" ? "run" : "open-run",
          modelId = kind === "codex" ? "gpt-5.4" : "qualification",
          providerId = kind === "codex" ? "openai" : "qualification";
        const session = await runtime.withSession(
          { worktreeId: "wt", agentKind: kind, runId, operation: "create" },
          (adapter) =>
            adapter.createSession(root, "Inert qualification", {
              runId,
              modelId,
            }),
        );
        sessions.set(kind, { runId, externalSessionId: session.id });
        db.prepare(
          "INSERT INTO coding_agent_installations (id,kind,name,executable_path,version,enabled,last_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,1,1,1,1)",
        ).run(
          kind,
          kind,
          kind,
          binaries[kind],
          kind === "codex" ? "0.154.0" : "1.18.30",
        );
        db.prepare(
          "INSERT INTO coding_agent_sessions (run_id,installation_id,external_session_id,provider_id,model_id,created_at,updated_at) VALUES (?,?,?,?,?,1,1)",
        ).run(runId, kind, session.id, providerId, modelId);
        expect((await runtime.assignment.get("wt", kind)).resources).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "alpha",
              verified: true,
              skillIsolation: kind === "codex" ? "not_enforced" : "enforced",
            }),
            expect.objectContaining({ id: "test.release", verified: true }),
          ]),
        );
        await runtime.submitTurn(
          {
            worktreeId: "wt",
            agentKind: kind,
            runId,
            externalSessionId: session.id,
          },
          {
            providerId,
            modelId,
            explicitSkill: {
              id: "alpha",
              version: skill.descriptor.version,
              name: "alpha",
              path: "",
              arguments: "Call the assigned release tool exactly once.",
            },
          },
        );
        const deadline = Date.now() + 60_000;
        while (runtime.isTurnActive(runId) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
        expect(runtime.isTurnActive(runId)).toBe(false);
        await runtime.withSession(
          {
            worktreeId: "wt",
            agentKind: kind,
            runId,
            operation: "resume",
            externalSessionId: session.id,
          },
          async (adapter) => {
            await adapter.listMessages(root, session.id);
            return { id: session.id };
          },
        );
        const facts = runtime.activity.getSnapshot(runId);
        expect(
          facts.items.map(({ resourceId, useState, mode, outcome }) => ({
            resourceId,
            useState,
            mode,
            outcome,
          })),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              resourceId: "alpha",
              useState: "confirmed",
              mode: "explicit",
            }),
            expect.objectContaining({
              resourceId: "test.release",
              useState: "confirmed",
              outcome: "success",
            }),
          ]),
        );
        expect(JSON.stringify(facts)).not.toMatch(
          /SYNTHETIC_DONE|bearerToken|authorizationHeader|SKILL\.md|baseUrl|invocationId/,
        );
      }
      expect(runtime.manager.inspectWorktree("wt").runtimes).toHaveLength(2);
      const before = new Map(
        [...sessions].map(([kind, session]) => [
          kind,
          runtime?.activity.getSnapshot(session.runId),
        ]),
      );
      await runtime.stop();
      expect(children.size).toBe(0);
      runtime = new ApplicationResourceRuntime({
        sqlite: db,
        userDataPath: root,
        environment: { PATH: process.env.PATH },
        keyVersion: 2,
        evidenceKey: Buffer.alloc(32, 10),
        previousKeys: { 1: Buffer.alloc(32, 9) },
        modelProvider: {
          id: "qualification",
          name: "Local qualification",
          baseUrl: model.baseUrl,
        },
        executable: (kind) => {
          const binary = binaries[kind];
          if (!binary) throw new Error("Pinned provider is required.");
          return binary;
        },
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
      for (const [kind, session] of sessions) {
        await runtime.withSession(
          {
            worktreeId: "wt",
            agentKind: kind,
            runId: session.runId,
            operation: "resume",
            externalSessionId: session.externalSessionId,
          },
          (adapter) =>
            adapter.getSession(root, session.externalSessionId, {
              runId: session.runId,
            }),
        );
        expect(runtime.activity.getSnapshot(session.runId)).toEqual(
          before.get(kind),
        );
      }
      await expect(
        runtime.assignment.removeWorktree("wt", async () => {
          expect(children.size).toBe(0);
          throw new Error("Synthetic Git deletion failure");
        }),
      ).rejects.toThrow("Synthetic Git deletion failure");
      expect(await runtime.assignment.get("wt")).toMatchObject({
        phase: "removing",
        admission: { canSend: false },
      });
      for (const [kind, session] of sessions)
        expect(runtime.activity.getSnapshot(session.runId)).toEqual(
          before.get(kind),
        );
      await runtime.assignment.removeWorktree("wt");
      expect(children.size).toBe(0);
      for (const session of sessions.values())
        expect(runtime.activity.getSnapshot(session.runId).items).toEqual([]);
    } finally {
      try {
        await runtime?.stop();
      } finally {
        await Promise.all([...children].map((child) => child.terminate()));
        await model.close();
        db.close();
        await removeFixture(root);
      }
    }
  },
  150_000,
);
async function removeFixture(root: string): Promise<void> {
  await chmod(root, 0o700);
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) await removeFixture(join(root, entry.name));
  await rm(root, { recursive: true, force: true });
}
