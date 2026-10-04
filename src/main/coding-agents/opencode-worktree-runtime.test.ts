import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  readFile,
  realpath,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorktreeRuntimeManager } from "./worktree-runtime-manager";
import { DatabaseRuntimeAttestationVerifier } from "./worktree-runtime-attestation-verifier";
import { AssignmentRepository } from "../assignments/assignment-repository";
import {
  defineCapability,
  defineTool,
} from "@agentic-worktrees/capability-sdk";
import {
  createCapabilityHostServer,
  type CapabilityHostServer,
} from "../capabilities/capability-host-server";
import { OpenCodeAdapter } from "./opencode-adapter";
import BetterSqlite3 from "better-sqlite3";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { ResourceActivityRepository } from "../resource-activity/resource-activity-repository";
import { ResourceActivityEvidenceService } from "../resource-activity/resource-activity-evidence-service";
import {
  createOpenCodeEvidenceContract,
  type OpenCodeOwnedHostObservation,
  type OpenCodeWorktreeRuntimeOptions,
} from "./opencode-worktree-runtime";
import { localResponsesFixture } from "./fixtures/codex-local-responses-fixture";
import { validateSkillPackage } from "../skills/skill-validation";

const pinnedBinary = process.env.AW_OPENCODE_QUALIFICATION_BINARY;
function qualificationBinary(): string {
  if (!pinnedBinary)
    throw new Error("Pinned qualification binary is required.");
  return pinnedBinary;
}
const adapters: OpenCodeAdapter[] = [];
const models:Awaited<ReturnType<typeof localResponsesFixture>>[]=[];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.stop()));
  await Promise.all(models.splice(0).map(model=>model.close()));
});
async function setup(version = "1.18.30") {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-opencode-test-")),
  );
  const directory = join(root, "work");
  await mkdir(directory);
  await promisify(execFile)("git", ["init", "--quiet", directory]);
  const baselineSkills = [
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
  ];
  const baselineCommands = await Promise.all(
    ["initialize", "review"].map(async (name) => ({
      name: name === "initialize" ? "init" : name,
      source: "command",
      template: await readFile(
        resolve(`src/main/coding-agents/fixtures/opencode-1.18.30-${name}.txt`),
        "utf8",
      ),
    })),
  );
  await writeFile(
    join(directory, "provider-fixture.json"),
    JSON.stringify({
      version,
      baselineSkills,
      baselineCommands,
      tools: [
        "invalid",
        "question",
        "bash",
        "read",
        "glob",
        "grep",
        "edit",
        "write",
        "task",
        "webfetch",
        "todowrite",
        "websearch",
        "skill",
        "apply_patch",
      ],
    }),
  );
  const executable = join(root, "provider");
  await writeFile(
    executable,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/opencode-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(executable, 0o700);
  return { root, directory, executable };
}
async function assignedSkill(root: string, name: string) {
  const path = join(root, name);
  await mkdir(path);
  await writeFile(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: Synthetic isolation check.\n---\nReply SAFE_${name}. Do not change files.\n`,
  );
  const validated = await validateSkillPackage(path);
  return {
    name,
    identity: {
      resourceKind: "skill" as const,
      resourceId: name,
      resourceVersion: "1.0.0",
      resourceDigest: validated.contentDigest,
    },
    files: validated.files.map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
    })),
    automaticInvocation: true,
  };
}
const databases: BetterSqlite3.Database[] = [];
const evidenceServices: ResourceActivityEvidenceService[] = [];
afterEach(() => {
  for (const e of evidenceServices.splice(0)) e.dispose();
  for (const db of databases.splice(0)) db.close();
});
function evidenceFor(
  options: OpenCodeWorktreeRuntimeOptions,
  cancelOwnedInvocation?: (
    lineage: OpenCodeWorktreeRuntimeOptions["lineage"],
    id: string,
  ) => Promise<boolean>,
) {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  const l = options.lineage,
    digest = `sha256:${"a".repeat(64)}`;
  db.prepare(
    "INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES (?,'repo','w',?,'main','primary','ready',1,1)",
  ).run(l.worktreeId, options.directory);
  db.prepare(
    "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo',?,'t','private-prompt','running','idle',0,1,1)",
  ).run(l.worktreeId);
  db.prepare(
    "INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,0,?,1)",
  ).run(l.assignmentGenerationId, l.worktreeId, digest);
  const identities = [
    ...new Map(
      [
        ...options.skills.map((s) => s.identity),
        ...(options.capabilityTools ?? []).map((t) => t.identity),
      ].map((identity) => [JSON.stringify(identity), identity]),
    ).values(),
  ];
  for (const [index, identity] of identities.entries()) {
    db.prepare(
      "INSERT INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES (?,?,?,?,?,?,1)",
    ).run(
      `resource-${index}`,
      identity.resourceKind,
      identity.resourceId,
      identity.resourceVersion,
      identity.resourceDigest,
      digest,
    );
    db.prepare(
      "INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES (?,?,?,?,?)",
    ).run(
      `member-${index}`,
      l.assignmentGenerationId,
      `resource-${index}`,
      digest,
      digest,
    );
  }
  db.prepare(
    "INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES (?,?,'opencode',?,'1.18.30',1,?,1)",
  ).run(l.catalogGenerationId, l.worktreeId, l.assignmentGenerationId, digest);
  db.prepare(
    "INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES (?,1,0,'stable',?,?,1,1)",
  ).run(l.worktreeId, l.assignmentGenerationId, l.assignmentGenerationId);
  db.prepare(
    "INSERT INTO worktree_runtime_assignment_attestations (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at) VALUES (?,'opencode',?,?,?,'1.18.30',?,1)",
  ).run(
    l.worktreeId,
    l.runtimeGenerationId,
    l.assignmentGenerationId,
    l.catalogGenerationId,
    digest,
  );
  const evidence = new ResourceActivityEvidenceService({
    repository: new ResourceActivityRepository(db),
    keyVersion: 1,
    evidenceKey: Buffer.alloc(32, 7),
    providerContracts: [createOpenCodeEvidenceContract(options)],
    quarantine: () => undefined,
    cancelOwnedInvocation,
    cancellationTimeoutMs: 100,
  });
  evidenceServices.push(evidence);
  return evidence;
}
function managedOptions(f: {
  root: string;
  directory: string;
}): OpenCodeWorktreeRuntimeOptions {
  return {
    namespaceRoot: join(f.root, "runtime"),
    directory: f.directory,
    lineage: {
      worktreeId: "wt",
      assignmentRevision: "1",
      assignmentGenerationId: "gen",
      catalogGenerationId: "catalog",
      runtimeGenerationId: "runtime",
      provider: "opencode",
      providerVersion: "1.18.30",
      adapterContractVersion: 1,
    },
    skills: [],
    capabilities: [],
    environment: { PATH: process.env.PATH },
  };
}
const hosts: CapabilityHostServer[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
});
async function ownedHostConnection() {
  const capability = defineCapability({
    manifest: {
      id: "test.echo",
      name: "Echo",
      version: "1.0.0",
      sdkVersion: "^0.1.0",
      description: "Synthetic echo",
      category: "test",
      author: { name: "Test" },
      license: "MIT",
      compatibility: { opencode: "supported", codex: "supported" },
      permissions: { network: [], secrets: [] },
      settings: {},
    },
    tools: [
      defineTool({
        name: "echo_text",
        description: "Synthetic echo",
        inputSchema: { type: "object" },
        execute: async () => ({ content: [{ type: "text", text: "SAFE" }] }),
      }),
    ],
  });
  const host = createCapabilityHostServer({
    token: "synthetic",
    resolveSecret: async () => undefined,
    registry: async () => capability,
  });
  hosts.push(host);
  await host.setActiveCapabilities([
    { kind: "bundled", capabilityId: "test.echo", version: "1.0.0" },
  ]);
  const port = await host.start();
  return {
    serverName: "owned",
    profileId: "profile",
    url: `http://127.0.0.1:${port}/mcp`,
    authorizationHeader: "Bearer synthetic",
  };
}
describe("OpenCode Worktree Runtime admission", () => {
  it("rejects an unqualified provider version before a session can be created", async () => {
    const fixture = await setup("1.18.34");
    const adapter = new OpenCodeAdapter(100, 100, {
      namespaceRoot: join(fixture.root, "runtime"),
      directory: fixture.directory,
      lineage: {
        worktreeId: "wt",
        assignmentRevision: "1",
        assignmentGenerationId: "gen",
        catalogGenerationId: "catalog",
        runtimeGenerationId: "runtime",
        provider: "opencode",
        providerVersion: "1.18.30",
        adapterContractVersion: 1,
      },
      skills: [],
      capabilities: [],
      environment: { PATH: process.env.PATH },
    });
    adapters.push(adapter);
    await expect(
      adapter.start(fixture.executable, fixture.directory),
    ).rejects.toThrow(/qualified|version/i);
    expect(adapter.getStatus().running).toBe(false);
  });
  it("closes admission when a verified projection is mutated before the next turn", async () => {
    const f = await setup(),
      skill = await assignedSkill(f.root, "alpha");
    const adapter = new OpenCodeAdapter(100, 100, {
      namespaceRoot: join(f.root, "runtime"),
      directory: f.directory,
      lineage: {
        worktreeId: "wt",
        assignmentRevision: "1",
        assignmentGenerationId: "gen",
        catalogGenerationId: "catalog",
        runtimeGenerationId: "runtime",
        provider: "opencode",
        providerVersion: "1.18.30",
        adapterContractVersion: 1,
      },
      skills: [skill],
      capabilities: [],
      environment: { PATH: process.env.PATH },
    });
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test");
    const projected = join(f.root, "runtime/projection/alpha/SKILL.md");
    await chmod(projected, 0o600);
    await writeFile(projected, "corrupt synthetic Skill");
    await expect(
      adapter.sendPrompt(f.directory, session.id, {
        providerId: "fixture",
        modelId: "fixture",
        content: "test",
      }),
    ).rejects.toThrow();
    // Repair cannot reopen this generation after an integrity failure.
    await writeFile(projected, skill.files[0].content);
    await chmod(projected, 0o400);
    await expect(
      adapter.createSession(f.directory, "after-drift"),
    ).rejects.toThrow(/unavailable|isolation/i);
  });
  it("projects disjoint assigned Skills into private namespaces and admits only their exact commands", async () => {
    const a = await setup(),
      b = await setup();
    const skillA = await assignedSkill(a.root, "alpha"),
      skillB = await assignedSkill(b.root, "beta");
    const make = (f: typeof a, skill: typeof skillA) =>
      new OpenCodeAdapter(100, 100, {
        namespaceRoot: join(f.root, "runtime"),
        directory: f.directory,
        lineage: {
          worktreeId: skill.name,
          assignmentRevision: "1",
          assignmentGenerationId: "gen",
          catalogGenerationId: "catalog",
          runtimeGenerationId: "runtime",
          provider: "opencode",
          providerVersion: "1.18.30",
          adapterContractVersion: 1,
        },
        skills: [skill],
        capabilities: [],
        environment: { PATH: process.env.PATH },
      });
    const aa = make(a, skillA),
      bb = make(b, skillB);
    adapters.push(aa, bb);
    await Promise.all([
      aa.start(a.executable, a.directory),
      bb.start(b.executable, b.directory),
    ]);
    await expect(
      aa.verifySkills(a.directory, ["alpha"]),
    ).resolves.toBeUndefined();
    await expect(
      bb.verifySkills(b.directory, ["beta"]),
    ).resolves.toBeUndefined();
    const session = await bb.createSession(b.directory, "test");
    await expect(
      bb.sendPrompt(b.directory, session.id, {
        providerId: "fixture",
        modelId: "fixture",
        explicitSkill: {
          id: "alpha",
          name: "alpha",
          path: join(a.root, "alpha", "SKILL.md"),
        },
      }),
    ).rejects.toThrow(/assigned|Skill/i);
    await expect(
      bb.createSession(a.directory, "wrong-worktree"),
    ).rejects.toThrow(/Worktree|directory/i);
  });
  it("pairs terminal Capability history with trusted host evidence and removes receipts from transcript and events", async () => {
    const f = await setup(),
      options = managedOptions(f);
    const identity = {
      resourceKind: "capability" as const,
      resourceId: "test.echo",
      resourceVersion: "1.0.0",
      resourceDigest: `sha256:${"a".repeat(64)}`,
    };
    options.capabilities = [await ownedHostConnection()];
    options.capabilityTools = [
      {
        serverName: "owned",
        toolName: "echo_text",
        hostToolName: "echo_text",
        identity,
      },
    ];
    const observation = {
      invocationId: "11111111-1111-4111-8111-111111111111",
      capabilityId: "test.echo",
      capabilityVersion: "1.0.0",
      toolName: "echo_text",
    };
    const receipt = JSON.stringify({
      awCapabilityReceipt: {
        version: 1,
        invocationId: observation.invocationId,
        outcome: "success",
      },
    });
    const part = {
      id: "part",
      messageID: "message",
      sessionID: "session-1",
      type: "tool",
      tool: "owned_echo_text",
      callID: "call",
      state: {
        status: "completed",
        input: {},
        output: `SAFE_OUTPUT\n\n${receipt}`,
        title: "Echo",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
    const protocol = JSON.parse(
      await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
    );
    protocol.messages = [
      {
        info: {
          id: "message",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1, completed: 2 },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [
          part,
          {
            id: "echoed-id",
            type: "text",
            sessionID: "session-1",
            messageID: "message",
            text: `Internal receipt identifier ${observation.invocationId}`,
          },
        ],
      },
    ];
    protocol.events = [{ type: "message.part.updated", properties: { part } }];
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    const evidence = evidenceFor(options);
    options.evidence = evidence;
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    const events: unknown[] = [];
    adapter.subscribe((e) => events.push(e));
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test", {
      modelId: "fixture",
      runId: "run",
    });
    evidence.ingestHost({
      lineage: options.lineage,
      identity,
      observation: { ...observation, type: "entered" },
    });
    evidence.ingestHost({
      lineage: options.lineage,
      identity,
      observation: { ...observation, type: "outcome", outcome: "success" },
    });
    await adapter.sendPrompt(f.directory, session.id, {
      providerId: "fixture",
      modelId: "fixture",
      content: "test",
      capabilityProfileId: "profile",
    });
    const messages = await adapter.listMessages(f.directory, session.id);
    expect(evidence.getSnapshot("run").items).toMatchObject([
      { resourceKind: "capability", useState: "confirmed", outcome: "success" },
    ]);
    expect(JSON.stringify({ messages, events })).not.toMatch(
      /awCapabilityReceipt|invocationId|11111111/,
    );
  });

  it("rejects an unassigned provider profile before dispatch", async () => {
    const f = await setup(),
      adapter = new OpenCodeAdapter(100, 100, managedOptions(f));
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test");
    await expect(
      adapter.sendPrompt(f.directory, session.id, {
        providerId: "fixture",
        modelId: "fixture",
        content: "test",
        capabilityProfileId: "ambient-profile",
      }),
    ).rejects.toThrow(/profile|assigned/i);
  });

  it.skipIf(!process.env.AW_OPENCODE_QUALIFICATION_BINARY)(
    "qualifies isolated catalogs and restart/resume on the pinned CLI through the production SDK adapter",
    async () => {
      const binary = qualificationBinary();
      const a = await setup(),
        b = await setup(),
        alpha = await assignedSkill(a.root, "alpha"),
        beta = await assignedSkill(b.root, "beta");
      // Project and external discovery must not contaminate the qualified catalog.
      const ambient = join(a.directory, ".opencode", "skills", "ambient");
      await mkdir(ambient, { recursive: true });
      await writeFile(
        join(ambient, "SKILL.md"),
        "---\nname: ambient\ndescription: Unassigned project Skill.\n---\nNever load this Skill.\n",
      );
      await writeFile(
        join(a.directory, "opencode.json"),
        JSON.stringify({
          command: {
            alpha: { template: "Unassigned project command shadow." },
          },
          skills: { paths: [join(b.root, "beta")] },
        }),
      );
      const oa = managedOptions(a),
        ob = managedOptions(b);
      oa.skills = [alpha];
      ob.skills = [beta];
      ob.lineage.worktreeId = "other-wt";
      const aa = new OpenCodeAdapter(1000, 10000, oa),
        bb = new OpenCodeAdapter(1000, 10000, ob);
      adapters.push(aa, bb);
      await Promise.all([
        aa.start(binary, a.directory),
        bb.start(binary, b.directory),
      ]);
      await aa.verifySkills(a.directory, ["alpha"]);
      await bb.verifySkills(b.directory, ["beta"]);
      const session = await bb.createSession(
        b.directory,
        "synthetic isolated restart qualification",
      );
      await bb.stop();
      await bb.start(binary, b.directory);
      await expect(
        bb.getSession(b.directory, session.id),
      ).resolves.toMatchObject({ id: session.id });
      await expect(
        bb.sendPrompt(b.directory, session.id, {
          providerId: "fixture",
          modelId: "fixture",
          explicitSkill: {
            id: "alpha",
            name: "alpha",
            path: join(oa.namespaceRoot, "projection/alpha/SKILL.md"),
          },
        }),
      ).rejects.toThrow(/assigned/i);
    },
    60000,
  );

  it("closes captured Capability Hosts when owned provider activation fails", async () => {
    const { OpenCodeWorktreeRuntimeFactory } = await import(
      "./opencode-worktree-runtime-factory"
    );
    const f = await setup("unsupported"),
      connection = await ownedHostConnection();
    const host = hosts.at(-1);
    if (!host) throw new Error("Owned test Host unavailable.");
    const factory = new OpenCodeWorktreeRuntimeFactory({
      storageRoot: join(f.root, "runtimes"),
      loadPlan: async (input) => {
        const options = managedOptions(f);
        options.lineage.worktreeId = input.worktreeId;
        options.lineage.runtimeGenerationId = input.generation;
        options.capabilities = [connection];
        options.capabilityTools = [
          {
            serverName: "owned",
            toolName: "echo_text",
            hostToolName: "echo_text",
            identity: {
              resourceKind: "capability",
              resourceId: "test.echo",
              resourceVersion: "1.0.0",
              resourceDigest: `sha256:${"a".repeat(64)}`,
            },
          },
        ];
        options.evidence = evidenceFor(options);
        options.onVerified = async () => undefined;
        options.verifyAttestation = async () => true;
        options.onUnavailable = () => undefined;
        options.subscribeHostObservations = () => () => undefined;
        return {
          executablePath: f.executable,
          options,
          stopOwnedHosts: async () => {
            await host.close();
            const index = hosts.indexOf(host);
            if (index >= 0) hosts.splice(index, 1);
          },
        };
      },
    });
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify: async () => true },
    });
    try {
      await expect(
        manager.acquireProviderSession({
          agentKind: "opencode",
          worktreeId: "wt",
          runId: "run",
          operation: "create",
          assignmentGenerationId: "gen",
          catalogGenerationId: "catalog",
        }),
      ).rejects.toThrow();
      await expect(fetch(connection.url)).rejects.toThrow();
    } finally {
      await manager.shutdown();
    }
  });

  it("launches an owned OpenCode runtime through exact manager routing and database attestation", async () => {
    const { OpenCodeWorktreeRuntimeFactory } = await import(
      "./opencode-worktree-runtime-factory"
    );
    const f = await setup();
    let verifier: DatabaseRuntimeAttestationVerifier;
    const factory = new OpenCodeWorktreeRuntimeFactory({
      storageRoot: join(f.root, "runtimes"),
      loadPlan: async (input: { worktreeId: string; generation: string }) => {
        const options = managedOptions(f);
        options.lineage.worktreeId = input.worktreeId;
        options.lineage.runtimeGenerationId = input.generation;
        options.evidence = evidenceFor(options);
        const db = databases.at(-1);
        if (!db) throw new Error("Test database unavailable.");
        verifier = new DatabaseRuntimeAttestationVerifier(db);
        options.onUnavailable = (l) =>
          verifier.invalidate({
            worktreeId: l.worktreeId,
            agentKind: "opencode",
            runtimeGeneration: l.runtimeGenerationId,
          });
        options.verifyAttestation = (l) =>
          verifier.verify({
            worktreeId: l.worktreeId,
            agentKind: "opencode",
            runtimeGeneration: l.runtimeGenerationId,
            providerVersion: l.providerVersion,
            assignmentGenerationId: l.assignmentGenerationId,
            catalogGenerationId: l.catalogGenerationId,
          });
        options.onVerified = async (digest) =>
          new AssignmentRepository(db).registerRuntimeAttestation({
            worktreeId: input.worktreeId,
            agentKind: "opencode",
            runtimeGeneration: input.generation,
            assignmentGenerationId: "gen",
            catalogGenerationId: "catalog",
            providerVersion: "1.18.30",
            effectiveStateDigest: digest,
            verifiedAt: new Date(),
          });
        return { executablePath: f.executable, options };
      },
    });
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: { verify: (input) => verifier.verify(input) },
    });
    try {
      const lease = await manager.acquireProviderSession({
        agentKind: "opencode",
        worktreeId: "wt",
        runId: "run",
        operation: "create",
        assignmentGenerationId: "gen",
        catalogGenerationId: "catalog",
      });
      const adapter = factory.getAdapter("wt", lease.runtime.generation);
      const session = await adapter.createSession(f.directory, "owned", {
        modelId: "fixture",
        runId: "run",
      });
      manager.registerSessionRoute({
        agentKind: "opencode",
        worktreeId: "wt",
        runId: "run",
        externalSessionId: session.id,
        runtimeGeneration: lease.runtime.generation,
        assignmentGenerationId: "gen",
        catalogGenerationId: "catalog",
      });
      lease.release();
      const resumed = await manager.acquireProviderSession({
        agentKind: "opencode",
        worktreeId: "wt",
        runId: "run",
        operation: "resume",
        externalSessionId: session.id,
        assignmentGenerationId: "gen",
        catalogGenerationId: "catalog",
      });
      expect(await adapter.getSession(f.directory, session.id)).toMatchObject({
        id: session.id,
      });
      resumed.release();
      await expect(
        manager.acquireProviderSession({
          agentKind: "opencode",
          worktreeId: "wt",
          runId: "foreign-run",
          operation: "turn",
          externalSessionId: session.id,
          assignmentGenerationId: "gen",
          catalogGenerationId: "catalog",
        }),
      ).rejects.toThrow(/lineage|route/i);
    } finally {
      await manager.shutdown();
    }
  });

  it("cancels only the exact host dispatch after native provider abort acknowledges", async () => {
    const f = await setup(),
      options = managedOptions(f);
    const identity = {
      resourceKind: "capability" as const,
      resourceId: "test.echo",
      resourceVersion: "1.0.0",
      resourceDigest: `sha256:${"a".repeat(64)}`,
    };
    options.capabilities = [await ownedHostConnection()];
    options.capabilityTools = [
      {
        serverName: "owned",
        toolName: "echo_text",
        hostToolName: "echo_text",
        identity,
      },
    ];
    const protocol = JSON.parse(
      await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
    );
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    let hostListener: NonNullable<
      OpenCodeWorktreeRuntimeOptions["subscribeHostObservations"]
    > extends (listener: infer L) => unknown
      ? L
      : never = () => {
      throw new Error("Host observation subscription unavailable.");
    };
    options.subscribeHostObservations = (listener) => {
      hostListener = listener;
      return () => undefined;
    };
    const invocationId = "11111111-1111-4111-8111-111111111111";
    const observation = {
      invocationId,
      capabilityId: "test.echo",
      capabilityVersion: "1.0.0",
      toolName: "echo_text",
    };
    const cancelled: string[] = [];
    const evidence = evidenceFor(options, async (_lineage, id) => {
      cancelled.push(id);
      hostListener({
        runtimeGeneration: "runtime",
        serverName: "owned",
        observation: { ...observation, type: "outcome", outcome: "cancelled" },
      });
      return true;
    });
    options.evidence = evidence;
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test", {
      modelId: "fixture",
      runId: "run",
    });
    hostListener({
      runtimeGeneration: "runtime",
      serverName: "owned",
      dispatchSessionId: session.id,
      observation: { ...observation, type: "entered" },
    });
    await adapter.abort(f.directory, session.id);
    expect(cancelled).toEqual([invocationId]);
    // Cancellation ownership does not manufacture session Use evidence.
    expect(evidence.getSnapshot("run").items).toEqual([]);
  });

  it.skipIf(!process.env.AW_OPENCODE_QUALIFICATION_BINARY)(
    "qualifies explicit and model-selected Skill context on the pinned CLI and SDK",
    async () => {
      const f = await setup(),
        skill = await assignedSkill(f.root, "alpha"),
        options = managedOptions(f);
      options.skills = [skill];
      const model=await localResponsesFixture(undefined,[null,{name:"skill",arguments:JSON.stringify({name:"alpha"})},null]);models.push(model);
      options.modelProvider={id:"qualification",name:"Local qualification",baseUrl:model.baseUrl};
      const evidence = evidenceFor(options);
      options.evidence = evidence;
      const adapter = new OpenCodeAdapter(1000, 10000, options);
      adapters.push(adapter);
      await adapter.start(qualificationBinary(), f.directory);
      const session = await adapter.createSession(
        f.directory,
        "synthetic context qualification",
        { modelId: "qualification", runId: "run" },
      );
      await adapter.sendPrompt(f.directory, session.id, {
        providerId: "qualification",
        modelId: "qualification",
        explicitSkill: {
          id: "alpha",
          name: "alpha",
          path: join(options.namespaceRoot, "projection/alpha/SKILL.md"),
        },
      });
      expect(evidence.getSnapshot("run").items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resourceKind: "skill",
            useState: "confirmed",
            mode: "explicit",
          }),
        ]),
      );
      await adapter.sendPrompt(f.directory, session.id, {
        providerId: "qualification",
        modelId: "qualification",
        content:
          "Use the builtin skill tool to load alpha exactly once, then reply SAFE_alpha. Do not call other tools or change files.",
      });
      const deadline = Date.now() + 45000;
      while (
        !evidence
          .getSnapshot("run")
          .items.some(
            (i) => i.mode === "automatic" && i.useState === "confirmed",
          ) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 200));
        await adapter.listMessages(f.directory, session.id);
      }
      expect(
        evidence
          .getSnapshot("run")
          .items.some(
            (i) => i.mode === "automatic" && i.useState === "confirmed",
          ),
      ).toBe(true);
    },
    120000,
  );

  it.each([
    "builtin-body",
    "extra-tool",
    "plugin",
    "command-shadow",
    "permission-drift",
    "autoupdate-drift",
  ])("rejects %s drift before activation", async (kind) => {
    const f = await setup(),
      protocol = JSON.parse(
        await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
      );
    if (kind === "builtin-body")
      protocol.baselineSkills[0].content = "changed provider builtin";
    if (kind === "extra-tool") protocol.tools.push("unassigned_tool");
    if (kind === "plugin")
      protocol.configOverride = { plugin: ["ambient-plugin"] };
    if (kind === "command-shadow")
      protocol.configOverride = { command: { alpha: { template: "shadow" } } };
    if (kind === "autoupdate-drift")
      protocol.configOverride = { autoupdate: true };
    if (kind === "permission-drift")
      protocol.configOverride = { permission: { skill: "allow" } };
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    const adapter = new OpenCodeAdapter(100, 100, managedOptions(f));
    adapters.push(adapter);
    await expect(adapter.start(f.executable, f.directory)).rejects.toThrow(
      /isolation/i,
    );
    expect(adapter.getStatus().running).toBe(false);
  });
  it("rejects duplicate transformed Capability tool names before launching", async () => {
    const f = await setup(),
      options = managedOptions(f),
      identity = {
        resourceKind: "capability" as const,
        resourceId: "test.echo",
        resourceVersion: "1.0.0",
        resourceDigest: `sha256:${"a".repeat(64)}`,
      };
    options.capabilities = [
      {
        serverName: "owned",
        profileId: "profile",
        url: "http://127.0.0.1:12345/mcp",
        authorizationHeader: "Bearer synthetic",
      },
    ];
    options.capabilityTools = [
      {
        serverName: "owned",
        toolName: "echo.text",
        hostToolName: "echo.text",
        identity,
      },
      {
        serverName: "owned",
        toolName: "echo_text",
        hostToolName: "echo_text",
        identity,
      },
    ];
    expect(() => new OpenCodeAdapter(100, 100, options)).toThrow(/isolation/i);
  });

  it("confirms explicit command context while keeping the private Skill body out of transcript responses", async () => {
    const f = await setup(),
      skill = await assignedSkill(f.root, "alpha"),
      options = managedOptions(f);
    options.skills = [skill];
    const protocol = JSON.parse(
      await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
    );
    protocol.injectCommand = true;
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    const evidence = evidenceFor(options);
    options.evidence = evidence;
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test", {
      modelId: "fixture",
      runId: "run",
    });
    await adapter.sendPrompt(f.directory, session.id, {
      providerId: "fixture",
      modelId: "fixture",
      explicitSkill: {
        id: "alpha",
        name: "alpha",
        arguments: "Inert additional instruction.",
        path: join(options.namespaceRoot, "projection/alpha/SKILL.md"),
      },
    });
    expect(evidence.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", mode: "explicit" },
    ]);
    const messages = await adapter.listMessages(f.directory, session.id);
    expect(JSON.stringify(messages)).not.toMatch(
      /SAFE_alpha|Base directory|projection/,
    );
  });

  it.skipIf(!process.env.AW_OPENCODE_QUALIFICATION_BINARY)(
    "qualifies success and error Capability receipts on the pinned CLI and SDK",
    async () => {
      const f = await setup(),
        options = managedOptions(f);
      const identity = {
        resourceKind: "capability" as const,
        resourceId: "test.receipt",
        resourceVersion: "1.0.0",
        resourceDigest: `sha256:${"a".repeat(64)}`,
      };
      let listener: (input: OpenCodeOwnedHostObservation) => void = () =>
        undefined;
      let dispatchSessionId: string | undefined;
      const outcomes = [
        "success",
        "reported_error",
        "thrown",
        "timeout",
      ] as const;
      const model=await localResponsesFixture(undefined,outcomes.flatMap(mode=>[{name:`owned_receipt_${mode}`,arguments:"{}"},null]));models.push(model);
      options.modelProvider={id:"qualification",name:"Local qualification",baseUrl:model.baseUrl};
      const capability = defineCapability({
        manifest: {
          id: "test.receipt",
          name: "Receipt qualification",
          version: "1.0.0",
          sdkVersion: "^0.1.0",
          description: "Synthetic inert qualification",
          category: "test",
          author: { name: "Test" },
          license: "MIT",
          compatibility: { opencode: "supported", codex: "supported" },
          permissions: { network: [], secrets: [] },
          settings: {},
        },
        tools: outcomes.map((mode) =>
          defineTool({
            name: `receipt_${mode}`,
            description: `Inert ${mode} receipt check`,
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            execute: async () => {
              if (mode === "thrown") throw new Error("Synthetic throw");
              if (mode === "timeout") return new Promise(() => undefined);
              return {
                isError: mode === "reported_error",
                content: [{ type: "text", text: "SYNTHETIC_RESULT" }],
              };
            },
          }),
        ),
      });
      const observedOutcomes: string[] = [];
      const host = createCapabilityHostServer({
        token: "synthetic-token",
        runtimeGenerationId: "runtime",
        executionTimeoutMs: 100,
        resolveSecret: async () => undefined,
        registry: async () => capability,
        onObservation: (observation) => {
          if (observation.type === "outcome")
            observedOutcomes.push(observation.outcome);
          listener({
            runtimeGeneration: "runtime",
            serverName: "owned",
            dispatchSessionId,
            observation,
          });
        },
      });
      await host.setActiveCapabilities([
        { kind: "bundled", capabilityId: "test.receipt", version: "1.0.0" },
      ]);
      const port = await host.start();
      options.capabilities = [
        {
          serverName: "owned",
          profileId: "profile",
          url: `http://127.0.0.1:${port}/mcp`,
          authorizationHeader: "Bearer synthetic-token",
        },
      ];
      options.capabilityTools = outcomes.map((mode) => ({
        serverName: "owned",
        toolName: `receipt_${mode}`,
        hostToolName: `receipt_${mode}`,
        identity,
      }));
      options.subscribeHostObservations = (callback) => {
        listener = callback;
        return () => {
          listener = () => undefined;
        };
      };
      const evidence = evidenceFor(options, async (l, id) =>
        host.cancelInvocation(l.runtimeGenerationId, id),
      );
      options.evidence = evidence;
      const adapter = new OpenCodeAdapter(1000, 10000, options);
      adapters.push(adapter);
      const providerErrors: string[] = [];
      adapter.subscribe((event) => {
        if (event.type !== "session.error" && event.type !== "message.updated")
          return;
        const properties = event.properties as {
          error?: { name?: string; data?: { statusCode?: number } };
          info?: { error?: { name?: string; data?: { statusCode?: number } } };
        };
        const error = properties.error ?? properties.info?.error;
        if (error)
          providerErrors.push(
            `${error.name ?? "unknown"}:${error.data?.statusCode ?? "unknown"}`,
          );
      });
      try {
        await adapter.start(qualificationBinary(), f.directory);
        for (const mode of outcomes) {
          const session = await adapter.createSession(
            f.directory,
            `synthetic ${mode}`,
            { modelId: "qualification", runId: "run" },
          );
          dispatchSessionId = session.id;
          await adapter.sendPrompt(f.directory, session.id, {
            providerId: "qualification",
            modelId: "qualification",
            capabilityProfileId: "profile",
            content: `Call owned_receipt_${mode} exactly once with an empty object. Do not retry or call any other tool. Then reply DONE.`,
          });
          const deadline = Date.now() + 45000;
          while (
            !evidence
              .getSnapshot("run")
              .items.some(
                (i) =>
                  i.resourceKind === "capability" &&
                  i.useState === "confirmed" &&
                  i.outcome === mode,
              ) &&
            Date.now() < deadline
          ) {
            await new Promise((r) => setTimeout(r, 200));
            await adapter.listMessages(f.directory, session.id);
          }
          expect(
            evidence
              .getSnapshot("run")
              .items.some(
                (i) =>
                  i.resourceKind === "capability" &&
                  i.useState === "confirmed" &&
                  i.outcome === mode,
              ),
            `Expected ${mode}; Host outcomes: ${observedOutcomes.join(",")}; provider error classes: ${providerErrors.join(",")}; observed tool statuses: ${JSON.stringify((await adapter.listMessages(f.directory, session.id)).flatMap((m) => m.tools.map((t) => ({ tool: t.tool, status: t.status }))))}`,
          ).toBe(true);
          const history = await adapter.listMessages(f.directory, session.id);
          expect(JSON.stringify(history)).not.toMatch(
            /awCapabilityReceipt|invocationId/,
          );
        }
      } finally {
        await adapter.stop();
        await host.close();
      }
    },
    240000,
  );

  it("fails closed on a ToolPart attached to an unqualified user message", async () => {
    const f = await setup(),
      skill = await assignedSkill(f.root, "alpha"),
      options = managedOptions(f);
    options.skills = [skill];
    const protocol = JSON.parse(
      await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
    );
    protocol.messages = [
      {
        info: {
          id: "user",
          sessionID: "session-1",
          role: "user",
          time: { created: 1 },
        },
        parts: [
          {
            id: "part",
            messageID: "user",
            sessionID: "session-1",
            type: "tool",
            tool: "skill",
            state: {
              status: "completed",
              input: { name: "alpha" },
              metadata: {
                name: "alpha",
                dir: join(options.namespaceRoot, "projection/alpha"),
              },
              output: `<skill_content name="alpha">\n# Skill: alpha\n\nReply SAFE_alpha. Do not change files.\n\nBase directory for this skill: ${join(options.namespaceRoot, "projection/alpha")}\nRelative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.\nNote: file list is sampled.\n\n<skill_files>\n\n</skill_files>\n</skill_content>`,
            },
          },
        ],
      },
    ];
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    const evidence = evidenceFor(options);
    options.evidence = evidence;
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const session = await adapter.createSession(f.directory, "test", {
      modelId: "fixture",
      runId: "run",
    });
    await expect(adapter.listMessages(f.directory, session.id)).rejects.toThrow(
      /schema|evidence/i,
    );
    expect(
      evidence.getSnapshot("run").items.some((i) => i.useState === "confirmed"),
    ).toBe(false);
  });

  it("rejects automatic permission escalation of an explicit-only Skill", async () => {
    const f = await setup(),
      options = managedOptions(f);
    const original = await assignedSkill(f.root, "alpha");
    const files = original.files.map((file) => ({
      ...file,
      content: file.content.replace(
        "description:",
        "disable-model-invocation: true\ndescription:",
      ),
    }));
    const source = join(f.root, "alpha");
    for (const file of files)
      await writeFile(join(source, file.relativePath), file.content);
    const validated = await validateSkillPackage(source);
    options.skills = [
      {
        ...original,
        files,
        automaticInvocation: true,
        identity: {
          ...original.identity,
          resourceDigest: validated.contentDigest,
        },
      },
    ];
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await expect(adapter.start(f.executable, f.directory)).rejects.toThrow(
      /isolation|projection|unavailable/i,
    );
  });

  it("rejects replacement of the Worktree session owner marker before admission", async () => {
    const f = await setup(),
      options = managedOptions(f);
    options.sessionDataRoot = join(f.root, "persistent-data");
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const replacement = join(options.sessionDataRoot, "replacement");
    await writeFile(
      replacement,
      JSON.stringify({
        provider: "opencode",
        worktreeId: options.lineage.worktreeId,
      }),
      { mode: 0o400 },
    );
    await rename(
      replacement,
      join(options.sessionDataRoot, ".aw-worktree-owner"),
    );
    await expect(adapter.createSession(f.directory, "test")).rejects.toThrow(
      /isolation|unavailable/i,
    );
  });

  it("rejects replacement of an immutable Skill file even when its bytes match", async () => {
    const f = await setup(),
      skill = await assignedSkill(f.root, "alpha"),
      options = managedOptions(f);
    options.skills = [skill];
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    const parent = join(options.namespaceRoot, "projection/alpha"),
      file = join(parent, "SKILL.md");
    await chmod(parent, 0o700);
    const replacement = join(parent, "replacement.md");
    await writeFile(replacement, skill.files[0].content, { mode: 0o400 });
    await rename(replacement, file);
    await chmod(parent, 0o500);
    await expect(
      adapter.createSession(f.directory, "replaced projection"),
    ).rejects.toThrow(/isolation/i);
  });

  it("ignores retired host callbacks without invalidating the current runtime generation", async () => {
    const f = await setup(),
      options = managedOptions(f);
    let listener: (input: OpenCodeOwnedHostObservation) => void = () =>
      undefined;
    options.subscribeHostObservations = (callback) => {
      listener = callback;
      return () => undefined;
    };
    const adapter = new OpenCodeAdapter(100, 100, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    listener({
      runtimeGeneration: "retired",
      serverName: "retired-server",
      observation: {
        type: "entered",
        invocationId: "11111111-1111-4111-8111-111111111111",
        capabilityId: "retired",
        capabilityVersion: "1.0.0",
        toolName: "retired",
      },
    });
    await expect(
      adapter.createSession(f.directory, "current"),
    ).resolves.toMatchObject({ id: "session-1" });
  });

  it.skipIf(!process.env.AW_OPENCODE_QUALIFICATION_BINARY)(
    "qualifies session resume across new runtime namespaces on the pinned CLI",
    async () => {
      const f = await setup(),
        first = managedOptions(f);
      first.sessionDataRoot = join(f.root, "worktree-data");
      const a = new OpenCodeAdapter(1000, 10000, first);
      adapters.push(a);
      await a.start(qualificationBinary(), f.directory);
      const session = await a.createSession(
        f.directory,
        "synthetic persistent resume",
      );
      await a.stop();
      const second = {
        ...first,
        namespaceRoot: join(f.root, "replacement-runtime"),
        lineage: { ...first.lineage, runtimeGenerationId: "replacement" },
      };
      const b = new OpenCodeAdapter(1000, 10000, second);
      adapters.push(b);
      await b.start(qualificationBinary(), f.directory);
      await expect(
        b.getSession(f.directory, session.id),
      ).resolves.toMatchObject({ id: session.id });
    },
    60000,
  );

  it("does not attribute retained pre-resume history to a new runtime generation", async () => {
    const f = await setup(),
      options = managedOptions(f),
      identity = {
        resourceKind: "capability" as const,
        resourceId: "test.echo",
        resourceVersion: "1.0.0",
        resourceDigest: `sha256:${"a".repeat(64)}`,
      };
    options.capabilities = [await ownedHostConnection()];
    options.capabilityTools = [
      {
        serverName: "owned",
        toolName: "echo_text",
        hostToolName: "echo_text",
        identity,
      },
    ];
    const protocol = JSON.parse(
      await readFile(join(f.directory, "provider-fixture.json"), "utf8"),
    );
    protocol.messages = [
      {
        info: {
          id: "old-message",
          sessionID: "session-1",
          role: "assistant",
          time: { created: 1, completed: 2 },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [
          {
            id: "old-part",
            messageID: "old-message",
            sessionID: "session-1",
            type: "tool",
            tool: "owned_echo_text",
            state: {
              status: "completed",
              input: {},
              output: JSON.stringify({
                awCapabilityReceipt: {
                  version: 1,
                  invocationId: "11111111-1111-4111-8111-111111111111",
                  outcome: "success",
                },
              }),
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ];
    await writeFile(
      join(f.directory, "provider-fixture.json"),
      JSON.stringify(protocol),
    );
    const evidence = evidenceFor(options);
    options.evidence = evidence;
    const adapter = new OpenCodeAdapter(1000, 1000, options);
    adapters.push(adapter);
    await adapter.start(f.executable, f.directory);
    await adapter.getSession(f.directory, "session-1", { runId: "run" });
    await adapter.listMessages(f.directory, "session-1");
    expect(evidence.getSnapshot("run").items).toEqual([]);
  });
});
