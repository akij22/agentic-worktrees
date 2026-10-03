import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { ResourceActivityRepository } from "../resource-activity/resource-activity-repository";
import { createResourceActivityHandlers } from "./resource-activity-handlers";
const databases: BetterSqlite3.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
it("lists only the exact owned run and rejects injected identity, missing runs and unauthorized windows", async () => {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  const repository = new ResourceActivityRepository(db);
  const handlers = createResourceActivityHandlers(repository, {
    canAccessWorktree: (sender, wt) => sender === 1 && wt === "wt",
    getRunWorktree: (id) => (id === "run" ? "wt" : null),
    canAccessRun: (sender, run, wt) =>
      sender === 1 && run === "run" && wt === "wt",
  });
  await expect(handlers.list(1, { runId: "run" })).resolves.toEqual({
    ok: true,
    value: { runId: "run", sequence: "0", items: [] },
  });
  await expect(handlers.list(2, { runId: "run" })).resolves.toMatchObject({
    ok: false,
    error: { code: "activity_access_denied" },
  });
  await expect(handlers.list(1, { runId: "missing" })).resolves.toMatchObject({
    ok: false,
    error: { code: "activity_run_not_found" },
  });
  for (const request of [
    { runId: "run", worktreeId: "wt" },
    { runId: "x".repeat(70_000) },
    null,
  ])
    await expect(handlers.list(1, request)).resolves.toMatchObject({
      ok: false,
      error: { code: "activity_access_denied" },
    });
});
it("requires Worktree authorization independently of run ownership", async () => {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  const handlers = createResourceActivityHandlers(
    new ResourceActivityRepository(db),
    {
      getRunWorktree: () => "wt",
      canAccessRun: () => true,
      canAccessWorktree: () => false,
    },
  );
  await expect(handlers.list(1, { runId: "run" })).resolves.toMatchObject({
    ok: false,
    error: { code: "activity_access_denied" },
  });
});
it("returns sanitized persisted history only for the requested run, preserving request-only legacy coverage", async () => {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  db.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1);
    INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','main','/private/repo','main','primary','ready',1,1);
    INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','secret prompt','running','idle',0,1,1),('other','repo','wt','t','other secret','running','idle',0,1,1);`);
  const repository = new ResourceActivityRepository(db),
    now = new Date("2026-10-03T10:00:00.000Z");
  for (const runId of ["run", "other"])
    repository.recordActivity({
      activity: {
        id: `activity-${runId}`,
        worktreeId: "wt",
        runId,
        resourceKind: "skill",
        resourceId: runId === "run" ? "review" : "other-skill",
        resourceVersion: "1",
        resourceDigest: null,
        assignmentRevision: null,
        assignmentGenerationId: null,
        catalogGenerationId: null,
        runtimeGenerationId: null,
        provider: null,
        providerVersion: null,
        adapterContractVersion: null,
        requestKey: null,
        correlationKey: null,
        requestState: "requested",
        useState: "not_confirmed",
        lifecycle: "terminal",
        outcome: "not_observed",
        attribution: "exact",
        mode: "explicit",
        routingIntegrity: "unknown",
        coverage: "legacy_unverified",
        requestedAt: now,
        enteredOrLoadedAt: null,
        finishedAt: now,
        firstObservedAt: now,
        lastObservedAt: now,
      },
      evidence: {
        id: `evidence-${runId}`,
        activityId: `activity-${runId}`,
        boundary: "application.request",
        sourceEventKey: `hmac:v1:${(runId === "run" ? "a" : "b").repeat(64)}`,
        correlationKey: null,
        providerContract: "legacy",
        observedAt: now,
      },
      event: {
        eventId: `event-${runId}`,
        runId,
        sequence: "1",
        change: {
          type: "upsert",
          item: {
            id: `activity-${runId}`,
            resourceKind: "skill",
            resourceId: runId === "run" ? "review" : "other-skill",
            resourceVersion: "1",
            requestState: "requested",
            useState: "not_confirmed",
            lifecycle: "terminal",
            outcome: "not_observed",
            mode: "explicit",
            coverage: "legacy_unverified",
            occurredAt: now.toISOString(),
          },
        },
      },
    });
  const handlers = createResourceActivityHandlers(repository, {
    canAccessWorktree: (_sender, wt) => wt === "wt",
    getRunWorktree: (id) => (["run", "other"].includes(id) ? "wt" : null),
    canAccessRun: (_sender, run) => run === "run",
  });
  const result = await handlers.list(1, { runId: "run" });
  expect(result).toMatchObject({
    ok: true,
    value: {
      runId: "run",
      items: [
        {
          id: "activity-run",
          resourceId: "review",
          useState: "not_confirmed",
          coverage: "legacy_unverified",
        },
      ],
    },
  });
  if (result.ok) expect(result.value.items).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(
    /secret|private|other-skill|Generation|Digest|provider|requestKey|correlationKey/,
  );
});
