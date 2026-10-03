import { WorktreeRuntimeManager } from "./worktree-runtime-manager";
import {
  defineCapability,
  defineTool,
} from "@agentic-worktrees/capability-sdk";
import { createCapabilityHostServer } from "../capabilities/capability-host-server";
import { afterEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateSkillPackage } from "../skills/skill-validation";
import type { CodexWorktreeRuntimeOptions } from "./codex-worktree-runtime";
import { localResponsesFixture } from "./fixtures/codex-local-responses-fixture";
import {
  evidenceFor,
  attachRuntimeAttestation,
  closeEvidenceFixtures,
} from "./fixtures/codex-runtime-evidence-fixture";
import { CodexAdapter } from "./codex-adapter";

function qualificationBinary(): string {
  const binary = process.env.AW_CODEX_QUALIFICATION_BINARY;
  if (!binary) throw new Error("Pinned qualification binary is required.");
  return binary;
}
const adapters: CodexAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.stop()));
  closeEvidenceFixtures();
});
async function setup(version = "0.154.0") {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-codex-runtime-")),
  );
  await writeFile(
    join(root, "codex-fixture.json"),
    JSON.stringify({ version }),
  );
  const binary = join(root, "provider");
  await writeFile(
    binary,
    `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
  );
  await chmod(binary, 0o700);
  return { root, binary };
}
function options(root: string): CodexWorktreeRuntimeOptions {
  return {
    namespaceRoot: join(root, "private"),
    directory: root,
    lineage: {
      worktreeId: "wt",
      assignmentRevision: "1",
      provider: "codex" as const,
      runtimeGenerationId: "runtime",
      assignmentGenerationId: "assignment",
      catalogGenerationId: "catalog",
      providerVersion: "0.154.0",
      adapterContractVersion: 1,
    },
    skills: [],
    capabilities: [],
    capabilityTools: [],
    environment: { PATH: process.env.PATH },
  };
}
describe("Codex Worktree Runtime public admission", () => {
  it("rejects an unsupported provider before managed session admission", async () => {
    const f = await setup("0.159.3"),
      adapter = new CodexAdapter(undefined, undefined, options(f.root));
    adapters.push(adapter);
    await expect(adapter.start(f.binary, f.root)).rejects.toThrow(
      "Codex provider version is not qualified for Worktree Resources.",
    );
    expect(adapter.getStatus().running).toBe(false);
  });
  it("rejects unassigned explicit Skills before provider turn admission", async () => {
    const f = await setup(),
      adapter = new CodexAdapter(undefined, undefined, options(f.root));
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    const session = await adapter.createSession(f.root, "test", {
      modelId: "fixture",
    });
    await expect(
      adapter.sendPrompt(f.root, session.id, {
        providerId: "openai",
        modelId: "fixture",
        explicitSkill: {
          id: "ambient",
          name: "ambient",
          path: join(f.root, "ambient/SKILL.md"),
        },
      }),
    ).rejects.toThrow(/not assigned/i);
    const recorded = await readFile(join(f.root, "requests.jsonl"), "utf8");
    expect(recorded).not.toContain('"method":"turn/start"');
  });

  it("projects immutable assigned Skills in a private runtime while declaring non-enforced isolation", async () => {
    const f = await setup(),
      plan = options(f.root),
      source = join(f.root, "alpha");
    await mkdir(source);
    const document =
      "---\nname: alpha\ndescription: Synthetic qualification.\n---\nReply SAFE_ALPHA.\n";
    await writeFile(join(source, "SKILL.md"), document);
    const validated = await validateSkillPackage(source);
    plan.skills = [
      {
        name: "alpha",
        identity: {
          resourceKind: "skill",
          resourceId: "alpha",
          resourceVersion: "1.0.0",
          resourceDigest: validated.contentDigest,
        },
        files: validated.files,
      },
    ];
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    const projected = join(plan.namespaceRoot, "skills/alpha/SKILL.md");
    expect(await readFile(projected, "utf8")).toBe(document);
    expect((await stat(projected)).mode & 0o222).toBe(0);
    const environment = JSON.parse(
      await readFile(join(f.root, "environment.json"), "utf8"),
    );
    expect(environment.CODEX_HOME).toBe(join(plan.namespaceRoot, "data"));
    const session = await adapter.createSession(f.root, "test", {
      modelId: "fixture",
    });
    expect(session).toMatchObject({ skillIsolation: "not_enforced" });
    await adapter.sendPrompt(f.root, session.id, {
      providerId: "openai",
      modelId: "fixture",
      explicitSkill: { id: "alpha", name: "alpha", path: projected },
    });
  });

  it("auto-approves tools only for immutable app-managed Capability connections", async () => {
    const f = await setup(),
      plan = options(f.root);
    plan.capabilities = [
      {
        serverName: "owned",
        profileId: "profile",
        url: "http://127.0.0.1:12345/mcp",
        authorizationHeader: "Bearer synthetic",
      },
    ];
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    await adapter.createSession(f.root, "test", { modelId: "fixture" });
    const request = (await readFile(join(f.root, "requests.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((r) => r.method === "thread/start");
    expect(request.params.config?.mcp_servers).toEqual({
      owned: {
        url: "http://127.0.0.1:12345/mcp",
        http_headers: { Authorization: "Bearer synthetic" },
        default_tools_approval_mode: "approve",
      },
    });
  });

  it.each(["success", "reported_error", "thrown", "timeout"] as const)(
    "pairs terminal %s MCP receipts with trusted Host entry in the exact application session",
    async (outcome) => {
      const f = await setup(),
        plan = options(f.root);
      const identity = {
        resourceKind: "capability" as const,
        resourceId: "test.echo",
        resourceVersion: "1.0.0",
        resourceDigest: `sha256:${"a".repeat(64)}`,
      };
      plan.capabilityTools = [
        {
          serverName: "owned",
          toolName: "echo",
          hostToolName: "echo",
          identity,
        },
      ];
      const observation = {
        invocationId: "11111111-1111-4111-8111-111111111111",
        capabilityId: "test.echo",
        capabilityVersion: "1.0.0",
        toolName: "echo",
      };
      const evidence = evidenceFor(plan);
      plan.evidence = evidence;
      evidence.ingestHost({
        lineage: plan.lineage,
        identity,
        observation: { ...observation, type: "entered" },
      });
      evidence.ingestHost({
        lineage: plan.lineage,
        identity,
        observation: { ...observation, type: "outcome", outcome },
      });
      const result = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              awCapabilityReceipt: {
                version: 1,
                invocationId: observation.invocationId,
                outcome,
              },
            }),
          },
        ],
      };
      await writeFile(
        join(f.root, "codex-fixture.json"),
        JSON.stringify({
          version: "0.154.0",
          thread: {
            id: "thread-1",
            cwd: f.root,
            status: { type: "idle" },
            turns: [
              {
                id: "turn-1",
                status: "completed",
                error: null,
                startedAt: 1,
                completedAt: 2,
                items: [
                  {
                    type: "mcpToolCall",
                    id: "item-1",
                    server: "owned",
                    tool: "echo",
                    status: outcome === "success" ? "completed" : "failed",
                    result,
                    error: null,
                  },
                ],
              },
            ],
          },
        }),
      );
      const adapter = new CodexAdapter(undefined, undefined, plan);
      adapters.push(adapter);
      await adapter.start(f.binary, f.root);
      const session = await adapter.createSession(f.root, "test", {
        modelId: "fixture",
        runId: "run",
      });
      const history = await adapter.listMessages(f.root, session.id);
      expect(evidence.getSnapshot("run").items).toEqual([
        expect.objectContaining({
          resourceId: "test.echo",
          useState: "confirmed",
          outcome,
        }),
      ]);
      expect(JSON.stringify(history)).not.toMatch(
        /awCapabilityReceipt|11111111/,
      );
    },
  );

  it.skipIf(!process.env.AW_CODEX_QUALIFICATION_BINARY)(
    "qualifies private launch and non-enforced Skill posture on the pinned CLI",
    async () => {
      const binary = process.env.AW_CODEX_QUALIFICATION_BINARY;
      if (!binary)
        throw new Error("Pinned Codex qualification binary is required.");
      const f = await setup(),
        adapter = new CodexAdapter(undefined, undefined, options(f.root));
      adapters.push(adapter);
      await adapter.start(binary, f.root);
      const session = await adapter.createSession(
        f.root,
        "synthetic qualification",
        { modelId: "gpt-5.4" },
      );
      expect(session).toMatchObject({ skillIsolation: "not_enforced" });
    },
    30000,
  );

  it.skipIf(!process.env.AW_CODEX_QUALIFICATION_BINARY)(
    "qualifies actual pinned CLI turns against the local Responses boundary",
    async () => {
      const binary = process.env.AW_CODEX_QUALIFICATION_BINARY;
      if (!binary)
        throw new Error("Pinned Codex qualification binary is required.");
      const f = await setup(),
        model = await localResponsesFixture(),
        plan = options(f.root);
      plan.modelProvider = {
        id: "qualification",
        name: "Local qualification",
        baseUrl: model.baseUrl,
      };
      const adapter = new CodexAdapter(undefined, undefined, plan);
      adapters.push(adapter);
      try {
        await adapter.start(binary, f.root);
        const session = await adapter.createSession(
          f.root,
          "synthetic qualification",
          { modelId: "gpt-5.4" },
        );
        await adapter.sendPrompt(f.root, session.id, {
          providerId: "openai",
          modelId: "gpt-5.4",
          content:
            "Synthetic qualification. Reply SYNTHETIC_DONE. Use no tools.",
        });
        const deadline = Date.now() + 10000;
        let history = await adapter.listMessages(f.root, session.id);
        while (
          !history.some((m) => m.content === "SYNTHETIC_DONE") &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 50));
          history = await adapter.listMessages(f.root, session.id);
        }
        expect(history.some((m) => m.content === "SYNTHETIC_DONE")).toBe(true);
      } finally {
        await adapter.stop();
        await model.close();
      }
    },
    30000,
  );

  it.skipIf(!process.env.AW_CODEX_QUALIFICATION_BINARY)(
    "confirms explicit assigned Skill context from the pinned CLI owned rollout",
    async () => {
      const f = await setup(),
        plan = options(f.root),
        source = join(f.root, "alpha");
      await mkdir(source);
      await writeFile(
        join(source, "SKILL.md"),
        "---\nname: alpha\ndescription: Synthetic qualification.\n---\nReply SAFE_ALPHA.\n",
      );
      const validated = await validateSkillPackage(source);
      plan.skills = [
        {
          name: "alpha",
          identity: {
            resourceKind: "skill",
            resourceId: "alpha",
            resourceVersion: "1.0.0",
            resourceDigest: validated.contentDigest,
          },
          files: validated.files,
        },
      ];
      const evidence = evidenceFor(plan);
      plan.evidence = evidence;
      const model = await localResponsesFixture();
      plan.modelProvider = {
        id: "qualification",
        name: "Local qualification",
        baseUrl: model.baseUrl,
      };
      const adapter = new CodexAdapter(undefined, undefined, plan);
      adapters.push(adapter);
      try {
        await adapter.start(qualificationBinary(), f.root);
        const session = await adapter.createSession(f.root, "test", {
          modelId: "gpt-5.4",
          runId: "run",
        });
        await adapter.sendPrompt(f.root, session.id, {
          providerId: "openai",
          modelId: "gpt-5.4",
          explicitSkill: {
            id: "alpha",
            name: "alpha",
            path: join(plan.namespaceRoot, "skills/alpha/SKILL.md"),
          },
        });
        const deadline = Date.now() + 5000;
        do {
          await adapter.listMessages(f.root, session.id);
          if (
            evidence
              .getSnapshot("run")
              .items.some((i) => i.useState === "confirmed")
          )
            break;
          await new Promise((r) => setTimeout(r, 50));
        } while (Date.now() < deadline);
        expect(evidence.getSnapshot("run").items).toEqual([
          expect.objectContaining({
            resourceId: "alpha",
            useState: "confirmed",
            mode: "explicit",
          }),
        ]);
      } finally {
        await adapter.stop();
        await model.close();
      }
    },
    30000,
  );

  it
    .skipIf(!process.env.AW_CODEX_QUALIFICATION_BINARY)
    .each([
      "success",
      "reported_error",
      "thrown",
      "timeout",
      "cancelled",
    ] as const)(
    "qualifies actual terminal MCP %s through the owned Host",
    async (outcome) => {
      const f = await setup(),
        plan = options(f.root),
        identity = {
          resourceKind: "capability" as const,
          resourceId: "test.echo",
          resourceVersion: "1.0.0",
          resourceDigest: `sha256:${"a".repeat(64)}`,
        };
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
          compatibility: { codex: "supported", opencode: "supported" },
          permissions: { network: [], secrets: [] },
          settings: {},
        },
        tools: [
          defineTool({
            name: "echo",
            description: "Inert echo",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            execute: async () => {
              if (outcome === "thrown") throw new Error("Synthetic throw");
              if (outcome === "timeout" || outcome === "cancelled")
                return new Promise(() => undefined);
              return {
                isError: outcome === "reported_error",
                content: [{ type: "text", text: "SAFE" }],
              };
            },
          }),
        ],
      });
      let listener: Parameters<
        NonNullable<CodexWorktreeRuntimeOptions["subscribeHostObservations"]>
      >[0] = () => undefined;
      let entered = false,
        cancelled = false,
        dispatchSessionId: string | undefined;
      const host = createCapabilityHostServer({
        token: "synthetic",
        runtimeGenerationId: "runtime",
        executionTimeoutMs: outcome === "cancelled" ? 10000 : 100,
        registry: async () => capability,
        resolveSecret: async () => undefined,
        onObservation: (observation) => {
          entered ||= observation.type === "entered";
          cancelled ||=
            observation.type === "outcome" &&
            observation.outcome === "cancelled";
          listener({
            runtimeGeneration: "runtime",
            serverName: "owned",
            dispatchSessionId,
            observation,
          });
        },
      });
      await host.setActiveCapabilities([
        { kind: "bundled", capabilityId: "test.echo", version: "1.0.0" },
      ]);
      const port = await host.start();
      plan.capabilities = [
        {
          serverName: "owned",
          profileId: "profile",
          url: `http://127.0.0.1:${port}/mcp`,
          authorizationHeader: "Bearer synthetic",
        },
      ];
      plan.capabilityTools = [
        {
          serverName: "owned",
          toolName: "echo",
          hostToolName: "echo",
          identity,
        },
      ];
      plan.subscribeHostObservations = (callback) => {
        listener = callback;
        return () => {
          listener = () => undefined;
        };
      };
      const evidence = evidenceFor(plan, async (l, id) =>
        host.cancelInvocation(l.runtimeGenerationId, id),
      );
      plan.evidence = evidence;
      attachRuntimeAttestation(plan);
      const model = await localResponsesFixture("mcp__owned__echo");
      plan.modelProvider = {
        id: "qualification",
        name: "Local qualification",
        baseUrl: model.baseUrl,
      };
      const adapter = new CodexAdapter(undefined, undefined, plan);
      adapters.push(adapter);
      try {
        await adapter.start(qualificationBinary(), f.root);
        const session = await adapter.createSession(f.root, "test", {
          modelId: "gpt-5.1-codex-max",
          runId: "run",
        });
        dispatchSessionId = session.id;
        await adapter.sendPrompt(f.root, session.id, {
          providerId: "openai",
          modelId: "gpt-5.1-codex-max",
          content: "Synthetic fixture.",
        });
        const deadline = Date.now() + 8000;
        if (outcome === "cancelled") {
          while (!entered && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 20));
          expect(entered).toBe(true);
          await adapter.abort(f.root, session.id);
          await adapter.listMessages(f.root, session.id);
          expect(cancelled).toBe(true);
          expect(evidence.getSnapshot("run").items).toHaveLength(1);
          expect(
            evidence
              .getSnapshot("run")
              .items.every(
                (i) =>
                  i.useState === "not_confirmed" || i.outcome === "cancelled",
              ),
          ).toBe(true);
          return;
        }
        do {
          await adapter.listMessages(f.root, session.id);
          if (
            evidence
              .getSnapshot("run")
              .items.some((i) => i.useState === "confirmed")
          )
            break;
          await new Promise((r) => setTimeout(r, 50));
        } while (Date.now() < deadline);
        expect(evidence.getSnapshot("run").items).toEqual([
          expect.objectContaining({
            resourceId: "test.echo",
            useState: "confirmed",
            outcome,
          }),
        ]);
        if (outcome === "success") {
          await adapter.sendPrompt(f.root, session.id, {
            providerId: "openai",
            modelId: "gpt-5.1-codex-max",
            content: "Synthetic retry.",
          });
          const retryDeadline = Date.now() + 5000;
          while (
            evidence.getSnapshot("run").items.length < 2 &&
            Date.now() < retryDeadline
          ) {
            await adapter.listMessages(f.root, session.id);
            await new Promise((r) => setTimeout(r, 20));
          }
          await adapter.listMessages(f.root, session.id);
          await adapter.getSession(f.root, session.id);
          expect(evidence.getSnapshot("run").items).toHaveLength(2);
        }
      } finally {
        await adapter.stop();
        await model.close();
        await host.close();
      }
    },
    30000,
  );

  it("does not attribute retained resume history to a new application route", async () => {
    const f = await setup(),
      plan = options(f.root),
      identity = {
        resourceKind: "capability" as const,
        resourceId: "test.echo",
        resourceVersion: "1.0.0",
        resourceDigest: `sha256:${"a".repeat(64)}`,
      };
    plan.capabilityTools = [
      { serverName: "owned", toolName: "echo", hostToolName: "echo", identity },
    ];
    const evidence = evidenceFor(plan);
    plan.evidence = evidence;
    const invocationId = "11111111-1111-4111-8111-111111111111";
    evidence.ingestHost({
      lineage: plan.lineage,
      identity,
      observation: {
        type: "entered",
        invocationId,
        capabilityId: "test.echo",
        capabilityVersion: "1.0.0",
        toolName: "echo",
      },
    });
    await writeFile(
      join(f.root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        thread: {
          id: "old-thread",
          cwd: f.root,
          status: { type: "idle" },
          turns: [
            {
              id: "old-turn",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              items: [
                {
                  type: "mcpToolCall",
                  id: "old-item",
                  server: "owned",
                  tool: "echo",
                  status: "completed",
                  result: {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          awCapabilityReceipt: {
                            version: 1,
                            invocationId,
                            outcome: "success",
                          },
                        }),
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    await adapter.getSession(f.root, "old-thread", { runId: "run" });
    await adapter.listMessages(f.root, "old-thread");
    expect(evidence.getSnapshot("run").items).toEqual([]);
  });

  it("routes an owned runtime through manager attestation and rejects turns after invalidation", async () => {
    const { CodexWorktreeRuntimeFactory } =
      await import("./codex-worktree-runtime-factory");
    const f = await setup();
    let verifier: ReturnType<typeof attachRuntimeAttestation> | undefined;
    const factory = new CodexWorktreeRuntimeFactory({
      storageRoot: join(f.root, "runtimes"),
      loadPlan: async (input) => {
        const plan = options(f.root);
        plan.lineage.runtimeGenerationId = input.generation;
        plan.evidence = evidenceFor(plan);
        verifier = attachRuntimeAttestation(plan);
        return { executablePath: f.binary, options: plan };
      },
    });
    const manager = new WorktreeRuntimeManager({
      factory,
      attestationVerifier: {
        verify: (input) => verifier?.verify(input) ?? Promise.resolve(false),
      },
    });
    try {
      const lease = await manager.acquireProviderSession({
        agentKind: "codex",
        worktreeId: "wt",
        runId: "run",
        operation: "create",
        assignmentGenerationId: "assignment",
        catalogGenerationId: "catalog",
      });
      const adapter = factory.getAdapter("wt", lease.runtime.generation),
        session = await adapter.createSession(f.root, "test", {
          modelId: "fixture",
          runId: "run",
        });
      manager.registerSessionRoute({
        agentKind: "codex",
        worktreeId: "wt",
        runId: "run",
        externalSessionId: session.id,
        runtimeGeneration: lease.runtime.generation,
        assignmentGenerationId: "assignment",
        catalogGenerationId: "catalog",
      });
      lease.release();
      if (!verifier) throw new Error("Fixture verifier unavailable.");
      verifier.invalidate({
        agentKind: "codex",
        worktreeId: "wt",
        runtimeGeneration: lease.runtime.generation,
      });
      await expect(
        adapter.sendPrompt(f.root, session.id, {
          providerId: "openai",
          modelId: "fixture",
          content: "test",
        }),
      ).rejects.toThrow(/verification/i);
    } finally {
      await manager.shutdown();
    }
  });

  it("rejects turn admission when the provider managed MCP catalog differs from Assignment", async () => {
    const f = await setup(),
      plan = options(f.root);
    plan.capabilities = [
      {
        serverName: "owned",
        profileId: "profile",
        url: "http://127.0.0.1:12345/mcp",
        authorizationHeader: "Bearer synthetic",
      },
    ];
    await writeFile(
      join(f.root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        servers: [
          {
            name: "owned",
            runtimeStatus: "connected",
            tools: { unassigned: {} },
          },
        ],
      }),
    );
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    await expect(
      adapter.createSession(f.root, "test", { modelId: "fixture" }),
    ).rejects.toThrow(/catalog/i);
  });

  it("rejects legacy global catalog mutation on a managed runtime", async () => {
    const f = await setup(),
      adapter = new CodexAdapter(undefined, undefined, options(f.root));
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    await expect(adapter.configureSkills(null)).rejects.toThrow(/Assignment/i);
  });

  it.each([
    "missing_terminal",
    "missing_receipt",
    "conflict",
    "stale",
    "direct_credential",
  ] as const)(
    "keeps %s evidence unconfirmed at the session boundary",
    async (scenario) => {
      const f = await setup(),
        plan = options(f.root),
        identity = {
          resourceKind: "capability" as const,
          resourceId: "test.echo",
          resourceVersion: "1.0.0",
          resourceDigest: `sha256:${"a".repeat(64)}`,
        };
      plan.capabilityTools = [
        {
          serverName: "owned",
          toolName: "echo",
          hostToolName: "echo",
          identity,
        },
      ];
      const evidence = evidenceFor(plan);
      plan.evidence = evidence;
      const invocationId = "11111111-1111-4111-8111-111111111111",
        observation = {
          type: "entered" as const,
          invocationId,
          capabilityId: "test.echo",
          capabilityVersion: "1.0.0",
          toolName: "echo",
        };
      evidence.ingestHost({
        lineage:
          scenario === "stale"
            ? { ...plan.lineage, runtimeGenerationId: "stale" }
            : plan.lineage,
        identity,
        observation,
      });
      if (scenario === "conflict")
        evidence.ingestHost({
          lineage: plan.lineage,
          identity,
          observation: { ...observation, toolName: "conflicting" },
        });
      const result = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              awCapabilityReceipt: {
                version: 1,
                invocationId,
                outcome: "success",
              },
            }),
          },
        ],
      };
      await writeFile(
        join(f.root, "codex-fixture.json"),
        JSON.stringify({
          version: "0.154.0",
          thread: {
            id: "thread-1",
            cwd: f.root,
            status: { type: "idle" },
            turns: [
              {
                id: "turn-1",
                status: "completed",
                error: null,
                startedAt: 1,
                completedAt: 2,
                items:
                  scenario === "direct_credential"
                    ? []
                    : [
                        {
                          type: "mcpToolCall",
                          id: "item",
                          server: "owned",
                          tool: "echo",
                          status:
                            scenario === "missing_terminal"
                              ? "inProgress"
                              : "completed",
                          result:
                            scenario === "missing_receipt"
                              ? { content: [{ type: "text", text: "SAFE" }] }
                              : result,
                        },
                      ],
              },
            ],
          },
        }),
      );
      const adapter = new CodexAdapter(undefined, undefined, plan);
      adapters.push(adapter);
      await adapter.start(f.binary, f.root);
      const session = await adapter.createSession(f.root, "test", {
        modelId: "fixture",
        runId: "run",
      });
      await adapter.listMessages(f.root, session.id);
      expect(evidence.getSnapshot("run").items).toHaveLength(
        scenario === "direct_credential" ? 0 : 1,
      );
      expect(
        evidence
          .getSnapshot("run")
          .items.every((item) => item.useState === "not_confirmed"),
      ).toBe(true);
    },
  );

  it.skipIf(!process.env.AW_CODEX_QUALIFICATION_BINARY)(
    "resumes a retained thread after replacement of the owned runtime generation",
    async () => {
      const f = await setup(),
        first = options(f.root),
        model = await localResponsesFixture();
      first.sessionDataRoot = join(f.root, "persistent-data");
      first.modelProvider = {
        id: "qualification",
        name: "Local qualification",
        baseUrl: model.baseUrl,
      };
      const a = new CodexAdapter(undefined, undefined, first);
      adapters.push(a);
      try {
        await a.start(qualificationBinary(), f.root);
        const session = await a.createSession(f.root, "test", {
          modelId: "gpt-5.4",
        });
        await a.sendPrompt(f.root, session.id, {
          providerId: "openai",
          modelId: "gpt-5.4",
          content: "Synthetic fixture.",
        });
        const deadline = Date.now() + 5000;
        while (
          !(await a.listMessages(f.root, session.id)).some(
            (m) => m.content === "SYNTHETIC_DONE",
          ) &&
          Date.now() < deadline
        )
          await new Promise((r) => setTimeout(r, 50));
        await a.stop();
        const b = new CodexAdapter(undefined, undefined, {
          ...first,
          namespaceRoot: join(f.root, "replacement"),
          lineage: { ...first.lineage, runtimeGenerationId: "replacement" },
        });
        adapters.push(b);
        await b.start(qualificationBinary(), f.root);
        expect(await b.getSession(f.root, session.id)).toMatchObject({
          id: session.id,
          skillIsolation: "not_enforced",
        });
        expect(
          (await b.listMessages(f.root, session.id)).some(
            (m) => m.content === "SYNTHETIC_DONE",
          ),
        ).toBe(true);
      } finally {
        await model.close();
      }
    },
    30000,
  );

  it("invalidates runtime attestation when its owned provider process exits", async () => {
    const f = await setup(),
      plan = options(f.root);
    plan.evidence = evidenceFor(plan);
    const verifier = attachRuntimeAttestation(plan);
    await writeFile(
      join(f.root, "codex-fixture.json"),
      JSON.stringify({ version: "0.154.0", exitAfterThreadStart: true }),
    );
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    await adapter.createSession(f.root, "test", {
      modelId: "fixture",
      runId: "run",
    });
    const deadline = Date.now() + 1000;
    while (adapter.getStatus().running && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
    expect(adapter.getStatus().running).toBe(false);
    expect(
      await verifier.verify({
        agentKind: "codex",
        worktreeId: "wt",
        runtimeGeneration: "runtime",
        providerVersion: "0.154.0",
        assignmentGenerationId: "assignment",
        catalogGenerationId: "catalog",
      }),
    ).toBe(false);
  });
  it("redacts managed provider request failures before they escape the adapter API", async () => {
    const f = await setup(),
      plan = options(f.root);
    await writeFile(
      join(f.root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        errorTurn: "Synthetic provider echoed Bearer private-token",
      }),
    );
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    const session = await adapter.createSession(f.root, "test", {
      modelId: "fixture",
    });
    await expect(
      adapter.sendPrompt(f.root, session.id, {
        providerId: "openai",
        modelId: "fixture",
        content: "test",
      }),
    ).rejects.toThrow("Codex Worktree provider request failed.");
  });

  it("keeps missing private Skill context paths out of public adapter failures", async () => {
    const f = await setup(),
      plan = options(f.root),
      source = join(f.root, "alpha");
    await mkdir(source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: alpha\ndescription: Synthetic qualification.\n---\nReply SAFE_ALPHA.\n",
    );
    const validated = await validateSkillPackage(source);
    plan.skills = [
      {
        name: "alpha",
        identity: {
          resourceKind: "skill",
          resourceId: "alpha",
          resourceVersion: "1.0.0",
          resourceDigest: validated.contentDigest,
        },
        files: validated.files,
      },
    ];
    plan.evidence = evidenceFor(plan);
    await writeFile(
      join(f.root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        thread: {
          id: "thread-1",
          cwd: f.root,
          status: { type: "idle" },
          turns: [],
          path: join(plan.namespaceRoot, "data/sessions/missing.jsonl"),
        },
      }),
    );
    const adapter = new CodexAdapter(undefined, undefined, plan);
    adapters.push(adapter);
    await adapter.start(f.binary, f.root);
    const session = await adapter.createSession(f.root, "test", {
      modelId: "fixture",
      runId: "run",
    });
    await adapter.sendPrompt(f.root, session.id, {
      providerId: "openai",
      modelId: "fixture",
      explicitSkill: {
        id: "alpha",
        name: "alpha",
        path: join(plan.namespaceRoot, "skills/alpha/SKILL.md"),
      },
    });
    await expect(adapter.listMessages(f.root, session.id)).rejects.toThrow(
      "Codex Resource history evidence is unavailable.",
    );
  });
});
