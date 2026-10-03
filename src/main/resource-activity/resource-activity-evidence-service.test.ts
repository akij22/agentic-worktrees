import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDatabaseUpgrades } from "../database";
import { bootstrapSchemaSql } from "../database/bootstrap";
import { ResourceActivityRepository } from "./resource-activity-repository";
import { ResourceActivityEvidenceService } from "./resource-activity-evidence-service";
import type { ActivityLineage } from "../../shared/resource-activity";

const digest = `sha256:${"a".repeat(64)}`;
const lineage: ActivityLineage = {
  worktreeId: "wt",
  assignmentRevision: "9007199254740993",
  assignmentGenerationId: "gen",
  catalogGenerationId: "catalog",
  runtimeGenerationId: "runtime",
  provider: "codex",
  providerVersion: "0.154.0",
  adapterContractVersion: 1,
};
const identity = {
  resourceKind: "capability" as const,
  resourceId: "test.echo",
  resourceVersion: "0.1.0",
  resourceDigest: digest,
};
const entered = {
  type: "entered" as const,
  invocationId: "11111111-1111-4111-8111-111111111111",
  capabilityId: "test.echo",
  capabilityVersion: "0.1.0",
  toolName: "echo_text",
};
const request = {
  type: "request" as const,
  lineage,
  providerContract: "fixture/v1",
  sourceIdentity: "request-event",
  requestIdentity: "call-one",
  rawSessionId: "private-session",
  serverName: "owned-server",
  toolName: "echo_text",
};
const terminal = {
  ...request,
  type: "terminal" as const,
  sourceIdentity: "terminal-event",
  receipt: {
    version: 1 as const,
    invocationId: entered.invocationId,
    outcome: "success" as const,
  },
};

describe("ResourceActivityEvidenceService", () => {
  let database: BetterSqlite3.Database;
  let service: ResourceActivityEvidenceService;
  const quarantines: string[] = [];
  const published: unknown[] = [];
  let cancelOwned: (
    snapshot: ActivityLineage,
    id: string,
  ) => Promise<boolean> = async () => false;
  let now = new Date("2026-10-01T10:00:00Z");
  const instances: ResourceActivityEvidenceService[] = [];
  const makeService = (
    keyVersion = 1,
    previousKeys: Record<number, Uint8Array> = {},
    skillBodyDigest?: string,
  ) => {
    const instance = new ResourceActivityEvidenceService({
      repository: new ResourceActivityRepository(database),
      keyVersion,
      previousKeys,
      evidenceKey: Buffer.alloc(32, keyVersion === 1 ? 7 : 8),
      cancelOwnedInvocation: (snapshot, id) => cancelOwned(snapshot, id),
      cancellationTimeoutMs: 20,
      onChanged: (event) =>
        published.push({ event, snapshot: service.getSnapshot(event.runId) }),
      now: () => now,
      quarantine: (value) => {
        quarantines.push(value.runtimeGenerationId);
      },
      providerContracts: [
        {
          name: "fixture/v1",
          provider: "codex",
          providerVersion: "0.154.0",
          adapterContractVersion: 1,
          resolveSkillBodyDigest: skillBodyDigest
            ? () => skillBodyDigest
            : undefined,
          resolveSkill: () => ({
            resourceKind: "skill",
            resourceId: "test.skill",
            resourceVersion: "0.1.0",
            resourceDigest: digest,
          }),
          resolveTool: (snapshot, server, tool) =>
            snapshot.catalogGenerationId === "catalog" &&
            server === "owned-server" &&
            tool === "echo_text"
              ? identity
              : null,
        },
      ],
    });
    instances.push(instance);
    return instance;
  };
  beforeEach(() => {
    quarantines.length = 0;
    published.length = 0;
    now = new Date("2026-10-01T10:00:00Z");
    database = new BetterSqlite3(":memory:");
    database.pragma("foreign_keys=ON");
    database.exec(bootstrapSchemaSql);
    database.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);
      INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/private/worktree','main','primary','ready',1,1);
      INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','private-prompt','running','idle',0,1,1),('other-run','repo','wt','t','private-prompt','running','idle',0,1,1);
      INSERT INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES ('resource','capability','test.echo','0.1.0','${digest}','${digest}',1);
      INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES ('gen','wt',0,'${digest}',1);
      INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES ('member','gen','resource','${digest}','${digest}');
      INSERT INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES ('skill-resource','skill','test.skill','0.1.0','${digest}','${digest}',1);
      INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES ('skill-member','gen','skill-resource','${digest}','${digest}');
      INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('catalog','wt','codex','gen','0.154.0',1,'${digest}',1);
      INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES ('wt',9007199254740993,0,'stable','gen','gen',1,1);
      INSERT INTO worktree_runtime_assignment_attestations (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at) VALUES ('wt','codex','runtime','gen','catalog','0.154.0','${digest}',1);`);
    service = makeService();
  });
  afterEach(() => {
    for (const instance of instances.splice(0)) instance.dispose();
    vi.useRealTimers();
    database.close();
  });
  it("keeps requests distinct from use then atomically pairs the exact terminal receipt", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    expect(service.ingestProvider(request).disposition).toBe("applied");
    expect(service.getSnapshot("run")).toMatchObject({
      sequence: "1",
      items: [{ requestState: "requested", useState: "not_confirmed" }],
    });
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    expect(service.getSnapshot("run").items).toHaveLength(1);
    expect(service.ingestProvider(terminal).disposition).toBe("applied");
    expect(service.getSnapshot("run").items).toMatchObject([
      {
        requestState: "requested",
        useState: "confirmed",
        outcome: "success",
        coverage: "qualified",
      },
    ]);
    expect(service.getSnapshot("run").items).toHaveLength(1);
    expect(service.ingestProvider(terminal).disposition).toBe("duplicate");
    service = makeService();
    expect(service.ingestProvider(terminal).disposition).toBe("duplicate");
    expect(JSON.stringify(service.getSnapshot("run"))).not.toMatch(
      /private|invocationId|hmac:|runtime|catalog/,
    );
  });
  it("detaches conflicting session claims and never reassigns a quarantined receipt", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.registerSessionRoute(lineage, "second-session", "other-run");
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    service.ingestProvider(terminal);
    expect(
      service.ingestProvider({
        ...terminal,
        sourceIdentity: "second-claim",
        rawSessionId: "second-session",
      }).disposition,
    ).toBe("conflict");
    expect(service.getSnapshot("run").items).toEqual([]);
    expect(service.getSnapshot("other-run").items).toEqual([]);
    service.ingestProvider({
      ...terminal,
      sourceIdentity: "third-claim",
      requestIdentity: null,
    });
    expect(service.getSnapshot("run").items).toEqual([]);
    expect(quarantines).toContain("runtime");
  });

  it("keeps the proven session when routing mismatches and quarantines admission", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    expect(
      service.ingestProvider({
        ...terminal,
        routingIntegrity: "lease_mismatch",
      }).disposition,
    ).toBe("applied");
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", outcome: "success" },
    ]);
    expect(quarantines).toEqual(["runtime"]);
  });

  it("quarantines contradictory terminal outcomes without changing host execution truth", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "thrown" },
    });
    expect(service.ingestProvider(terminal).disposition).toBe("conflict");
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", outcome: "thrown", coverage: "conflict" },
    ]);
    expect(quarantines).toEqual(["runtime"]);
  });

  it("rejects spoofed terminal use and stale or unqualified observations without synthetic activity", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    expect(service.ingestProvider(terminal).disposition).toBe("unmatched");
    expect(
      service.ingestProvider({
        ...terminal,
        lineage: { ...lineage, providerVersion: "unknown" },
      }).disposition,
    ).toBe("stale_rejected");
    expect(
      service.ingestProvider({
        ...terminal,
        lineage: { ...lineage, runtimeGenerationId: "unknown" },
      }).disposition,
    ).toBe("stale_rejected");
    expect(service.getSnapshot("run")).toMatchObject({
      sequence: "0",
      items: [],
    });
  });

  it("orders the sanitized item by confirmed entry time, never completion time", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    now = new Date("2026-10-01T10:01:00Z");
    service.ingestHost({ lineage, identity, observation: entered });
    now = new Date("2026-10-01T10:02:00Z");
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    now = new Date("2026-10-01T10:03:00Z");
    service.ingestProvider(terminal);
    expect(service.getSnapshot("run").items[0].occurredAt).toBe(
      "2026-10-01T10:01:00.000Z",
    );
  });

  it("replays retained evidence across key rotation without persisting raw identifiers", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    service.ingestProvider(terminal);
    const snapshot = service.getSnapshot("run");
    service = makeService(2, { 1: Buffer.alloc(32, 7) });
    expect(service.ingestProvider(terminal).disposition).toBe("duplicate");
    expect(service.getSnapshot("run")).toEqual(snapshot);
    service = makeService(2);
    expect(service.ingestProvider(terminal).disposition).toBe("stale_rejected");
    expect(service.getSnapshot("run")).toEqual(snapshot);
  });

  it("accepts late outcome and history only for anchored retired-generation chains", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    service.ingestHost({ lineage, identity, observation: entered });
    database.exec(
      "UPDATE worktree_runtime_assignment_attestations SET invalidated_at=2",
    );
    expect(
      service.ingestHost({
        lineage,
        identity,
        observation: { ...entered, type: "outcome", outcome: "success" },
      }).disposition,
    ).toBe("applied");
    expect(service.ingestProvider(terminal).disposition).toBe("applied");
    expect(service.ingestProvider(request).disposition).toBe("duplicate");
    expect(
      service.ingestHost({
        lineage,
        identity,
        observation: {
          ...entered,
          invocationId: "22222222-2222-4222-8222-222222222222",
        },
      }).disposition,
    ).toBe("stale_rejected");
    expect(service.getSnapshot("run").items).toHaveLength(1);
  });

  it("retains direct host use as Unknown and closes missing outcomes as evidence gaps on retirement", () => {
    service.ingestHost({ lineage, identity, observation: entered });
    expect(service.getSnapshot("run").items).toEqual([]);
    now = new Date("2026-11-02T10:00:00Z");
    expect(service.pruneRetention().activities).toBe(0);
    database
      .prepare(
        "UPDATE worktree_runtime_assignment_attestations SET invalidated_at=?",
      )
      .run(now.getTime());
    service.retireRuntime(lineage);
    now = new Date("2026-12-01T10:00:00Z");
    expect(service.pruneRetention().activities).toBe(0);
    now = new Date("2026-12-03T10:00:00Z");
    expect(service.pruneRetention().activities).toBe(1);
  });

  it("confirms cancellation only for an exact registered dispatch, host acknowledgement, and terminal outcome", async () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.registerSessionRoute(lineage, "second-session", "other-run");
    service.ingestHost({ lineage, identity, observation: entered });
    service.registerInvocationDispatch(
      lineage,
      "private-session",
      entered.invocationId,
      "fixture/v1",
    );
    await expect(
      service.cancelInvocation(lineage, "second-session", entered.invocationId),
    ).rejects.toThrow(/ownership/);
    cancelOwned = async (snapshot, id) => {
      expect(snapshot).toEqual(lineage);
      expect(id).toBe(entered.invocationId);
      service.ingestHost({
        lineage,
        identity,
        observation: { ...entered, type: "outcome", outcome: "cancelled" },
      });
      return true;
    };
    await expect(
      service.cancelInvocation(
        lineage,
        "private-session",
        entered.invocationId,
      ),
    ).resolves.toBe("cancelled");
    expect(service.getSnapshot("run").items).toEqual([]);
    service.ingestProvider({
      ...terminal,
      receipt: { ...terminal.receipt, outcome: "cancelled" },
    });
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", outcome: "cancelled" },
    ]);
  });

  it("requires the receipt to match the exact host tool forward mapping", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    const different = { ...entered, toolName: "different_tool" };
    service.ingestHost({ lineage, identity, observation: different });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...different, type: "outcome", outcome: "success" },
    });
    expect(service.ingestProvider(terminal).disposition).toBe("stale_rejected");
    expect(service.getSnapshot("run").items).toEqual([]);
    expect(quarantines).toEqual(["runtime"]);
  });

  it("reconciles qualified terminal evidence arriving before the host outcome without guessing", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    expect(service.ingestProvider(terminal).disposition).toBe("unmatched");
    expect(service.getSnapshot("run").items[0].useState).toBe("not_confirmed");
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", outcome: "success" },
    ]);
  });

  it("confirms Skill use only from a qualified complete immutable context-entry receipt", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    const skill = {
      lineage,
      providerContract: "fixture/v1",
      rawSessionId: "private-session",
      requestIdentity: "skill-call",
      skillRoute: "owned-skill",
      mode: "explicit" as const,
    };
    service.ingestSkill({
      ...skill,
      type: "request",
      sourceIdentity: "skill-request",
    });
    const requestId = service.getSnapshot("run").items[0].id;
    expect(service.getSnapshot("run").items[0].useState).toBe("not_confirmed");
    expect(
      service.ingestSkill({
        ...skill,
        type: "context",
        sourceIdentity: "partial-context",
        receiptIdentity: "context-receipt",
        bodyDigest: digest,
        completeBody: false,
      }).disposition,
    ).toBe("stale_rejected");
    service.ingestSkill({
      ...skill,
      type: "context",
      sourceIdentity: "full-context",
      receiptIdentity: "context-receipt",
      bodyDigest: digest,
      completeBody: true,
    });
    expect(service.getSnapshot("run").items).toMatchObject([
      { resourceKind: "skill", useState: "confirmed", outcome: "success" },
    ]);
    expect(service.getSnapshot("run").items).toHaveLength(1);
    expect(service.getSnapshot("run").items[0].id).toBe(requestId);
  });

  it("verifies Skill context against its body digest independently of the immutable package digest", () => {
    service = makeService(1, {}, `sha256:${"b".repeat(64)}`);
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestSkill({
      lineage,
      providerContract: "fixture/v1",
      rawSessionId: "private-session",
      requestIdentity: "body-request",
      sourceIdentity: "body-context",
      skillRoute: "owned-skill",
      mode: "explicit",
      type: "context",
      receiptIdentity: "body-receipt",
      bodyDigest: `sha256:${"b".repeat(64)}`,
      completeBody: true,
    });
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", resourceId: "test.skill" },
    ]);
  });

  it("bounds missing host acknowledgement and leaves cancellation unproven", async () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestHost({ lineage, identity, observation: entered });
    service.registerInvocationDispatch(
      lineage,
      "private-session",
      entered.invocationId,
      "fixture/v1",
    );
    cancelOwned = () => new Promise(() => undefined);
    await expect(
      service.cancelInvocation(
        lineage,
        "private-session",
        entered.invocationId,
      ),
    ).rejects.toThrow(/missing/);
    expect(service.getSnapshot("run").items).toEqual([]);
    expect(quarantines).toEqual(["runtime"]);
  });

  it("automatically prunes expired Unknown activity while keeping session history", () => {
    vi.useFakeTimers();
    service = makeService();
    service.ingestHost({ lineage, identity, observation: entered });
    service.ingestHost({
      lineage,
      identity,
      observation: { ...entered, type: "outcome", outcome: "success" },
    });
    now = new Date("2026-11-02T10:00:00Z");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(service.pruneRetention().activities).toBe(0);
  });

  it("ingests safely after the idempotent startup upgrade of an existing activity database", () => {
    database.exec(
      "ALTER TABLE resource_activity_evidence DROP COLUMN canonical_digest",
    );
    applyDatabaseUpgrades(database);
    applyDatabaseUpgrades(database);
    expect(
      service.ingestHost({ lineage, identity, observation: entered })
        .disposition,
    ).toBe("applied");
    expect(service.getSnapshot("run").items).toEqual([]);
  });
  it("terminalizes a provider rejection before entry as Requested, never Used", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    expect(
      service.ingestProvider({
        ...request,
        type: "pre_entry_failure",
        sourceIdentity: "rejected-event",
        outcome: "permission_denied",
      }).disposition,
    ).toBe("applied");
    expect(service.getSnapshot("run").items).toMatchObject([
      {
        requestState: "requested",
        useState: "not_confirmed",
        outcome: "permission_denied",
        lifecycle: "terminal",
      },
    ]);
  });

  it("publishes only sanitized deltas after the matching snapshot is committed", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    expect(published).toMatchObject([
      {
        event: {
          sequence: "1",
          change: { type: "upsert", item: { useState: "not_confirmed" } },
        },
        snapshot: { sequence: "1" },
      },
    ]);
    expect(JSON.stringify(published)).not.toMatch(
      /private|hmac:|invocationId|catalogGeneration|runtimeGeneration/,
    );
  });
  it("replays anchored invocation lineage after the running process receives a newer catalog", () => {
    service.registerSessionRoute(lineage, "private-session", "run");
    service.ingestProvider(request);
    service.ingestHost({ lineage, identity, observation: entered });
    database.exec(`INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('new-catalog','wt','codex','gen','0.154.0',1,'sha256:${"b".repeat(64)}',2);
      UPDATE worktree_runtime_assignment_attestations SET catalog_generation_id='new-catalog';`);
    expect(
      service.ingestHost({
        lineage,
        identity,
        observation: { ...entered, type: "outcome", outcome: "success" },
      }).disposition,
    ).toBe("applied");
    expect(service.ingestProvider(terminal).disposition).toBe("applied");
    expect(service.getSnapshot("run").items).toMatchObject([
      { useState: "confirmed", outcome: "success" },
    ]);
  });
  it("expires resolved coverage gaps without creating session activity", () => {
    const unqualified = { ...lineage, providerVersion: "unqualified-version" };
    service.ingestProvider({ ...terminal, lineage: unqualified });
    service.resolveCoverage(unqualified);
    now = new Date("2026-11-02T10:00:00Z");
    expect(service.pruneRetention().coverage).toBe(1);
    expect(service.getSnapshot("run").items).toEqual([]);
  });
});
