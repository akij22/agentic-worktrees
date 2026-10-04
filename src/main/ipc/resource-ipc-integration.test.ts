import BetterSqlite3 from "better-sqlite3";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { WorktreeRuntimeManager } from "../coding-agents/worktree-runtime-manager";
import { WorktreeResourceAssignmentService } from "../assignments/worktree-resource-assignment-service";
import { ResourceActivityRepository } from "../resource-activity/resource-activity-repository";
import {
  configureResourceIpc,
  registerResourceIpcHandlers,
} from "./resource-ipc";
import { IPC_CHANNELS } from "../../shared/ipc/channels";
import type { AssignmentChangedEventDto } from "../../shared/assignments/schemas";
const databases: BetterSqlite3.Database[] = [];
afterEach(() => {
  configureResourceIpc(null);
  for (const db of databases.splice(0)) db.close();
});
it("registers six invokes and publishes committed Assignment transitions to every authorized window", async () => {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, raw: unknown) => unknown
  >();
  const received: AssignmentChangedEventDto[][] = [[], [], []];
  registerResourceIpcHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    () =>
      [1, 2, 3].map((id, index) => ({
        id,
        send: (_channel, raw) =>
          received[index].push(raw as AssignmentChangedEventDto),
      })),
  );
  const handler = (channel: string) => {
    const value = handlers.get(channel);
    if (!value) throw new Error("Missing handler.");
    return value;
  };
  expect([...handlers.keys()].sort()).toEqual(
    [
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET,
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_SET,
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_RETRY,
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_CANCEL_PENDING,
      IPC_CHANNELS.RESOURCE_ASSIGNMENT_RECOVER,
      IPC_CHANNELS.RESOURCE_ACTIVITY_LIST,
    ].sort(),
  );
  const frame = {},
    event = {
      sender: { id: 1, isDestroyed: () => false, mainFrame: frame },
      senderFrame: frame,
    } as IpcMainInvokeEvent;
  await expect(
    handler(IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET)(event, {}),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "runtime_unavailable" },
  });
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  db.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1);
  INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','main','/private/repo','main','primary','ready',1,1);`);
  const digest = `sha256:${"a".repeat(64)}`;
  const assignment = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: new WorktreeRuntimeManager({
      factory: {
        create: async () => {
          throw new Error("No provider");
        },
      },
    }),
    resources: {
      prepare: async () => undefined,
      resolve: async () => ({
        kind: "skill",
        id: "review",
        version: "1",
        contentDigest: digest,
        securityDigest: digest,
        configurationDigest: digest,
        invocationPolicyDigest: digest,
        providerProjections: [
          {
            agentKind: "codex",
            availability: "compatible",
            skillIsolation: "not_enforced",
            qualificationDigest: digest,
            expectedStateDigest: digest,
          },
          {
            agentKind: "opencode",
            availability: "compatible",
            skillIsolation: "enforced",
            qualificationDigest: digest,
            expectedStateDigest: digest,
          },
        ],
      }),
    },
    providers: {
      prepare: async () => {
        throw new Error("No provider");
      },
    },
  });
  await assignment.reconcileStartup();
  configureResourceIpc({
    assignment,
    activity: new ResourceActivityRepository(db),
    access: {
      isTrustedSender: (id) => id <= 3,
      canAccessWorktree: (id, wt) => id <= 2 && wt === "wt",
      getRunWorktree: () => null,
      canAccessRun: () => false,
    },
  });
  const get = handler(IPC_CHANNELS.RESOURCE_ASSIGNMENT_GET);
  await expect(
    get({ ...event, senderFrame: {} } as IpcMainInvokeEvent, {
      worktreeId: "wt",
      agentKind: "codex",
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "resource_unavailable" },
  });
  await expect(
    get(event, { worktreeId: "wt", agentKind: "opencode" }),
  ).resolves.toMatchObject({
    ok: true,
    value: { currentAgentKind: "opencode" },
  });
  await expect(
    handler(IPC_CHANNELS.RESOURCE_ASSIGNMENT_SET)(event, {
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    }),
  ).resolves.toMatchObject({ ok: true, value: { revision: "1" } });
  await assignment.waitForReconciliation("wt");
  await assignment.publishOutbox();
  expect(received[0].at(-1)).toMatchObject({
    revision: "1",
    projection: { phase: "stable" },
  });
  expect(received[1]).toEqual(received[0]);
  expect(received[2]).toEqual([]);
  const latest = await assignment.get("wt");
  expect(latest.revision).toBe(received[0].at(-1)?.revision);
  expect(JSON.stringify(received)).not.toMatch(
    /private|generationId|Digest|prompt|receipt/,
  );
});
