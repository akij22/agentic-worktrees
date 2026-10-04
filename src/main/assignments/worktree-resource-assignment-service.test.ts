import BetterSqlite3 from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";

import { DatabaseRuntimeAttestationVerifier } from "../coding-agents/worktree-runtime-attestation-verifier";
import {
  WorktreeRuntimeManager,
  WorktreeRuntimeStartupError,
} from "../coding-agents/worktree-runtime-manager";
import {
  WorktreeResourceAssignmentService,
  type PreparedAssignmentParticipant,
} from "./worktree-resource-assignment-service";
import type { ResourceIdentity } from "../../shared/assignments";

const digest = `sha256:${"a".repeat(64)}`;
const skill: ResourceIdentity = {
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
};
const databases: BetterSqlite3.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(bootstrapSchemaSql);
  db.prepare(
    `INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'owner','repo','owner/repo',0,0,'url','url','ready',1,1)`,
  ).run();
  db.prepare(
    `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','main','/tmp/repo','main','primary','ready',1,1)`,
  ).run();
  const manager = new WorktreeRuntimeManager({
    factory: {
      create: async () => {
        throw new Error("Assignment changes must not launch a provider.");
      },
    },
  });
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: manager,
    resources: { resolve: async () => skill, prepare: async () => undefined },
    providers: {
      prepare: async () => {
        throw new Error("No live provider.");
      },
    },
  });
  return {
    db,
    manager,
    service,
    restart: () =>
      new WorktreeResourceAssignmentService({
        sqlite: db,
        runtimeManager: manager,
        resources: {
          resolve: async () => skill,
          prepare: async () => undefined,
        },
        providers: {
          prepare: async () => {
            throw new Error("No live provider.");
          },
        },
      }),
  };
}
it("commits a complete set without starting providers and retains it across restart", async () => {
  const { service, restart } = fixture();
  await service.reconcileStartup();
  const requested = await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  expect(requested).toMatchObject({ revision: "1", phase: "waiting_for_idle" });
  await service.waitForReconciliation("wt");
  expect(await service.get("wt", "codex")).toMatchObject({
    revision: "1",
    phase: "stable",
    resources: [
      { id: "review", status: "enabled", skillIsolation: "not_enforced" },
    ],
  });
  const reopened = restart();
  await reopened.reconcileStartup();
  expect(await reopened.get("wt", "opencode")).toMatchObject({
    revision: "1",
    phase: "stable",
    resources: [{ id: "review", skillIsolation: "enforced" }],
  });
});

it("requires exact live Codex and OpenCode attestations before committing", async () => {
  const { db } = fixture();
  const applied = new Map<string, string>();
  const manager = new WorktreeRuntimeManager({
    attestationVerifier: new DatabaseRuntimeAttestationVerifier(db),
    idleTimeoutMs: 60_000,
    factory: {
      create: async ({ agentKind, worktreeId, generation }) => ({
        agentKind,
        worktreeId,
        generation,
        providerVersion: "1",
        stop: async () => undefined,
      }),
    },
  });
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: manager,
    resources: { resolve: async () => skill, prepare: async () => undefined },
    providers: {
      prepare: async (
        runtime,
        target,
        prior,
      ): Promise<PreparedAssignmentParticipant> => ({
        projectionDigest: digest,
        priorProjectionDigest: digest,
        expected: {
          agentKind: runtime.agentKind,
          runtimeGenerationId: runtime.generation,
          assignmentGenerationId: target.id,
          catalogGenerationId: `catalog-${runtime.agentKind}-${target.id}`,
          providerVersion: "1",
          adapterContractVersion: 1,
          effectiveStateDigest: digest,
          skillIsolation:
            runtime.agentKind === "codex" ? "not_enforced" : "enforced",
          attestedAt: new Date().toISOString(),
        },
        priorExpected: {
          agentKind: runtime.agentKind,
          runtimeGenerationId: runtime.generation,
          assignmentGenerationId: prior.id,
          catalogGenerationId: `catalog-${runtime.agentKind}-${prior.id}`,
          providerVersion: "1",
          adapterContractVersion: 1,
          effectiveStateDigest: digest,
          skillIsolation:
            runtime.agentKind === "codex" ? "not_enforced" : "enforced",
          attestedAt: new Date().toISOString(),
        },
        stage: async () => undefined,
        activate: async () => {
          applied.set(runtime.agentKind, target.id);
        },
        verify: async function (this: PreparedAssignmentParticipant) {
          return this.expected;
        },
        rollback: async () => {
          throw new Error("Unexpected rollback.");
        },
        discard: async () => undefined,
        finalize: async () => undefined,
      }),
    },
  });
  await service.reconcileStartup();
  const codex = await manager.acquireRuntime("codex", "wt"),
    opencode = await manager.acquireRuntime("opencode", "wt");
  await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await service.waitForReconciliation("wt");
  expect([...applied.keys()]).toEqual(["codex", "opencode"]);
  expect((await service.get("wt")).phase).toBe("stable");
  codex.release();
  opencode.release();
  await manager.shutdown();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function liveFixture(
  fail: string | null = null,
  kinds: readonly ("codex" | "opencode")[] = ["codex", "opencode"],
) {
  const { db } = fixture();
  const observations: string[] = [],
    entered = deferred(),
    proceed = deferred();
  let pause = false,
    rollbackFails = false,
    unavailableProvider: "codex" | "opencode" | null = null;
  const manager = new WorktreeRuntimeManager({
    attestationVerifier: new DatabaseRuntimeAttestationVerifier(db),
    idleTimeoutMs: 60_000,
    factory: {
      create: async ({ agentKind, worktreeId, generation }) => ({
        agentKind,
        worktreeId,
        generation,
        providerVersion: "1",
        stop: async () => undefined,
      }),
    },
  });
  const resources = {
    resolve: async (selection: { version: string }) => ({
      ...skill,
      providerProjections: skill.providerProjections.map((p) => ({
        ...p,
        availability:
          p.agentKind === unavailableProvider
            ? ("unavailable" as const)
            : p.availability,
      })),
      version: selection.version,
    }),
    prepare: async () => undefined,
  };
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: manager,
    resources,
    providers: {
      prepare: async (runtime, target, prior) => {
        const attestation = (generation: string) => ({
          agentKind: runtime.agentKind,
          runtimeGenerationId: runtime.generation,
          assignmentGenerationId: generation,
          catalogGenerationId: `catalog-${runtime.agentKind}-${generation}`,
          providerVersion: "1",
          adapterContractVersion: 1,
          effectiveStateDigest: digest,
          skillIsolation:
            runtime.agentKind === "codex"
              ? ("not_enforced" as const)
              : ("enforced" as const),
          attestedAt: new Date().toISOString(),
        });
        return {
          projectionDigest: digest,
          priorProjectionDigest: digest,
          expected: attestation(target.id),
          priorExpected: attestation(prior.id),
          stage: async () => {
            observations.push(
              `stage:${runtime.agentKind}:${target.resources[0]?.version}`,
            );
            if (pause) {
              entered.resolve();
              await proceed.promise;
            }
            if (fail === `stage:${runtime.agentKind}`)
              throw new Error("Private provider failure.");
          },
          activate: async () => {
            observations.push(`activate:${runtime.agentKind}`);
            if (fail === `exit:${runtime.agentKind}`)
              manager.reportRuntimeExit(
                runtime.agentKind,
                runtime.worktreeId,
                runtime.generation,
              );
            if (fail === `activate:${runtime.agentKind}`)
              throw new Error("Private provider failure.");
          },
          verify: async () => {
            if (fail === `verify:${runtime.agentKind}`)
              throw new Error("Private provider failure.");
            return fail === `drift:${runtime.agentKind}`
              ? {
                  ...attestation(target.id),
                  effectiveStateDigest: `sha256:${"b".repeat(64)}`,
                }
              : attestation(target.id);
          },
          rollback: async () => {
            observations.push(`rollback:${runtime.agentKind}`);
            if (rollbackFails) throw new Error("Unknown provider state.");
            return attestation(prior.id);
          },
          finalize: async () => undefined,
          discard: async () => {
            observations.push(`discard:${runtime.agentKind}`);
          },
        };
      },
    },
  });
  await service.reconcileStartup();
  for (const kind of kinds) {
    const lease = await manager.acquireRuntime(kind, "wt");
    lease.release();
  }
  return {
    db,
    manager,
    service,
    observations,
    entered,
    proceed,
    pause: () => {
      pause = true;
    },
    setUnavailableProvider: (value: "codex" | "opencode") => {
      unavailableProvider = value;
    },
    setFailure: (value: string | null) => {
      fail = value;
    },
    failRollback: () => {
      rollbackFails = true;
    },
  };
}
it("restores every touched participant in reverse order and keeps the failed desired target visible", async () => {
  const f = await liveFixture("verify:opencode");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "failed_rolled_back",
    revision: "1",
    resources: [{ desired: true, verified: false, status: "failed" }],
  });
  expect(f.observations.filter((x) => x.startsWith("rollback"))).toEqual([
    "rollback:opencode",
    "rollback:codex",
  ]);
  await f.manager.shutdown();
});
it("keeps the applying target immutable and coalesces later edits into the next attempt", async () => {
  const f = await liveFixture();
  f.pause();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await Promise.race([
    f.entered.promise,
    f.service.waitForReconciliation("wt").then(() => {
      throw new Error("Apply ended before stage.");
    }),
  ]);
  expect((await f.service.get("wt")).resources[0].status).toBe("applying");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "1",
    resources: [{ kind: "skill", id: "review", version: "2" }],
  });
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "2",
    resources: [{ kind: "skill", id: "review", version: "3" }],
  });
  f.proceed.resolve();
  await f.service.waitForReconciliation("wt");
  expect(f.observations.filter((x) => x.startsWith("stage"))).toEqual([
    "stage:codex:1",
    "stage:opencode:1",
    "stage:codex:3",
    "stage:opencode:3",
  ]);
  expect(await f.service.get("wt")).toMatchObject({
    revision: "3",
    phase: "stable",
    resources: [{ version: "3" }],
  });
  await f.manager.shutdown();
});
it("closes ordinary admission when rollback cannot be verified", async () => {
  const f = await liveFixture("activate:opencode");
  f.failRollback();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "recovery_required",
    admission: { canSend: false },
  });
  await expect(
    f.service.withSessionAdmission(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        operation: "create",
      },
      async () => "sent",
    ),
  ).rejects.toMatchObject({ code: "assignment_recovery_required" });
  await f.manager.shutdown();
});
it("cancels a waiting target as a revisioned reversion and rejects stale writes", async () => {
  const { service, manager } = fixture();
  await service.reconcileStartup();
  const reader = await manager.acquireAdmission("wt", "normal");
  await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await expect(
    service.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [],
    }),
  ).rejects.toMatchObject({ code: "assignment_conflict" });
  expect(
    await service.cancelPending({ worktreeId: "wt", expectedRevision: "1" }),
  ).toMatchObject({ revision: "2", phase: "stable", resources: [] });
  reader.release();
  await service.waitForReconciliation("wt");
  expect((await service.get("wt")).revision).toBe("2");
});
it("uses a fresh attempt on explicit retry without changing desired revision", async () => {
  const f = await liveFixture("verify:opencode");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  const failedSequence = (await f.service.get("wt")).projectionSequence;
  expect(
    await f.service.retryApply({ worktreeId: "wt", expectedRevision: "1" }),
  ).toMatchObject({ phase: "waiting_for_idle", revision: "1" });
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "failed_rolled_back",
    revision: "1",
  });
  expect(
    BigInt((await f.service.get("wt")).projectionSequence),
  ).toBeGreaterThan(BigInt(failedSequence));
  await f.manager.shutdown();
});
it("treats an interrupted stage as recovery-required and recovers only the prior verified generation", async () => {
  const f = await liveFixture();
  f.pause();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.entered.promise;
  const snapshot = new BetterSqlite3(f.db.serialize());
  databases.push(snapshot);
  snapshot.pragma("foreign_keys = ON");
  const freshManager = new WorktreeRuntimeManager({
    factory: {
      create: async () => {
        throw new Error("Recovery must remain lazy.");
      },
    },
  });
  const restarted = new WorktreeResourceAssignmentService({
    sqlite: snapshot,
    runtimeManager: freshManager,
    resources: { resolve: async () => skill, prepare: async () => undefined },
    providers: {
      prepare: async () => {
        throw new Error("No surviving provider.");
      },
    },
  });
  await restarted.reconcileStartup();
  expect(await restarted.get("wt")).toMatchObject({
    phase: "recovery_required",
    revision: "1",
    admission: { canSend: false },
  });
  expect(
    await restarted.recover({
      worktreeId: "wt",
      expectedRevision: "1",
      action: "recreate_affected_runtimes",
    }),
  ).toMatchObject({
    phase: "failed_rolled_back",
    revision: "1",
    resources: [{ desired: true, verified: false }],
  });
  f.proceed.resolve();
  await f.service.waitForReconciliation("wt");
  await f.manager.shutdown();
});
it("updates a Resource atomically across Worktrees and leaves no partial Assignment on failure", async () => {
  const { db } = fixture();
  db.prepare(
    `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt2','repo','other','/tmp/other','other','linked','ready',1,1)`,
  ).run();
  const manager = new WorktreeRuntimeManager({
    factory: {
      create: async () => {
        throw new Error("No provider must start.");
      },
    },
  });
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: manager,
    resources: {
      resolve: async (selection) => ({ ...skill, version: selection.version }),
      prepare: async () => undefined,
    },
    providers: {
      prepare: async () => {
        throw new Error("No live provider.");
      },
    },
  });
  await service.reconcileStartup();
  for (const worktreeId of ["wt", "wt2"]) {
    await service.setDesired({
      worktreeId,
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    });
    await service.waitForReconciliation(worktreeId);
  }
  await service.distribute({ kind: "skill", id: "review", targetVersion: "2" });
  for (const worktreeId of ["wt", "wt2"])
    expect(await service.get(worktreeId)).toMatchObject({
      revision: "2",
      phase: "stable",
      resources: [{ version: "2", status: "enabled" }],
    });
});
it("rolls back a global update before any Worktree receives a new revision", async () => {
  const f = await liveFixture();
  f.db
    .prepare(
      `INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt2','repo','other','/tmp/other','other','linked','ready',1,1)`,
    )
    .run();
  await f.service.reconcileStartup();
  const lease = await f.manager.acquireRuntime("codex", "wt2");
  lease.release();
  for (const worktreeId of ["wt", "wt2"]) {
    await f.service.setDesired({
      worktreeId,
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    });
    await f.service.waitForReconciliation(worktreeId);
  }
  f.setFailure("verify:opencode");
  await expect(
    f.service.distribute({ kind: "skill", id: "review", targetVersion: "2" }),
  ).rejects.toMatchObject({ code: "assignment_apply_failed" });
  for (const worktreeId of ["wt", "wt2"])
    expect(await f.service.get(worktreeId)).toMatchObject({
      revision: "1",
      phase: "stable",
      resources: [{ version: "1", status: "enabled" }],
    });
  await f.manager.shutdown();
});
it("removes Worktree Assignment state and retained runs after owned runtime shutdown", async () => {
  const f = await liveFixture();
  f.db.exec("INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('retained-run','repo','wt','t','','idle','idle',0,1,1)");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  await f.service.removeWorktree("wt");
  await expect(f.service.get("wt")).rejects.toMatchObject({
    code: "worktree_removing",
  });
  await expect(f.manager.acquireRuntime("codex", "wt")).rejects.toThrow(
    /removed/,
  );
  await f.manager.shutdown();
});
it("lazily attests a runtime before session admission and holds admission through the operation", async () => {
  const f = await liveFixture();
  const entered = deferred(),
    done = deferred();
  const session = f.service.withSessionAdmission(
    { worktreeId: "wt", agentKind: "codex", runId: "run", operation: "create" },
    async (lease) => {
      entered.resolve();
      await done.promise;
      return lease.runtime.generation;
    },
  );
  await entered.promise;
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect((await f.service.get("wt")).phase).toBe("waiting_for_idle");
  done.resolve();
  expect(await session).toBeTruthy();
  await f.service.waitForReconciliation("wt");
  expect((await f.service.get("wt")).phase).toBe("stable");
  await f.manager.shutdown();
});
it("retains committed outbox events when publication fails and replays them on restart", async () => {
  const { service, restart } = fixture();
  await service.reconcileStartup();
  const unsubscribe = service.subscribe(() => {
    throw new Error("Transport unavailable.");
  });
  await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await expect(service.waitForReconciliation("wt")).rejects.toThrow(
    "Transport unavailable.",
  );
  expect((await service.get("wt")).phase).toBe("stable");
  unsubscribe();
  const next = restart(),
    events: string[] = [];
  next.subscribe((event) => {
    events.push(event.projection.phase);
  });
  await next.reconcileStartup();
  expect(events).toEqual([
    "waiting_for_idle",
    "applying",
    "applying",
    "applying",
    "stable",
  ]);
});
it("uninstalls through one global removal commit", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  await f.service.distribute({
    kind: "skill",
    id: "review",
    targetVersion: null,
  });
  expect(await f.service.get("wt")).toMatchObject({
    phase: "stable",
    revision: "2",
    resources: [],
  });
  await f.manager.shutdown();
});
it("publishes distribution waiting without changing revision and refreshes a provisional removal", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  const reader = await f.manager.acquireAdmission("wt", "normal");
  const distribution = f.service.distribute({
    kind: "skill",
    id: "review",
    targetVersion: "2",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(await f.service.get("wt")).toMatchObject({
    phase: "waiting_for_idle",
    revision: "1",
  });
  await expect(
    f.service.setDesired({
      worktreeId: "wt",
      expectedRevision: "1",
      resources: [{ kind: "skill", id: "review", version: "2" }],
    }),
  ).rejects.toMatchObject({ code: "resource_update_pending" });
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "1",
    resources: [],
  });
  reader.release();
  await distribution;
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "stable",
    revision: "2",
    resources: [],
  });
  await f.manager.shutdown();
});
it("cancels a global update before effects without changing any Assignment revision", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  const reader = await f.manager.acquireAdmission("wt", "normal");
  const operation = f.service.startDistribution({
    kind: "skill",
    id: "review",
    targetVersion: "2",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.service.cancelDistribution(operation.operationId);
  await expect(operation.completion).rejects.toMatchObject({
    code: "operation_cancelled",
  });
  reader.release();
  expect(await f.service.get("wt")).toMatchObject({
    phase: "stable",
    revision: "1",
    resources: [{ version: "1" }],
  });
  await f.manager.shutdown();
});
it("recovers an interrupted global update as one operation without exposing partial desired versions", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  f.pause();
  const update = f.service.distribute({
    kind: "skill",
    id: "review",
    targetVersion: "2",
  });
  await f.entered.promise;
  const snapshot = new BetterSqlite3(f.db.serialize());
  databases.push(snapshot);
  snapshot.pragma("foreign_keys = ON");
  const manager = new WorktreeRuntimeManager({
    factory: {
      create: async () => {
        throw new Error("No live runtime survives restart.");
      },
    },
  });
  const restarted = new WorktreeResourceAssignmentService({
    sqlite: snapshot,
    runtimeManager: manager,
    resources: {
      resolve: async (selection) => ({ ...skill, version: selection.version }),
      prepare: async () => undefined,
    },
    providers: {
      prepare: async () => {
        throw new Error("No live provider.");
      },
    },
  });
  await restarted.reconcileStartup();
  expect(await restarted.get("wt")).toMatchObject({
    phase: "recovery_required",
    revision: "1",
    resources: [{ version: "1" }],
  });
  await restarted.recover({
    worktreeId: "wt",
    expectedRevision: "1",
    action: "recreate_affected_runtimes",
  });
  expect(await restarted.get("wt")).toMatchObject({
    phase: "stable",
    revision: "1",
    resources: [{ version: "1" }],
  });
  await restarted.setDesired({
    worktreeId: "wt",
    expectedRevision: "1",
    resources: [{ kind: "skill", id: "review", version: "3" }],
  });
  await restarted.waitForReconciliation("wt");
  expect((await restarted.get("wt")).revision).toBe("2");
  f.proceed.resolve();
  await update;
  await f.manager.shutdown();
});
it("cannot commit or claim rollback from an attestation returned after the owned process exits", async () => {
  const f = await liveFixture("exit:codex", ["codex"]);
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "recovery_required",
    admission: { canSend: false },
  });
  await f.manager.shutdown();
});

it.each([
  {
    kinds: ["codex"] as const,
    failure: "stage:codex",
    rollback: ["rollback:codex"],
  },
  {
    kinds: ["codex"] as const,
    failure: "activate:codex",
    rollback: ["rollback:codex"],
  },
  {
    kinds: ["codex"] as const,
    failure: "verify:codex",
    rollback: ["rollback:codex"],
  },
  {
    kinds: ["opencode"] as const,
    failure: "stage:opencode",
    rollback: ["rollback:opencode"],
  },
  {
    kinds: ["opencode"] as const,
    failure: "activate:opencode",
    rollback: ["rollback:opencode"],
  },
  {
    kinds: ["opencode"] as const,
    failure: "verify:opencode",
    rollback: ["rollback:opencode"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "stage:codex",
    rollback: ["rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "stage:opencode",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "activate:codex",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "activate:opencode",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "verify:codex",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "verify:opencode",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
  {
    kinds: ["codex", "opencode"] as const,
    failure: "drift:codex",
    rollback: ["rollback:opencode", "rollback:codex"],
  },
])(
  "verifies prior state after $failure with $kinds participants",
  async ({ kinds, failure, rollback }) => {
    const f = await liveFixture(failure, kinds);
    await f.service.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    });
    await f.service.waitForReconciliation("wt");
    expect(await f.service.get("wt")).toMatchObject({
      phase: "failed_rolled_back",
      revision: "1",
      admission: { canSend: true },
      resources: [{ desired: true, verified: false }],
    });
    expect(f.observations.filter((x) => x.startsWith("rollback"))).toEqual(
      rollback,
    );
    await f.manager.shutdown();
  },
);
it.each(["codex", "opencode"] as const)(
  "commits an Assignment with one %s participant",
  async (agentKind) => {
    const f = await liveFixture(null, [agentKind]);
    await f.service.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    });
    await f.service.waitForReconciliation("wt");
    expect((await f.service.get("wt", agentKind)).resources[0].status).toBe(
      "enabled",
    );
    await f.manager.shutdown();
  },
);
it("does not allocate a revision or attempt for the same complete set", async () => {
  const { service } = fixture();
  await service.reconcileStartup();
  await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await service.waitForReconciliation("wt");
  const before = await service.get("wt");
  expect(
    await service.setDesired({
      worktreeId: "wt",
      expectedRevision: "1",
      resources: [{ kind: "skill", id: "review", version: "1" }],
    }),
  ).toEqual(before);
});
it("rejects an owner identity that does not match the selected version before accepting desired state", async () => {
  const { service } = fixture();
  await service.reconcileStartup();
  await expect(
    service.setDesired({
      worktreeId: "wt",
      expectedRevision: "0",
      resources: [{ kind: "skill", id: "review", version: "other" }],
    }),
  ).rejects.toMatchObject({ code: "assignment_invalid_resource" });
  expect(await service.get("wt")).toMatchObject({
    revision: "0",
    phase: "stable",
    resources: [],
  });
});
it("rolls back safely after an atomic verified-commit failure", async () => {
  const f = await liveFixture();
  f.db.exec(
    `CREATE TRIGGER fail_verified_commit BEFORE UPDATE ON worktree_assignments WHEN NEW.phase='stable' AND NEW.verified_generation_id<>OLD.verified_generation_id BEGIN SELECT RAISE(ABORT,'Injected commit failure'); END`,
  );
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(await f.service.get("wt")).toMatchObject({
    phase: "failed_rolled_back",
    resources: [{ verified: false, status: "failed" }],
  });
  await f.manager.shutdown();
});
it("rolls back every global participant when the single global commit fails", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  f.db.exec(
    `CREATE TRIGGER fail_global_commit BEFORE UPDATE ON worktree_assignments WHEN NEW.revision>OLD.revision AND NEW.phase='stable' BEGIN SELECT RAISE(ABORT,'Injected global commit failure'); END`,
  );
  await expect(
    f.service.distribute({ kind: "skill", id: "review", targetVersion: "2" }),
  ).rejects.toMatchObject({ code: "assignment_apply_failed" });
  expect(await f.service.get("wt")).toMatchObject({
    phase: "stable",
    revision: "1",
    resources: [{ version: "1" }],
  });
  await f.manager.shutdown();
});
it("orders visible application progress without changing the desired revision", async () => {
  const f = await liveFixture();
  const steps: Array<string | undefined> = [],
    revisions: string[] = [];
  f.service.subscribe((event) => {
    if (event.projection.phase === "applying") {
      steps.push(event.projection.progress?.step ?? undefined);
      revisions.push(event.revision);
    }
  });
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(steps).toEqual(["staging", "activating", "verifying"]);
  expect(revisions).toEqual(["1", "1", "1"]);
  await f.manager.shutdown();
});
it("rejects explicit desired-only Resource use before submitting a turn on the rolled-back generation", async () => {
  const f = await liveFixture("verify:opencode");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  await expect(
    f.service.withTurnAdmission(
      {
        worktreeId: "wt",
        agentKind: "codex",
        runId: "run",
        externalSessionId: "session",
        explicitResources: [{ kind: "skill", id: "review", version: "1" }],
      },
      async () => {
        throw new Error("Provider must not receive this turn.");
      },
    ),
  ).rejects.toMatchObject({ code: "resource_unavailable" });
  await f.manager.shutdown();
});
it("shows an owned activity blocker while a writer waits and keeps the control lane open", async () => {
  const f = await liveFixture();
  const reader = await f.manager.acquireAdmission("wt", "normal");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  expect((await f.service.get("wt")).blockers).toEqual([
    {
      kind: "runtime_transition",
      sessionRunId: null,
      sessionTitle: null,
      canStop: true,
    },
  ]);
  const control = await f.manager.acquireAdmission("wt", "control");
  control.release();
  reader.release();
  await f.service.waitForReconciliation("wt");
  expect((await f.service.get("wt")).blockers).toEqual([]);
  await f.manager.shutdown();
});
it("commits an exactly proven interrupted target on explicit recovery", async () => {
  const f = await liveFixture("verify:opencode");
  f.failRollback();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect((await f.service.get("wt")).phase).toBe("recovery_required");
  f.setFailure(null);
  expect(
    await f.service.recover({
      worktreeId: "wt",
      expectedRevision: "1",
      action: "retry_recovery",
    }),
  ).toMatchObject({
    phase: "stable",
    revision: "1",
    resources: [{ desired: true, verified: true, status: "enabled" }],
  });
  await f.manager.shutdown();
});
it("excludes a declared incompatible provider without failing the compatible Assignment", async () => {
  const f = await liveFixture();
  f.setUnavailableProvider("codex");
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  expect(f.observations.filter((x) => x.startsWith("stage"))).toEqual([
    "stage:opencode:1",
  ]);
  expect(await f.service.get("wt", "codex")).toMatchObject({
    phase: "stable",
    resources: [{ status: "unavailable" }],
  });
  await f.manager.shutdown();
});
it("does not project Enabled for a live runtime whose attestation was invalidated", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  const runtime = f.manager
    .inspectWorktree("wt")
    .runtimes.find((r) => r.agentKind === "codex");
  if (!runtime) throw new Error("Expected a live owned Codex runtime.");
  f.manager.quarantineRuntime("codex", "wt", runtime.generation, "wake");
  expect(await f.service.get("wt", "codex")).toMatchObject({
    phase: "stable",
    admission: { canSend: false, reason: "runtime_verification" },
    resources: [{ status: "unavailable" }],
  });
  await f.manager.shutdown();
});
it("does not change revision when a Resource distribution already matches every affected Assignment", async () => {
  const f = await liveFixture();
  await f.service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await f.service.waitForReconciliation("wt");
  await f.service.distribute({
    kind: "skill",
    id: "review",
    targetVersion: "1",
  });
  expect((await f.service.get("wt")).revision).toBe("1");
  await f.manager.shutdown();
});
it.each([
  "success",
  "verify_failure",
  "commit_failure",
  "startup_failure",
  "startup_unverified",
  "finalization_failure",
])("owns replacement generations through %s", async (outcome) => {
  const { db } = fixture();
  const stopped: string[] = [];
  let failOldStop = true;
  const manager = new WorktreeRuntimeManager({
    idleTimeoutMs: 60_000,
    maximumRuntimes: 1,
    attestationVerifier: new DatabaseRuntimeAttestationVerifier(db),
    factory: {
      create: async ({ agentKind, worktreeId, generation }) => {
        if (
          generation.endsWith(":2") &&
          (outcome === "startup_failure" || outcome === "startup_unverified")
        )
          throw new WorktreeRuntimeStartupError(
            new Error("Injected startup failure."),
            outcome === "startup_failure",
          );
        return {
          agentKind,
          worktreeId,
          generation,
          providerVersion: "1",
          stop: async () => {
            if (
              outcome === "finalization_failure" &&
              generation.endsWith(":1") &&
              failOldStop
            ) {
              failOldStop = false;
              throw new Error("Injected owned-exit failure.");
            }
            stopped.push(generation);
          },
        };
      },
    },
  });
  const service = new WorktreeResourceAssignmentService({
    sqlite: db,
    runtimeManager: manager,
    resources: { resolve: async () => skill, prepare: async () => undefined },
    providers: {
      prepare: async (runtime, target, prior) => {
        const replacement = manager.reserveAssignmentReplacement(
          runtime.agentKind,
          runtime.worktreeId,
          runtime.generation,
        );
        const expected = {
          agentKind: runtime.agentKind,
          runtimeGenerationId: replacement.generation,
          assignmentGenerationId: target.id,
          catalogGenerationId: `replacement-${target.id}`,
          providerVersion: "1",
          adapterContractVersion: 1,
          effectiveStateDigest: digest,
          skillIsolation: "not_enforced" as const,
          attestedAt: new Date().toISOString(),
        };
        const priorExpected = {
          ...expected,
          runtimeGenerationId: runtime.generation,
          assignmentGenerationId: prior.id,
          catalogGenerationId: `replacement-${prior.id}`,
        };
        return {
          expected,
          priorExpected,
          projectionDigest: digest,
          priorProjectionDigest: digest,
          stage: async () => {
            await replacement.stage();
            expect(stopped).toEqual([]);
          },
          activate: async () => {
            await replacement.activate();
          },
          verify: async () => {
            if (outcome === "verify_failure")
              throw new Error("Verification failed.");
            return expected;
          },
          rollback: async () => {
            await replacement.rollback();
            return priorExpected;
          },
          discard: async () => {
            await replacement.discard();
          },
          finalize: async () => {
            await replacement.finalize();
          },
        };
      },
    },
  });
  await service.reconcileStartup();
  const prior = await manager.acquireRuntime("codex", "wt");
  const priorGeneration = prior.runtime.generation;
  prior.release();
  if (outcome === "commit_failure")
    db.exec(
      `CREATE TRIGGER replacement_commit_failure BEFORE UPDATE ON worktree_assignments WHEN NEW.phase='stable' AND NEW.verified_generation_id<>OLD.verified_generation_id BEGIN SELECT RAISE(ABORT,'Injected commit failure'); END`,
    );
  await service.setDesired({
    worktreeId: "wt",
    expectedRevision: "0",
    resources: [{ kind: "skill", id: "review", version: "1" }],
  });
  await service.waitForReconciliation("wt");
  const active = manager.inspectWorktree("wt").runtimes[0].generation;
  if (outcome === "success") {
    expect(active).not.toBe(priorGeneration);
    expect(stopped).toEqual([priorGeneration]);
    expect((await service.get("wt")).phase).toBe("stable");
  } else if (outcome === "finalization_failure") {
    expect((await service.get("wt")).phase).toBe("recovery_required");
    expect(
      (
        await service.recover({
          worktreeId: "wt",
          expectedRevision: "1",
          action: "recreate_affected_runtimes",
        })
      ).phase,
    ).toBe("stable");
    await manager.shutdown();
    expect(stopped).toHaveLength(2);
    return;
  } else if (outcome === "startup_failure") {
    expect(active).toBe(priorGeneration);
    expect(stopped).toEqual([]);
    expect((await service.get("wt")).phase).toBe("failed_rolled_back");
  } else if (outcome === "startup_unverified") {
    expect((await service.get("wt")).phase).toBe("recovery_required");
    await expect(manager.shutdown()).rejects.toThrow(/Replacement shutdown/);
    return;
  } else {
    expect(active).toBe(priorGeneration);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).not.toBe(priorGeneration);
    expect((await service.get("wt")).phase).toBe("failed_rolled_back");
  }
  await manager.shutdown();
  expect(stopped).toHaveLength(outcome === "startup_failure" ? 1 : 2);
});
it("supersedes a pre-effect global target with a fresh immutable operation", async () => {
  const f = await liveFixture(); await f.service.setDesired({ worktreeId: "wt", expectedRevision: "0", resources: [{ kind: "skill", id: "review", version: "1" }] }); await f.service.waitForReconciliation("wt");
  const reader = await f.manager.acquireAdmission("wt", "normal");
  const old = f.service.startDistribution({ kind: "skill", id: "review", targetVersion: "2" }); await new Promise<void>(resolve => setImmediate(resolve));
  const oldResult = old.completion.catch(error => error);
  const replacement = f.service.startDistribution({ kind: "skill", id: "review", targetVersion: "3" }); await new Promise<void>(resolve => setImmediate(resolve));
  reader.release(); expect(await oldResult).toMatchObject({ code: "operation_cancelled" }); await replacement.completion;
  expect(await f.service.get("wt")).toMatchObject({ phase: "stable", revision: "2", resources: [{ version: "3" }] }); await f.manager.shutdown();
});

it("rejects an explicit Resource when its verified generation changes while admission prepares", async () => {
  const f = fixture();
  await f.service.reconcileStartup();
  await f.service.setDesired({worktreeId:"wt",expectedRevision:"0",resources:[{kind:"skill",id:"review",version:"1"}]});
  await f.service.waitForReconciliation("wt");
  let resume!:()=>void, entered!:()=>void;
  const preparing=new Promise<void>(resolve=>{entered=resolve;});
  const paused=new Promise<void>(resolve=>{resume=resolve;});
  const service=new WorktreeResourceAssignmentService({sqlite:f.db,runtimeManager:f.manager,
    resources:{resolve:async()=>skill,prepare:async()=>{entered();await paused;}},
    providers:{prepare:async()=>{throw new Error("No provider may receive a stale explicit Resource.");}}});
  const admission=service.withTurnAdmission({worktreeId:"wt",agentKind:"codex",runId:"run",externalSessionId:"session",explicitResources:[{kind:"skill",id:"review",version:"1"}]},async()=>{throw new Error("A stale explicit Resource was admitted.");});
  const rejected=expect(admission).rejects.toMatchObject({code:"resource_unavailable"});
  await preparing;
  await f.service.setDesired({worktreeId:"wt",expectedRevision:"1",resources:[]});
  await f.service.waitForReconciliation("wt");
  resume();
  await rejected;
  await f.manager.shutdown();
});

it.each(["waiting_for_idle","applying","recovery_required","busy"] as const)("removes a Worktree safely from %s without losing the shutdown barrier",async phase=>{
  const f=await liveFixture(phase === "recovery_required" ? "verify:opencode" : null);
  let reader:Awaited<ReturnType<typeof f.manager.acquireAdmission>>|undefined;
  let heldTurn:Promise<void>|undefined;
  const terminal=deferred(),turnEntered=deferred();
  if(phase === "waiting_for_idle")reader=await f.manager.acquireAdmission("wt","normal");
  if(phase === "applying")f.pause();
  if(phase === "recovery_required")f.failRollback();
  if(phase !== "busy") {
    await f.service.setDesired({worktreeId:"wt",expectedRevision:"0",resources:[{kind:"skill",id:"review",version:"1"}]});
    if(phase === "applying")await f.entered.promise;
    else if(phase === "recovery_required")await f.service.waitForReconciliation("wt");
    expect((await f.service.get("wt")).phase).toBe(phase);
  } else {
    await f.service.withSessionAdmission({worktreeId:"wt",agentKind:"codex",runId:"run",operation:"create"},async lease=>{
      f.manager.registerSessionRoute({worktreeId:"wt",agentKind:"codex",runId:"run",externalSessionId:"session",runtimeGeneration:lease.runtime.generation,assignmentGenerationId:lease.assignmentGenerationId,catalogGenerationId:lease.catalogGenerationId});
    });
    heldTurn=f.service.withTurnAdmission({worktreeId:"wt",agentKind:"codex",runId:"run",externalSessionId:"session"},async()=>{turnEntered.resolve();await terminal.promise;});
    await turnEntered.promise;
    expect(f.manager.inspectWorktree("wt").busy).toBe(true);
  }
  let externalRemoval=false;
  const removal=f.service.removeWorktree("wt",async()=>{expect(f.manager.inspectWorktree("wt").runtimes).toHaveLength(0);externalRemoval=true;});
  await new Promise<void>(resolve=>setImmediate(resolve));
  if(phase === "waiting_for_idle" || phase === "applying" || phase === "busy")expect(externalRemoval).toBe(false);
  reader?.release();f.proceed.resolve();terminal.resolve();await heldTurn;
  await removal;
  expect(externalRemoval).toBe(true);
  await expect(f.service.get("wt")).rejects.toMatchObject({code:"worktree_removing"});
  await f.manager.shutdown();
});
