import type BetterSqlite3 from "better-sqlite3";
import {
  resourceActivityEvidenceSchema,
  resourceActivitySchema,
  resourceActivitySessionRouteSchema,
  resourceEvidenceCoverageRecordSchema,
  sessionResourceActivityChangedEventSchema,
  sessionResourceActivitySnapshotSchema,
  type ResourceActivity,
  type ResourceActivityEvidence,
  type ResourceActivitySessionRoute,
  type ResourceEvidenceCoverageRecord,
  type SessionResourceActivityChangedEvent,
  type SessionResourceActivitySnapshot,
} from "../../shared/resource-activity";
import { getSqlite } from "../database/client";

type RecordActivityInput = {
  activity: ResourceActivity;
  evidence: ResourceActivityEvidence;
  event: SessionResourceActivityChangedEvent | null;
};

const immutableActivityKeys = ["worktreeId", "runId", "resourceKind", "resourceId", "resourceVersion", "resourceDigest", "assignmentRevision", "assignmentGenerationId", "catalogGenerationId", "runtimeGenerationId", "provider", "providerVersion", "adapterContractVersion"] as const;

export type ResourceActivityOutboxRecord = {
  event: SessionResourceActivityChangedEvent;
  createdAt: Date;
};

type OutboxRow = { safeDeltaJson: string; createdAt: bigint };

export class ResourceActivityRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database = getSqlite()) {}

  pruneRetention(now: Date): { activities: number; coverage: number; outbox: number } {
    const thirtyDaysAgo=now.getTime()-30*24*60*60*1_000; const sevenDaysAgo=now.getTime()-7*24*60*60*1_000;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const activities=this.sqlite.prepare(`DELETE FROM resource_activity WHERE run_id IS NULL AND lifecycle='terminal' AND attribution IN ('unknown','conflict') AND last_observed_at<=?`).run(thirtyDaysAgo).changes;
      const coverage=this.sqlite.prepare("DELETE FROM resource_evidence_coverage WHERE resolved_at IS NOT NULL AND resolved_at<=?").run(thirtyDaysAgo).changes;
      const outbox=this.sqlite.prepare("DELETE FROM resource_activity_outbox WHERE published_at IS NOT NULL AND published_at<=?").run(sevenDaysAgo).changes;
      this.sqlite.exec("COMMIT"); return {activities,coverage,outbox};
    } catch(error){this.sqlite.exec("ROLLBACK");throw error;}
  }

  deleteWorktreeActivity(worktreeId: string): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.prepare("DELETE FROM resource_activity WHERE worktree_id=?").run(worktreeId);
      this.sqlite.prepare("DELETE FROM resource_activity_session_routes WHERE worktree_id=?").run(worktreeId);
      this.sqlite.prepare("DELETE FROM resource_evidence_coverage WHERE worktree_id=?").run(worktreeId);
      this.sqlite.exec("COMMIT");
    } catch(error){this.sqlite.exec("ROLLBACK");throw error;}
  }

  registerSessionRoute(input: ResourceActivitySessionRoute): void {
    const route = resourceActivitySessionRouteSchema.parse(input);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const lineage = this.sqlite.prepare(`SELECT 1 FROM runs r JOIN worktree_runtime_catalog_generations c ON c.id=?
        WHERE r.id=? AND r.worktree_id=? AND c.worktree_id=? AND c.agent_kind=? AND c.provider_version=? AND c.adapter_contract_version=? AND c.assignment_generation_id=?`).get(
        route.catalogGenerationId,route.runId,route.worktreeId,route.worktreeId,route.provider,route.providerVersion,route.adapterContractVersion,route.assignmentGenerationId,
      );
      if (!lineage) throw new Error("Activity session-route lineage mismatch.");
      this.sqlite.prepare(`INSERT INTO resource_activity_session_routes
        (route_key,run_id,worktree_id,provider,provider_version,adapter_contract_version,runtime_generation_id,assignment_generation_id,catalog_generation_id,registered_at,retired_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(route.routeKey,route.runId,route.worktreeId,route.provider,route.providerVersion,route.adapterContractVersion,route.runtimeGenerationId,route.assignmentGenerationId,route.catalogGenerationId,route.registeredAt.getTime(),route.retiredAt?.getTime() ?? null);
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  retireSessionRoute(routeKey: string, retiredAt: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare("UPDATE resource_activity_session_routes SET retired_at=? WHERE route_key=? AND retired_at IS NULL").run(retiredAt.getTime(),routeKey);
      if (result.changes !== 1) throw new Error("Activity session route is missing or already retired.");
      this.sqlite.exec("COMMIT");
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  recordCoverage(input: ResourceEvidenceCoverageRecord): "recorded" | "replayed" {
    const coverage = resourceEvidenceCoverageRecordSchema.parse(input);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.sqlite.prepare("SELECT id,worktree_id worktreeId,provider,provider_version providerVersion,runtime_generation_id runtimeGenerationId FROM resource_evidence_coverage WHERE kind=? AND source_event_key=?").get(coverage.kind,coverage.sourceEventKey) as { id:string;worktreeId:string;provider:string;providerVersion:string;runtimeGenerationId:string } | undefined;
      if (existing) {
        if (existing.id!==coverage.id || existing.worktreeId!==coverage.worktreeId || existing.provider!==coverage.provider || existing.providerVersion!==coverage.providerVersion || existing.runtimeGenerationId!==coverage.runtimeGenerationId) throw new Error("Conflicting evidence coverage replay.");
        this.sqlite.exec("COMMIT"); return "replayed";
      }
      this.sqlite.prepare(`INSERT INTO resource_evidence_coverage (id,worktree_id,provider,provider_version,adapter_contract_version,runtime_generation_id,assignment_generation_id,catalog_generation_id,kind,source_event_key,observed_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        coverage.id,coverage.worktreeId,coverage.provider,coverage.providerVersion,coverage.adapterContractVersion,coverage.runtimeGenerationId,coverage.assignmentGenerationId,coverage.catalogGenerationId,coverage.kind,coverage.sourceEventKey,coverage.observedAt.getTime(),coverage.resolvedAt?.getTime() ?? null,
      );
      this.sqlite.exec("COMMIT"); return "recorded";
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }

  getSnapshot(runId: string): SessionResourceActivitySnapshot {
    const sequence = this.getSequence(runId);
    const rows = this.sqlite.prepare(`SELECT id,resource_kind resourceKind,resource_id resourceId,resource_version resourceVersion,request_state requestState,use_state useState,lifecycle,outcome,mode,coverage,requested_at requestedAt,entered_or_loaded_at enteredAt,finished_at finishedAt,first_observed_at firstObservedAt FROM resource_activity WHERE run_id=? ORDER BY first_observed_at,id`).all(runId) as Array<Record<string, string | number | null>>;
    return sessionResourceActivitySnapshotSchema.parse({ runId, sequence, items: rows.map((row) => ({ id:row.id,resourceKind:row.resourceKind,resourceId:row.resourceId,resourceVersion:row.resourceVersion,requestState:row.requestState,useState:row.useState,lifecycle:row.lifecycle,outcome:row.outcome,mode:row.mode,coverage:row.coverage,occurredAt:new Date(Number(row.finishedAt ?? row.enteredAt ?? row.requestedAt ?? row.firstObservedAt)).toISOString() })) });
  }

  listPendingOutbox(limit = 100): ResourceActivityOutboxRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Invalid outbox limit.");
    const rows = this.sqlite.prepare(`SELECT safe_delta_json safeDeltaJson,created_at createdAt
      FROM resource_activity_outbox WHERE published_at IS NULL ORDER BY run_id,sequence LIMIT ?`).safeIntegers().all(limit) as OutboxRow[];
    return rows.map((row) => ({ event: sessionResourceActivityChangedEventSchema.parse(JSON.parse(row.safeDeltaJson)), createdAt: new Date(Number(row.createdAt)) }));
  }

  markOutboxPublished(eventId: string, publishedAt: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite.prepare("UPDATE resource_activity_outbox SET published_at=? WHERE event_id=? AND published_at IS NULL").run(publishedAt.getTime(), eventId);
      if (result.changes !== 1) throw new Error("Activity outbox event is missing or already published.");
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  recordActivity(input: RecordActivityInput): { kind: "recorded" | "replayed"; sequence: string | null } {
    const activity = resourceActivitySchema.parse(input.activity);
    const evidence = resourceActivityEvidenceSchema.parse(input.evidence);
    const event = input.event === null ? null : sessionResourceActivityChangedEventSchema.parse(input.event);
    if (evidence.activityId !== activity.id
      || (activity.runId === null) !== (event === null)
      || (event !== null && (event.runId !== activity.runId || event.change.type !== "upsert" || event.change.item.id !== activity.id))) {
      throw new Error("Activity transition lineage mismatch.");
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.sqlite.prepare(`SELECT id,activity_id activityId,correlation_key correlationKey,provider_contract providerContract
        FROM resource_activity_evidence WHERE boundary=? AND source_event_key=?`).get(evidence.boundary, evidence.sourceEventKey) as { id: string; activityId: string; correlationKey: string | null; providerContract: string } | undefined;
      if (replay) {
        if (replay.id !== evidence.id || replay.activityId !== evidence.activityId || replay.correlationKey !== evidence.correlationKey || replay.providerContract !== evidence.providerContract) throw new Error("Conflicting activity evidence replay.");
        const current = event === null ? null : this.getSequence(event.runId);
        this.sqlite.exec("COMMIT");
        return { kind: "replayed", sequence: current };
      }
      const existing = this.sqlite.prepare("SELECT * FROM resource_activity WHERE id=?").get(activity.id) as Record<string, unknown> | undefined;
      if (existing) {
        for (const key of immutableActivityKeys) {
          const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
          if (existing[column] !== activity[key]) throw new Error("Immutable activity lineage mismatch.");
        }
      }
      this.sqlite.prepare(`INSERT INTO resource_activity
        (id,worktree_id,run_id,resource_kind,resource_id,resource_version,resource_digest,assignment_revision,assignment_generation_id,catalog_generation_id,runtime_generation_id,provider,provider_version,adapter_contract_version,request_key,correlation_key,request_state,use_state,lifecycle,outcome,attribution,mode,routing_integrity,coverage,requested_at,entered_or_loaded_at,finished_at,first_observed_at,last_observed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET request_key=excluded.request_key,correlation_key=excluded.correlation_key,request_state=excluded.request_state,use_state=excluded.use_state,lifecycle=excluded.lifecycle,outcome=excluded.outcome,attribution=excluded.attribution,mode=excluded.mode,routing_integrity=excluded.routing_integrity,coverage=excluded.coverage,requested_at=excluded.requested_at,entered_or_loaded_at=excluded.entered_or_loaded_at,finished_at=excluded.finished_at,last_observed_at=excluded.last_observed_at`).run(
        activity.id,activity.worktreeId,activity.runId,activity.resourceKind,activity.resourceId,activity.resourceVersion,activity.resourceDigest,activity.assignmentRevision,activity.assignmentGenerationId,activity.catalogGenerationId,activity.runtimeGenerationId,activity.provider,activity.providerVersion,activity.adapterContractVersion,activity.requestKey,activity.correlationKey,activity.requestState,activity.useState,activity.lifecycle,activity.outcome,activity.attribution,activity.mode,activity.routingIntegrity,activity.coverage,activity.requestedAt?.getTime() ?? null,activity.enteredOrLoadedAt?.getTime() ?? null,activity.finishedAt?.getTime() ?? null,activity.firstObservedAt.getTime(),activity.lastObservedAt.getTime(),
      );
      this.sqlite.prepare(`INSERT INTO resource_activity_evidence (id,activity_id,boundary,source_event_key,correlation_key,provider_contract,observed_at) VALUES (?,?,?,?,?,?,?)`).run(evidence.id,evidence.activityId,evidence.boundary,evidence.sourceEventKey,evidence.correlationKey,evidence.providerContract,evidence.observedAt.getTime());
      let sequence: bigint | null = null;
      if (event !== null) {
        const prior = this.sqlite.prepare("SELECT sequence FROM resource_activity_streams WHERE run_id=?").safeIntegers().get(event.runId) as { sequence: bigint } | undefined;
        sequence = (prior?.sequence ?? 0n) + 1n;
        if (event.sequence !== sequence.toString()) throw new Error("Activity event sequence mismatch.");
        this.sqlite.prepare(`INSERT INTO resource_activity_streams (run_id,sequence) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET sequence=excluded.sequence`).run(event.runId, sequence);
        this.sqlite.prepare(`INSERT INTO resource_activity_outbox (event_id,run_id,sequence,schema_version,safe_delta_json,created_at) VALUES (?,?,?,1,?,?)`).run(event.eventId,event.runId,sequence,JSON.stringify(event),evidence.observedAt.getTime());
      }
      this.sqlite.exec("COMMIT");
      return { kind: "recorded", sequence: sequence?.toString() ?? null };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  private getSequence(runId: string): string {
    const row = this.sqlite.prepare("SELECT sequence FROM resource_activity_streams WHERE run_id=?").safeIntegers().get(runId) as { sequence: bigint } | undefined;
    return (row?.sequence ?? 0n).toString();
  }
}
