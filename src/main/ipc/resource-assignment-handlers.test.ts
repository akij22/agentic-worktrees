import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { WorktreeRuntimeManager } from "../coding-agents/worktree-runtime-manager";
import { WorktreeResourceAssignmentService } from "../assignments/worktree-resource-assignment-service";
import { createResourceAssignmentHandlers } from "./resource-assignment-handlers";

const databases: BetterSqlite3.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  db.prepare(
    `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1)`,
  ).run();
  db.prepare(
    `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','main','/private/repo','main','primary','ready',1,1)`,
  ).run();
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: new WorktreeRuntimeManager({
      factory: {
        create: async () => {
          throw new Error("No provider");
        },
      },
    }),
    resources: {
      resolve: async () => {
        throw new Error("private token");
      },
      prepare: async () => undefined,
    },
    providers: {
      prepare: async () => {
        throw new Error("No provider");
      },
    },
  });
  return {
    service,
    handlers: createResourceAssignmentHandlers(service, {
      canAccessWorktree: (sender, id) => sender === 1 && id === "wt",
    }),
  };
}
it("returns only the safe current projection for an authorized Worktree", async () => {
  const { service, handlers } = fixture();
  await service.reconcileStartup();
  const result = await handlers.get(1, {
    worktreeId: "wt",
    agentKind: "opencode",
  });
  expect(result).toMatchObject({
    ok: true,
    value: { worktreeId: "wt", revision: "0", currentAgentKind: "opencode" },
  });
  expect(JSON.stringify(result)).not.toMatch(/private|Generation|Digest|token/);
});
it("fails closed on malformed, oversized, and unauthorized requests without throwing wire exceptions", async () => {
  const { service, handlers } = fixture();
  await service.reconcileStartup();
  for (const raw of [
    null,
    { worktreeId: "wt", agentKind: "codex", path: "/private" },
    { worktreeId: "x".repeat(70_000), agentKind: "codex" },
  ]) {
    await expect(handlers.get(1, raw)).resolves.toMatchObject({
      ok: false,
      error: { code: "assignment_invalid_resource" },
    });
  }
  await expect(
    handlers.get(2, { worktreeId: "wt", agentKind: "codex" }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "resource_unavailable" },
  });
});
it("enforces complete-set revisions and advertised actions without leaking backend causes", async () => {
  const { service, handlers } = fixture();
  await service.reconcileStartup();
  await expect(
    handlers.setDesired(1, {
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [],
    }),
  ).resolves.toMatchObject({ ok: true, value: { revision: "0" } });
  await expect(
    handlers.setDesired(1, {
      worktreeId: "wt",
      expectedRevision: "9",
      resources: [],
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "assignment_conflict", current: { revision: "0" } },
  });
  for (const result of [
    await handlers.retry(1, { worktreeId: "wt", expectedRevision: "0" }),
    await handlers.cancelPending(1, {
      worktreeId: "wt",
      expectedRevision: "0",
    }),
    await handlers.recover(1, {
      worktreeId: "wt",
      expectedRevision: "0",
      action: "revert_desired",
    }),
  ])
    expect(result).toMatchObject({ ok: false });
  const result = await handlers.setDesired(1, {
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "internal_error" },
  });
  expect(JSON.stringify(result)).not.toContain("private token");
});
