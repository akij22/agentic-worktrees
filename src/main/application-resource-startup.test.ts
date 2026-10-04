import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  chmod,
  readdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
const hostProcesses = vi.hoisted(() => ({
  live: new Set<import("node:worker_threads").Worker>(),
  environments: [] as Array<NodeJS.ProcessEnv | undefined>,
}));
const ipcHandlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);
vi.mock("electron", async () => {
  const { Worker } = await import("node:worker_threads");
  return {
    app: { getPath: () => "/unused" },
    BrowserWindow: { getAllWindows: () => [] },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    utilityProcess: {
      fork: (
        file: string,
        _args: unknown,
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        hostProcesses.environments.push(options.env);
        const worker = new Worker(file, { env: options.env });
        hostProcesses.live.add(worker);
        worker.once("exit", () => hostProcesses.live.delete(worker));
        return Object.assign(worker, {
          kill: () => {
            void worker.terminate();
            return true;
          },
        });
      },
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, handler);
      },
    },
  };
});
import {
  createAgentSession,
  getAgentSessionSnapshot,
  sendAgentMessage,
  sendAgentSkill,
  abortAgentSession,
  compactAgentSession,
  listAgentModels,
} from "./coding-agents/coding-agent-service";
import { initDatabase } from "./database";
import { createApplicationServices } from "./application-services";
import { configureDatabaseUserDataPath, getSqlite } from "./database/client";
import { IPC_CHANNELS } from "../shared/ipc/channels";

it("binds Resource owners, drains turns and compaction before global changes, and verifies owned shutdown", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "aw-release-startup-")),
  );
  vi.stubEnv("WORKTREEHUB_WORKSPACE_ROOT", root);
  vi.stubEnv("WORKTREEHUB_RESOURCE_EVIDENCE_KEY", "7".repeat(64));
  vi.stubEnv("WORKTREEHUB_RESOURCE_EVIDENCE_KEY_VERSION", "2");
  let services:
    | Awaited<ReturnType<typeof createApplicationServices>>
    | undefined;
  try {
    configureDatabaseUserDataPath(root);
    initDatabase();
    const executable = join(root, "provider");
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        completeOnInterrupt: true,
        servers: [
          {
            name: "aw_resources",
            runtimeStatus: "connected",
            tools: { fetch_url: {} },
          },
        ],
      }),
    );
    await writeFile(
      executable,
      `#!${process.execPath}\n${await readFile(resolve("src/main/coding-agents/fixtures/codex-runtime-provider.mjs"), "utf8")}`,
    );
    await chmod(executable, 0o700);
    getSqlite().exec(
      `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)`,
    );
    getSqlite()
      .prepare(
        `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w',?,'b','linked','ready',1,1)`,
      )
      .run(root);
    getSqlite()
      .prepare(
        `INSERT INTO coding_agent_installations (id,kind,name,executable_path,version,enabled,last_verified_at,created_at,updated_at) VALUES ('codex','codex','Codex',?,'0.154.0',1,1,1,1)`,
      )
      .run(executable);
    services = await createApplicationServices({
      userDataPath: root,
      mode: "ui",
      resourceHostBundlePath: resolve(".vite/build/capability-host.js"),
    });
    expect(services.resources).toBeDefined();
    const resources = services.resources,
      skillService = services.skillService;
    if (!resources || !skillService)
      throw new Error("Application Resource owners are unavailable.");
    const { registerIpcHandlers } = await import("./ipc");
    registerIpcHandlers();
    const deniedSender = { id: 99, isDestroyed: () => false, mainFrame: {} };
    const denied = await requireHandler(
      IPC_CHANNELS.CODING_AGENT_SESSION_CREATE,
    )(
      { sender: deniedSender, senderFrame: deniedSender.mainFrame },
      { agentKind: "codex", worktreeId: "wt", title: "Untrusted" },
    );
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "resource_unavailable" },
    });
    expect(resources.manager.inspectWorktree("wt").runtimes).toHaveLength(0);
    expect(
      getSqlite()
        .prepare(
          "SELECT status FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-release-v1'",
        )
        .get(),
    ).toEqual({ status: "verified" });
    const capability = services.capabilityService.getCapability(
      "agentic-worktrees.url-fetch",
    );
    await services.capabilityService.configureCapability({
      capabilityId: capability.id,
      acceptedPermissionDigest: capability.permissionDigest,
      settings: {},
      secrets: {},
    });
    expect((await resources.assignment.get("wt", "codex")).resources).toEqual([
      expect.objectContaining({
        id: capability.id,
        desired: false,
        status: "installed",
        assignable: true,
      }),
    ]);
    const skillSource = join(root, "release-skill");
    await mkdir(skillSource);
    await writeFile(
      join(skillSource, "SKILL.md"),
      "---\nname: release-skill\ndescription: Synthetic application admission check.\n---\nUse the assigned instruction.\n",
    );
    const skill = await skillService.installFromDirectory(skillSource);
    await resources.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [
        { kind: "capability", id: capability.id, version: capability.version },
        { kind: "skill", id: skill.id, version: skill.version },
      ],
    });
    await resources.assignment.waitForReconciliation("wt");
    const session = await createAgentSession({
      agentKind: "codex",
      worktreeId: "wt",
      title: "Qualification",
    });
    expect(
      services.resources?.manager.inspectWorktree("wt").runtimes,
    ).toHaveLength(1);
    for (const channel of [
      IPC_CHANNELS.CODING_AGENT_SESSION_ABORT,
      IPC_CHANNELS.CODING_AGENT_SESSION_COMPACT,
    ]) {
      await expect(
        requireHandler(channel)(
          { sender: deniedSender, senderFrame: deniedSender.mainFrame },
          { runId: session.id },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "resource_unavailable" },
      });
    }
    await expect(
      requireHandler(IPC_CHANNELS.CODING_AGENT_PERMISSION_RESPOND)(
        { sender: deniedSender, senderFrame: deniedSender.mainFrame },
        { runId: session.id, permissionId: "untrusted", response: "always" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "resource_unavailable" },
    });
    await expect(
      requireHandler(IPC_CHANNELS.CODING_AGENT_SESSION_MODEL_UPDATE)(
        { sender: deniedSender, senderFrame: deniedSender.mainFrame },
        { runId: session.id, providerId: "openai", modelId: "gpt-5.4" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "resource_unavailable" },
    });
    expect(hostProcesses.live.size).toBe(1);
    expect(hostProcesses.environments[0]).toEqual(expect.any(Object));
    expect(hostProcesses.environments[0]).not.toHaveProperty(
      "WORKTREEHUB_RESOURCE_EVIDENCE_KEY",
    );
    expect((await resources.assignment.get("wt", "codex")).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: capability.id,
          status: "enabled",
          verified: true,
        }),
        expect.objectContaining({
          id: skill.id,
          status: "enabled",
          verified: true,
        }),
      ]),
    );
    expect(await listAgentModels(session.id)).toEqual([
      expect.objectContaining({ modelId: "fixture" }),
    ]);
    await sendAgentMessage(session.id, "Synthetic turn");
    expect(services.resources?.manager.inspectWorktree("wt").busy).toBe(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        listAgentModels(session.id),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Reads waited for the active turn.")),
            250,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await abortAgentSession(session.id);
    expect(services.resources?.manager.inspectWorktree("wt").busy).toBe(false);
    await sendAgentSkill(session.id, {
      skillId: skill.id,
      version: skill.version,
      arguments: "Synthetic explicit request",
    });
    expect(resources.activity.getSnapshot(session.id).items).toEqual([
      expect.objectContaining({
        resourceId: skill.id,
        requestState: "requested",
        useState: "not_confirmed",
      }),
    ]);
    expect(
      getSqlite()
        .prepare(
          "SELECT DISTINCT substr(request_key,1,8) prefix FROM resource_activity WHERE request_key IS NOT NULL",
        )
        .all(),
    ).toEqual([{ prefix: "hmac:v2:" }]);
    expect(
      getSqlite().prepare("SELECT count(*) count FROM skill_invocations").get(),
    ).toEqual({ count: 0 });
    await writeFile(
      join(skillSource, "SKILL.md"),
      "---\nname: release-skill\ndescription: Synthetic updated admission check.\n---\nUse the updated assigned instruction.\n",
    );
    const update = skillService.installFromDirectory(skillSource);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await abortAgentSession(session.id);
    const updatedSkill = await update;
    expect(updatedSkill.version).not.toBe(skill.version);
    expect((await resources.assignment.get("wt", "codex")).resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: skill.id,
          version: updatedSkill.version,
          verified: true,
        }),
      ]),
    );
    await sendAgentSkill(session.id, {
      skillId: skill.id,
      version: updatedSkill.version,
      arguments: "Request updated Skill",
    });
    const committedSelections: string[][] = [];
    const unsubscribe = resources.assignment.subscribe((event) => {
      if (event.projection.phase === "stable")
        committedSelections.push(
          event.projection.resources.map((resource) => resource.id),
        );
    });
    let removed = false;
    const removal = skillService.removeSkill(skill.id).then(() => {
      removed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);
    expect(skillService.getSkill(skill.id)).not.toBeNull();
    await abortAgentSession(session.id);
    await removal;
    unsubscribe();
    expect(committedSelections.at(-1)).not.toContain(skill.id);
    expect(
      (await resources.assignment.get("wt", "codex")).resources.some(
        (resource) => resource.id === skill.id,
      ),
    ).toBe(false);
    expect(hostProcesses.live.size).toBe(1);
    const search = services.capabilityService.getCapability(
      "agentic-worktrees.web-search",
    );
    await services.capabilityService.configureCapability({
      capabilityId: search.id,
      acceptedPermissionDigest: search.permissionDigest,
      settings: { resultLimit: 5 },
      secrets: {},
    });
    await writeFile(
      join(root, "codex-fixture.json"),
      JSON.stringify({
        version: "0.154.0",
        completeOnInterrupt: true,
        compactionDelayMs: 200,
        servers: [
          {
            name: "aw_resources",
            runtimeStatus: "connected",
            tools: { fetch_url: {}, web_search: {} },
          },
        ],
      }),
    );
    const beforeSearch = await resources.assignment.get("wt", "codex");
    await resources.assignment.setDesired({
      worktreeId: "wt",
      expectedRevision: beforeSearch.revision,
      resources: [
        { kind: "capability", id: capability.id, version: capability.version },
        { kind: "capability", id: search.id, version: search.version },
      ],
    });
    await resources.assignment.waitForReconciliation("wt");
    await sendAgentMessage(session.id, "Keep the configuration barrier active");
    const configured = services.capabilityService.configureCapability({
      capabilityId: search.id,
      acceptedPermissionDigest: search.permissionDigest,
      settings: { resultLimit: 8 },
      secrets: {},
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await resources.assignment.get("wt", "codex")).phase).toBe(
      "waiting_for_idle",
    );
    await abortAgentSession(session.id);
    await configured;
    expect((await resources.assignment.get("wt", "codex")).phase).toBe(
      "stable",
    );
    await compactAgentSession(session.id);
    expect(resources.manager.inspectWorktree("wt").busy).toBe(true);
    const afterCompact = services.capabilityService.configureCapability({
      capabilityId: search.id,
      acceptedPermissionDigest: search.permissionDigest,
      settings: { resultLimit: 10 },
      secrets: {},
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await resources.assignment.get("wt", "codex")).phase).toBe(
      "waiting_for_idle",
    );
    await afterCompact;
    expect((await resources.assignment.get("wt", "codex")).phase).toBe(
      "stable",
    );
    await compactAgentSession(session.id);
    await abortAgentSession(session.id);
    const compactRequests = (
      await readFile(join(root, "requests.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(compactRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "turn/interrupt",
          params: expect.objectContaining({ turnId: "compact-1" }),
        }),
      ]),
    );
    getSqlite().exec(
      "UPDATE coding_agent_installations SET enabled=0 WHERE id='codex'",
    );
    await expect(
      services.capabilityService.configureCapability({
        capabilityId: search.id,
        acceptedPermissionDigest: search.permissionDigest,
        settings: { resultLimit: 12 },
        secrets: {},
      }),
    ).rejects.toThrow();
    expect(hostProcesses.live.size).toBe(1);
    getSqlite().exec(
      "UPDATE coding_agent_installations SET enabled=1 WHERE id='codex'",
    );
    // A pre-cutover thread is absent from the owned provider namespace.
    // Viewing its durable transcript must not require successful live admission.
    getSqlite().exec(`
      INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,created_at,updated_at)
      VALUES ('legacy-run','repo','wt','Saved legacy chat','','idle','idle',1,1);
      INSERT INTO coding_agent_sessions (run_id,installation_id,external_session_id,provider_id,model_id,created_at,updated_at)
      VALUES ('legacy-run','codex','missing-pre-cutover-thread','openai','fixture',1,1);
      INSERT INTO run_messages (id,run_id,sequence,role,message_type,content,created_at,completed_at)
      VALUES ('legacy-message','legacy-run',1,'user','text','Saved conversation',1,1);
    `);
    const archived = await getAgentSessionSnapshot("legacy-run");
    expect(archived.session).toMatchObject({
      id: "legacy-run",
      status: "unavailable",
      errorMessage:
        "The agent runtime could not resume this session. Saved messages are still available.",
    });
    expect(archived.messages).toEqual([
      expect.objectContaining({
        id: "legacy-message",
        content: "Saved conversation",
      }),
    ]);
    expect(archived.capabilities).toEqual([]);
    expect(archived.skillInvocations).toEqual([]);
    await services.stop();
    expect(hostProcesses.live.size).toBe(0);
    await services.stop();
    services = await createApplicationServices({
      userDataPath: root,
      mode: "cli",
      resourceHostBundlePath: resolve(".vite/build/capability-host.js"),
    });
    expect(services.resources).toBeDefined();

    await services.stop();
    expect(hostProcesses.live.size).toBe(0);
  } finally {
    try {
      await services?.stop();
    } finally {
      await Promise.all(
        [...hostProcesses.live].map((worker) => worker.terminate()),
      );
      vi.unstubAllEnvs();
      getSqlite().close();
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

function requireHandler(channel: string) {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error("Application IPC handler is unavailable.");
  return handler;
}
