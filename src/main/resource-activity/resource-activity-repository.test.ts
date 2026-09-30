import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSchemaSql } from "../database/bootstrap";
import type {
  ResourceActivity,
  ResourceActivityEvidence,
  SessionResourceActivityChangedEvent,
} from "../../shared/resource-activity";
import { ResourceActivityRepository } from "./resource-activity-repository";

const digest = `sha256:${"a".repeat(64)}`;
const evidenceKey = (character: string) => `hmac:v1:${character.repeat(64)}`;
const observedAt = new Date("2026-09-15T10:00:00.000Z");

describe("ResourceActivityRepository", () => {
  let sqlite: BetterSqlite3.Database;
  let repository: ResourceActivityRepository;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:"); sqlite.pragma("foreign_keys = ON"); sqlite.exec(bootstrapSchemaSql);
    sqlite.exec(`INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1);
      INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES ('wt','repo','w','/tmp/w','main','primary','ready',1,1);
      INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo','wt','t','secret','running','idle',0,1,1);
      INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES ('gen','wt',0,'${digest}',1);
      INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES ('catalog','wt','codex','gen','1.0.0',1,'${digest}',1);`);
    repository = new ResourceActivityRepository(sqlite);
  });
  afterEach(() => sqlite.close());

  const input = (): {
    activity: ResourceActivity;
    evidence: ResourceActivityEvidence;
    event: SessionResourceActivityChangedEvent | null;
  } => ({
    activity: { id: "activity", worktreeId: "wt", runId: "run", resourceKind: "capability" as const, resourceId: "search", resourceVersion: "1.0.0", resourceDigest: digest, assignmentRevision: "0", assignmentGenerationId: "gen", catalogGenerationId: "catalog", runtimeGenerationId: "runtime", provider: "codex" as const, providerVersion: "1.0.0", adapterContractVersion: 1, requestKey: evidenceKey("b"), correlationKey: null, requestState: "requested" as const, useState: "not_confirmed" as const, lifecycle: "open" as const, outcome: "not_observed" as const, attribution: "exact" as const, mode: "explicit" as const, routingIntegrity: "verified" as const, coverage: "qualified" as const, requestedAt: observedAt, enteredOrLoadedAt: null, finishedAt: null, firstObservedAt: observedAt, lastObservedAt: observedAt },
    evidence: { id: "evidence", activityId: "activity", boundary: "application.request" as const, sourceEventKey: evidenceKey("c"), correlationKey: null, providerContract: "contract-v1", observedAt },
    event: { eventId: "event", runId: "run", sequence: "1", change: { type: "upsert" as const, item: { id: "activity", resourceKind: "capability" as const, resourceId: "search", resourceVersion: "1.0.0", requestState: "requested" as const, useState: "not_confirmed" as const, lifecycle: "open" as const, outcome: "not_observed" as const, mode: "explicit" as const, coverage: "qualified" as const, occurredAt: observedAt.toISOString() } } },
  });

  it("atomically writes activity, evidence, stream sequence and safe outbox delta", () => {
    expect(repository.recordActivity(input())).toEqual({ kind: "recorded", sequence: "1" });
    expect(sqlite.prepare("SELECT sequence FROM resource_activity_streams WHERE run_id='run'").get()).toEqual({ sequence: 1 });
    const payload = sqlite.prepare("SELECT safe_delta_json payload FROM resource_activity_outbox").get() as { payload: string };
    expect(payload.payload).not.toContain("secret");
    expect(JSON.parse(payload.payload)).toEqual(JSON.parse(JSON.stringify(input().event)));
    expect(repository.listPendingOutbox()).toMatchObject([{ event: { eventId: "event", sequence: "1" } }]);
    repository.markOutboxPublished("event", new Date("2026-09-15T10:01:00.000Z"));
    expect(repository.listPendingOutbox()).toEqual([]);
    expect(() => repository.markOutboxPublished("event", new Date())).toThrow(/already published/i);
    expect(repository.getSnapshot("run")).toMatchObject({ runId: "run", sequence: "1", items: [{ id: "activity", resourceId: "search" }] });
  });

  it("registers exact session routes and coverage with replay conflict detection", () => {
    const route = { routeKey:evidenceKey("d"),runId:"run",worktreeId:"wt",provider:"codex" as const,providerVersion:"1.0.0",adapterContractVersion:1,runtimeGenerationId:"runtime",assignmentGenerationId:"gen",catalogGenerationId:"catalog",registeredAt:observedAt,retiredAt:null };
    repository.registerSessionRoute(route);
    repository.retireSessionRoute(route.routeKey,new Date("2026-09-15T10:01:00.000Z"));
    expect(() => repository.retireSessionRoute(route.routeKey,new Date())).toThrow(/already retired/i);
    const coverage = { id:"coverage",worktreeId:"wt",provider:"codex" as const,providerVersion:"1.0.0",adapterContractVersion:1,runtimeGenerationId:"runtime",assignmentGenerationId:"gen",catalogGenerationId:"catalog",kind:"evidence_gap" as const,sourceEventKey:evidenceKey("e"),observedAt,resolvedAt:null };
    expect(repository.recordCoverage(coverage)).toBe("recorded");
    expect(repository.recordCoverage(coverage)).toBe("replayed");
    expect(() => repository.recordCoverage({ ...coverage,id:"other" })).toThrow(/conflicting/i);
  });

  it("prunes only expired terminal unattributed activity, resolved coverage, and published outbox", () => {
    repository.recordActivity(input());
    const old=new Date("2026-07-01T00:00:00.000Z").getTime();
    sqlite.prepare("UPDATE resource_activity SET run_id=NULL,attribution='unknown',lifecycle='terminal',finished_at=?,last_observed_at=? WHERE id='activity'").run(old,old);
    sqlite.prepare("UPDATE resource_activity_outbox SET published_at=?").run(old);
    sqlite.prepare(`INSERT INTO resource_evidence_coverage (id,worktree_id,provider,provider_version,adapter_contract_version,runtime_generation_id,kind,source_event_key,observed_at,resolved_at) VALUES ('expired','wt','codex','1',1,'runtime','evidence_gap',?, ?, ?)`).run(evidenceKey("f"),old,old);
    expect(repository.pruneRetention(new Date("2026-09-15T00:00:00.000Z"))).toEqual({ activities:1,coverage:1,outbox:1 });
    expect(sqlite.prepare("SELECT count(*) count FROM resource_activity_evidence").get()).toEqual({count:0});
  });

  it("treats an identical evidence replay as a no-op and rejects conflicting replay", () => {
    expect(repository.recordActivity(input()).kind).toBe("recorded");
    expect(repository.recordActivity(input())).toEqual({ kind: "replayed", sequence: "1" });
    const conflict = input(); conflict.evidence.providerContract = "different";
    expect(() => repository.recordActivity(conflict)).toThrow(/conflicting/i);
    expect(sqlite.prepare("SELECT count(*) count FROM resource_activity_outbox").get()).toEqual({ count: 1 });
  });

  it("persists unattributed host activity without exposing it through a session stream", () => {
    const unknown = input();
    unknown.activity = {
      ...unknown.activity,
      runId: null,
      requestKey: null,
      correlationKey: evidenceKey("f"),
      requestState: "not_observed",
      requestedAt: null,
      useState: "confirmed",
      enteredOrLoadedAt: observedAt,
      attribution: "unknown",
      mode: "unknown",
      coverage: "pending",
    };
    unknown.evidence = {
      ...unknown.evidence,
      boundary: "capability_host.entered",
      correlationKey: evidenceKey("f"),
    };

    expect(repository.recordActivity({ ...unknown, event: null })).toEqual({
      kind: "recorded",
      sequence: null,
    });
    expect(sqlite.prepare("SELECT run_id runId, attribution FROM resource_activity WHERE id='activity'").get()).toEqual({
      runId: null,
      attribution: "unknown",
    });
    expect(sqlite.prepare("SELECT count(*) count FROM resource_activity_streams").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT count(*) count FROM resource_activity_outbox").get()).toEqual({ count: 0 });
  });
});
