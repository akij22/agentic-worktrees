import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import {
  reduceResourceActivity,
  resourceActivityObservationSchema,
  type ActivityLineage,
  type ResourceActivityObservation,
  type ResourceActivityLedger,
  type SessionResourceActivityItem,
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

const immutableActivityKeys = [
  "worktreeId",
  "runId",
  "resourceKind",
  "resourceId",
  "resourceVersion",
  "resourceDigest",
  "assignmentRevision",
  "assignmentGenerationId",
  "catalogGenerationId",
  "runtimeGenerationId",
  "provider",
  "providerVersion",
  "adapterContractVersion",
] as const;

export type ResourceActivityOutboxRecord = {
  event: SessionResourceActivityChangedEvent;
  createdAt: Date;
};

type OutboxRow = { safeDeltaJson: string; createdAt: bigint };

export class ResourceActivityRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database = getSqlite()) {}

  isAttested(lineage: ActivityLineage, historical = false): boolean {
    const row = this.sqlite
      .prepare(
        `SELECT 1 FROM worktree_runtime_assignment_attestations a
      JOIN worktree_runtime_catalog_generations c ON c.id=a.catalog_generation_id
      JOIN worktree_assignments w ON w.worktree_id=a.worktree_id
      WHERE a.worktree_id=? AND a.agent_kind=? AND a.runtime_generation=?
      AND a.assignment_generation_id=? AND a.catalog_generation_id=? AND a.provider_version=?
      AND c.worktree_id=a.worktree_id AND c.agent_kind=a.agent_kind
      AND c.assignment_generation_id=a.assignment_generation_id AND c.provider_version=a.provider_version
      AND c.adapter_contract_version=?
      AND (? OR (a.invalidated_at IS NULL AND w.phase IN ('stable','failed_rolled_back')
        AND w.verified_generation_id=a.assignment_generation_id AND CAST(w.revision AS TEXT)=?))`,
      )
      .get(
        lineage.worktreeId,
        lineage.provider,
        lineage.runtimeGenerationId,
        lineage.assignmentGenerationId,
        lineage.catalogGenerationId,
        lineage.providerVersion,
        lineage.adapterContractVersion,
        historical ? 1 : 0,
        lineage.assignmentRevision,
      );
    if (row || !historical) return Boolean(row);
    // An attestation can be superseded without restarting the process. An already recorded
    // activity is an immutable invocation-time anchor; it cannot authorize fresh host entry.
    return Boolean(
      this.sqlite
        .prepare(
          `SELECT 1 FROM resource_activity a
      JOIN worktree_runtime_catalog_generations c ON c.id=a.catalog_generation_id
      WHERE a.worktree_id=? AND a.provider=? AND a.runtime_generation_id=?
      AND a.assignment_generation_id=? AND a.catalog_generation_id=? AND a.assignment_revision=?
      AND a.provider_version=? AND a.adapter_contract_version=?
      AND c.worktree_id=a.worktree_id AND c.agent_kind=a.provider
      AND c.assignment_generation_id=a.assignment_generation_id AND c.provider_version=a.provider_version
      AND c.adapter_contract_version=a.adapter_contract_version LIMIT 1`,
        )
        .get(
          lineage.worktreeId,
          lineage.provider,
          lineage.runtimeGenerationId,
          lineage.assignmentGenerationId,
          lineage.catalogGenerationId,
          lineage.assignmentRevision,
          lineage.providerVersion,
          lineage.adapterContractVersion,
        ),
    );
  }

  containsResource(
    lineage: ActivityLineage,
    identity: ResourceActivityObservation["identity"],
  ): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          `SELECT 1 FROM worktree_assignment_generation_resources m
      JOIN resource_versions r ON r.id=m.resource_version_id
      WHERE m.generation_id=? AND r.resource_kind=? AND r.resource_id=? AND r.version=? AND r.content_digest=?`,
        )
        .get(
          lineage.assignmentGenerationId,
          identity.resourceKind,
          identity.resourceId,
          identity.resourceVersion,
          identity.resourceDigest,
        ),
    );
  }

  getCanonicalDigest(
    boundary: ResourceActivityEvidence["boundary"],
    sourceKey: string,
  ): string | null {
    const row = this.sqlite
      .prepare(
        "SELECT canonical_digest FROM resource_activity_evidence WHERE boundary=? AND source_event_key=?",
      )
      .get(boundary, sourceKey) as
      { canonical_digest: string | null } | undefined;
    return row?.canonical_digest ?? null;
  }

  hasEvidenceKey(
    kind: "source" | "request" | "correlation",
    key: string,
  ): boolean {
    const query =
      kind === "source"
        ? "SELECT 1 FROM resource_activity_evidence WHERE source_event_key=?"
        : `SELECT 1 FROM resource_activity WHERE ${kind}_key=?`;
    return Boolean(this.sqlite.prepare(query).get(key));
  }

  getSessionRoute(routeKey: string): ResourceActivitySessionRoute | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM resource_activity_session_routes WHERE route_key=?",
      )
      .get(routeKey);
    return row
      ? resourceActivitySessionRouteSchema.parse(decodeRow(row))
      : null;
  }

  /** Reduce evidence and all affected session deltas under SQLite write serialization. */
  applyObservation(
    raw: ResourceActivityObservation,
    canonicalDigest: string,
    providerOutcome?: ResourceActivity["outcome"],
  ) {
    const observation = resourceActivityObservationSchema.parse(raw);
    return this.sqlite
      .transaction(() => {
        const requestKey =
          "requestKey" in observation ? observation.requestKey : null;
        const correlationKey =
          "correlationKey" in observation ? observation.correlationKey : null;
        const rows = this.sqlite
          .prepare(
            `SELECT * FROM resource_activity WHERE request_key=? OR correlation_key=?
        OR id IN (SELECT activity_id FROM resource_activity_evidence WHERE source_event_key=?)`,
          )
          .all(requestKey, correlationKey, observation.sourceEventKey);
        const activities = rows.map((row) =>
          resourceActivitySchema.parse(decodeRow(row)),
        );
        const evidenceRows = activities.flatMap((activity) =>
          this.sqlite
            .prepare(
              "SELECT * FROM resource_activity_evidence WHERE activity_id=?",
            )
            .all(activity.id),
        );
        const evidence = evidenceRows.map((row) => {
          const decoded = decodeRow(row);
          delete decoded.canonicalDigest;
          return resourceActivityEvidenceSchema.parse(decoded);
        });
        const before: ResourceActivityLedger = { activities, evidence };
        let reduction = reduceResourceActivity(before, observation, {
          qualifiedLineage: [observation.lineage],
        });
        const prior = evidenceRows
          .map((row) => decodeRow(row))
          .find(
            (row) =>
              row.sourceEventKey === observation.sourceEventKey &&
              row.boundary === boundaryFor(observation),
          );
        if (prior && prior.canonicalDigest !== canonicalDigest) {
          reduction = {
            ledger: {
              ...before,
              activities: activities.map((activity) =>
                activity.id === prior.activityId
                  ? resourceActivitySchema.parse({
                      ...activity,
                      runId: null,
                      attribution: "conflict",
                      coverage: "conflict",
                    })
                  : activity,
              ),
            },
            disposition: "conflict",
            quarantine: true,
          };
        }
        if (
          observation.type === "provider_capability_receipt" &&
          providerOutcome
        ) {
          const host = activities.find(
            (activity) => activity.correlationKey === correlationKey,
          );
          if (host && host.lifecycle !== "terminal")
            return {
              ...reduction,
              disposition: "unmatched" as const,
              events: [],
            };
          if (
            host &&
            host.outcome !== providerOutcome &&
            reduction.disposition === "applied"
          ) {
            reduction = {
              ...reduction,
              disposition: "conflict",
              quarantine: true,
              ledger: {
                ...reduction.ledger,
                activities: reduction.ledger.activities.map((activity) =>
                  activity.correlationKey === correlationKey
                    ? { ...activity, coverage: "conflict" as const }
                    : activity,
                ),
              },
            };
          }
        }
        const frozen = activities.find(
          (activity) =>
            activity.attribution === "conflict" &&
            (activity.correlationKey === correlationKey ||
              activity.requestKey === requestKey),
        );
        if (frozen)
          reduction = {
            ledger: before,
            disposition: "conflict",
            quarantine: true,
          };
        if (reduction.disposition === "conflict" && !prior) {
          const conflicted = reduction.ledger.activities.find(
            (activity) => activity.attribution === "conflict",
          );
          if (conflicted)
            reduction.ledger.evidence.push({
              id: observation.evidenceId,
              activityId: conflicted.id,
              boundary: boundaryFor(observation),
              sourceEventKey: observation.sourceEventKey,
              correlationKey,
              providerContract: observation.providerContract,
              observedAt: observation.observedAt,
            });
        }
        if (
          reduction.disposition === "duplicate" ||
          reduction.disposition === "unmatched"
        )
          return { ...reduction, events: [] };
        // A late receipt promotes the original Requested item in place.
        if (
          (observation.type === "provider_capability_receipt" ||
            observation.type === "skill_context_receipt") &&
          requestKey
        ) {
          const request = activities.find(
            (activity) => activity.requestKey === requestKey,
          );
          const paired = reduction.ledger.activities.find(
            (activity) => activity.correlationKey === correlationKey,
          );
          if (
            request &&
            paired &&
            request.id !== paired.id &&
            paired.attribution === "exact"
          ) {
            reduction.ledger = {
              activities: reduction.ledger.activities.map((activity) =>
                activity.id === paired.id
                  ? { ...activity, id: request.id }
                  : activity,
              ),
              evidence: reduction.ledger.evidence.map((event) =>
                event.activityId === paired.id
                  ? { ...event, activityId: request.id }
                  : event,
              ),
            };
          }
        }
        const after = reduction.ledger;
        const events: SessionResourceActivityChangedEvent[] = [];
        const runs = new Set(
          [...before.activities, ...after.activities].flatMap((activity) =>
            activity.runId ? [activity.runId] : [],
          ),
        );
        for (const runId of runs) {
          const oldItems = before.activities
            .filter((activity) => activity.runId === runId)
            .map(projectItem);
          const newItems = after.activities
            .filter((activity) => activity.runId === runId)
            .map(projectItem);
          const changes: SessionResourceActivityChangedEvent["change"][] = [];
          for (const item of oldItems)
            if (!newItems.some((next) => next.id === item.id))
              changes.push({ type: "remove", activityId: item.id });
          for (const item of newItems)
            if (
              !oldItems.some(
                (old) => JSON.stringify(old) === JSON.stringify(item),
              )
            )
              changes.push({ type: "upsert", item });
          for (const change of changes) {
            const sequence = (BigInt(this.getSequence(runId)) + 1n).toString();
            const event = sessionResourceActivityChangedEventSchema.parse({
              eventId: randomUUID(),
              runId,
              sequence,
              change,
            });
            this.sqlite
              .prepare(
                `INSERT INTO resource_activity_streams (run_id,sequence) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET sequence=excluded.sequence`,
              )
              .run(runId, BigInt(sequence));
            this.sqlite
              .prepare(
                "INSERT INTO resource_activity_outbox (event_id,run_id,sequence,schema_version,safe_delta_json,created_at) VALUES (?,?,?,1,?,?)",
              )
              .run(
                event.eventId,
                runId,
                BigInt(sequence),
                JSON.stringify(event),
                observation.observedAt.getTime(),
              );
            events.push(event);
          }
        }
        // Remove redundant rows first; preserve moved evidence and unique correlation keys.
        const fingerprints = new Map(
          evidenceRows.map((row) => {
            const value = decodeRow(row);
            return [value.id, value.canonicalDigest];
          }),
        );
        for (const activity of before.activities)
          this.sqlite
            .prepare("DELETE FROM resource_activity WHERE id=?")
            .run(activity.id);
        for (const activity of after.activities)
          insertObject(this.sqlite, "resource_activity", activity);
        for (const event of after.evidence)
          insertObject(this.sqlite, "resource_activity_evidence", {
            ...event,
            canonicalDigest: fingerprints.get(event.id) ?? canonicalDigest,
          });
        return { ...reduction, events };
      })
      .immediate();
  }

  retireRuntime(
    lineage: ActivityLineage,
    now: Date,
  ): SessionResourceActivityChangedEvent[] {
    return this.sqlite
      .transaction(() => {
        const retired = this.sqlite
          .prepare(
            "SELECT invalidated_at FROM worktree_runtime_assignment_attestations WHERE worktree_id=? AND agent_kind=? AND runtime_generation=? AND invalidated_at IS NOT NULL",
          )
          .get(
            lineage.worktreeId,
            lineage.provider,
            lineage.runtimeGenerationId,
          );
        if (!retired)
          throw new Error("Activity runtime is still active or unknown.");
        const rows = this.sqlite
          .prepare(
            "SELECT * FROM resource_activity WHERE worktree_id=? AND provider=? AND runtime_generation_id=? AND lifecycle='open'",
          )
          .all(
            lineage.worktreeId,
            lineage.provider,
            lineage.runtimeGenerationId,
          );
        const events: SessionResourceActivityChangedEvent[] = [];
        for (const row of rows) {
          const prior = resourceActivitySchema.parse(decodeRow(row));
          if (prior.attribution === "conflict") continue;
          const activity = resourceActivitySchema.parse({
            ...prior,
            lifecycle: "terminal",
            outcome: "not_observed",
            coverage: "evidence_gap",
            finishedAt: now,
            lastObservedAt: now,
          });
          this.sqlite
            .prepare(
              "UPDATE resource_activity SET lifecycle='terminal',outcome='not_observed',coverage='evidence_gap',finished_at=?,last_observed_at=? WHERE id=?",
            )
            .run(now.getTime(), now.getTime(), activity.id);
          if (activity.runId) {
            const sequence = (
              BigInt(this.getSequence(activity.runId)) + 1n
            ).toString();
            const event = sessionResourceActivityChangedEventSchema.parse({
              eventId: randomUUID(),
              runId: activity.runId,
              sequence,
              change: { type: "upsert", item: projectItem(activity) },
            });
            this.sqlite
              .prepare(
                "INSERT INTO resource_activity_streams (run_id,sequence) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET sequence=excluded.sequence",
              )
              .run(activity.runId, BigInt(sequence));
            this.sqlite
              .prepare(
                "INSERT INTO resource_activity_outbox (event_id,run_id,sequence,schema_version,safe_delta_json,created_at) VALUES (?,?,?,1,?,?)",
              )
              .run(
                event.eventId,
                event.runId,
                BigInt(sequence),
                JSON.stringify(event),
                now.getTime(),
              );
            events.push(event);
          }
        }
        this.sqlite
          .prepare(
            "UPDATE resource_activity_session_routes SET retired_at=COALESCE(retired_at,?) WHERE worktree_id=? AND provider=? AND runtime_generation_id=?",
          )
          .run(
            now.getTime(),
            lineage.worktreeId,
            lineage.provider,
            lineage.runtimeGenerationId,
          );
        return events;
      })
      .immediate();
  }

  resolveCoverage(lineage: ActivityLineage, now: Date): void {
    this.sqlite
      .prepare(
        "UPDATE resource_evidence_coverage SET resolved_at=COALESCE(resolved_at,?) WHERE worktree_id=? AND provider=? AND provider_version=? AND runtime_generation_id=?",
      )
      .run(
        now.getTime(),
        lineage.worktreeId,
        lineage.provider,
        lineage.providerVersion,
        lineage.runtimeGenerationId,
      );
  }

  pruneRetention(now: Date): {
    activities: number;
    coverage: number;
    outbox: number;
  } {
    const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1_000;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const activities = this.sqlite
        .prepare(
          `DELETE FROM resource_activity WHERE run_id IS NULL AND lifecycle='terminal' AND attribution IN ('unknown','conflict') AND last_observed_at<=?`,
        )
        .run(thirtyDaysAgo).changes;
      const coverage = this.sqlite
        .prepare(
          `DELETE FROM resource_evidence_coverage AS e WHERE
        COALESCE((SELECT CASE WHEN e.resolved_at IS NULL THEN a.invalidated_at ELSE MAX(e.resolved_at,a.invalidated_at) END
          FROM worktree_runtime_assignment_attestations a WHERE a.worktree_id=e.worktree_id AND a.agent_kind=e.provider AND a.runtime_generation=e.runtime_generation_id AND a.invalidated_at IS NOT NULL),e.resolved_at)<=?`,
        )
        .run(thirtyDaysAgo).changes;
      const outbox = this.sqlite
        .prepare(
          "DELETE FROM resource_activity_outbox WHERE published_at IS NOT NULL AND published_at<=?",
        )
        .run(sevenDaysAgo).changes;
      this.sqlite.exec("COMMIT");
      return { activities, coverage, outbox };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  deleteWorktreeActivity(worktreeId: string): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare("DELETE FROM resource_activity WHERE worktree_id=?")
        .run(worktreeId);
      this.sqlite
        .prepare(
          "DELETE FROM resource_activity_session_routes WHERE worktree_id=?",
        )
        .run(worktreeId);
      this.sqlite
        .prepare("DELETE FROM resource_evidence_coverage WHERE worktree_id=?")
        .run(worktreeId);
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  registerSessionRoute(input: ResourceActivitySessionRoute): void {
    const route = resourceActivitySessionRouteSchema.parse(input);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const lineage = this.sqlite
        .prepare(
          `SELECT 1 FROM runs r JOIN worktree_runtime_catalog_generations c ON c.id=?
        WHERE r.id=? AND r.worktree_id=? AND c.worktree_id=? AND c.agent_kind=? AND c.provider_version=? AND c.adapter_contract_version=? AND c.assignment_generation_id=?`,
        )
        .get(
          route.catalogGenerationId,
          route.runId,
          route.worktreeId,
          route.worktreeId,
          route.provider,
          route.providerVersion,
          route.adapterContractVersion,
          route.assignmentGenerationId,
        );
      if (!lineage) throw new Error("Activity session-route lineage mismatch.");
      this.sqlite
        .prepare(
          `INSERT INTO resource_activity_session_routes
        (route_key,run_id,worktree_id,provider,provider_version,adapter_contract_version,runtime_generation_id,assignment_generation_id,catalog_generation_id,registered_at,retired_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          route.routeKey,
          route.runId,
          route.worktreeId,
          route.provider,
          route.providerVersion,
          route.adapterContractVersion,
          route.runtimeGenerationId,
          route.assignmentGenerationId,
          route.catalogGenerationId,
          route.registeredAt.getTime(),
          route.retiredAt?.getTime() ?? null,
        );
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  retireSessionRoute(routeKey: string, retiredAt: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite
        .prepare(
          "UPDATE resource_activity_session_routes SET retired_at=? WHERE route_key=? AND retired_at IS NULL",
        )
        .run(retiredAt.getTime(), routeKey);
      if (result.changes !== 1)
        throw new Error(
          "Activity session route is missing or already retired.",
        );
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  recordCoverage(
    input: ResourceEvidenceCoverageRecord,
  ): "recorded" | "replayed" {
    const coverage = resourceEvidenceCoverageRecordSchema.parse(input);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.sqlite
        .prepare(
          "SELECT id,worktree_id worktreeId,provider,provider_version providerVersion,runtime_generation_id runtimeGenerationId FROM resource_evidence_coverage WHERE kind=? AND source_event_key=?",
        )
        .get(coverage.kind, coverage.sourceEventKey) as
        | {
            id: string;
            worktreeId: string;
            provider: string;
            providerVersion: string;
            runtimeGenerationId: string;
          }
        | undefined;
      if (existing) {
        if (
          existing.id !== coverage.id ||
          existing.worktreeId !== coverage.worktreeId ||
          existing.provider !== coverage.provider ||
          existing.providerVersion !== coverage.providerVersion ||
          existing.runtimeGenerationId !== coverage.runtimeGenerationId
        )
          throw new Error("Conflicting evidence coverage replay.");
        this.sqlite.exec("COMMIT");
        return "replayed";
      }
      this.sqlite
        .prepare(
          `INSERT INTO resource_evidence_coverage (id,worktree_id,provider,provider_version,adapter_contract_version,runtime_generation_id,assignment_generation_id,catalog_generation_id,kind,source_event_key,observed_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          coverage.id,
          coverage.worktreeId,
          coverage.provider,
          coverage.providerVersion,
          coverage.adapterContractVersion,
          coverage.runtimeGenerationId,
          coverage.assignmentGenerationId,
          coverage.catalogGenerationId,
          coverage.kind,
          coverage.sourceEventKey,
          coverage.observedAt.getTime(),
          coverage.resolvedAt?.getTime() ?? null,
        );
      this.sqlite.exec("COMMIT");
      return "recorded";
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  getSnapshot(runId: string): SessionResourceActivitySnapshot {
    const sequence = this.getSequence(runId);
    const rows = this.sqlite
      .prepare(
        "SELECT * FROM resource_activity WHERE run_id=? AND attribution='exact' ORDER BY COALESCE(entered_or_loaded_at,requested_at,first_observed_at),id",
      )
      .all(runId);
    return sessionResourceActivitySnapshotSchema.parse({
      runId,
      sequence,
      items: rows.map((row) =>
        projectItem(resourceActivitySchema.parse(decodeRow(row))),
      ),
    });
  }

  listPendingOutbox(limit = 100): ResourceActivityOutboxRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error("Invalid outbox limit.");
    const rows = this.sqlite
      .prepare(
        `SELECT safe_delta_json safeDeltaJson,created_at createdAt
      FROM resource_activity_outbox WHERE published_at IS NULL ORDER BY run_id,sequence LIMIT ?`,
      )
      .safeIntegers()
      .all(limit) as OutboxRow[];
    return rows.map((row) => ({
      event: sessionResourceActivityChangedEventSchema.parse(
        JSON.parse(row.safeDeltaJson),
      ),
      createdAt: new Date(Number(row.createdAt)),
    }));
  }

  markOutboxPublished(eventId: string, publishedAt: Date): void {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = this.sqlite
        .prepare(
          "UPDATE resource_activity_outbox SET published_at=? WHERE event_id=? AND published_at IS NULL",
        )
        .run(publishedAt.getTime(), eventId);
      if (result.changes !== 1)
        throw new Error(
          "Activity outbox event is missing or already published.",
        );
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  recordActivity(input: RecordActivityInput): {
    kind: "recorded" | "replayed";
    sequence: string | null;
  } {
    const activity = resourceActivitySchema.parse(input.activity);
    const evidence = resourceActivityEvidenceSchema.parse(input.evidence);
    const event =
      input.event === null
        ? null
        : sessionResourceActivityChangedEventSchema.parse(input.event);
    if (
      evidence.activityId !== activity.id ||
      (activity.runId === null) !== (event === null) ||
      (event !== null &&
        (event.runId !== activity.runId ||
          event.change.type !== "upsert" ||
          event.change.item.id !== activity.id))
    ) {
      throw new Error("Activity transition lineage mismatch.");
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.sqlite
        .prepare(
          `SELECT id,activity_id activityId,correlation_key correlationKey,provider_contract providerContract
        FROM resource_activity_evidence WHERE boundary=? AND source_event_key=?`,
        )
        .get(evidence.boundary, evidence.sourceEventKey) as
        | {
            id: string;
            activityId: string;
            correlationKey: string | null;
            providerContract: string;
          }
        | undefined;
      if (replay) {
        if (
          replay.id !== evidence.id ||
          replay.activityId !== evidence.activityId ||
          replay.correlationKey !== evidence.correlationKey ||
          replay.providerContract !== evidence.providerContract
        )
          throw new Error("Conflicting activity evidence replay.");
        const current = event === null ? null : this.getSequence(event.runId);
        this.sqlite.exec("COMMIT");
        return { kind: "replayed", sequence: current };
      }
      const existing = this.sqlite
        .prepare("SELECT * FROM resource_activity WHERE id=?")
        .get(activity.id) as Record<string, unknown> | undefined;
      if (existing) {
        for (const key of immutableActivityKeys) {
          const column = key.replace(
            /[A-Z]/g,
            (letter) => `_${letter.toLowerCase()}`,
          );
          if (existing[column] !== activity[key])
            throw new Error("Immutable activity lineage mismatch.");
        }
      }
      this.sqlite
        .prepare(
          `INSERT INTO resource_activity
        (id,worktree_id,run_id,resource_kind,resource_id,resource_version,resource_digest,assignment_revision,assignment_generation_id,catalog_generation_id,runtime_generation_id,provider,provider_version,adapter_contract_version,request_key,correlation_key,request_state,use_state,lifecycle,outcome,attribution,mode,routing_integrity,coverage,requested_at,entered_or_loaded_at,finished_at,first_observed_at,last_observed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET request_key=excluded.request_key,correlation_key=excluded.correlation_key,request_state=excluded.request_state,use_state=excluded.use_state,lifecycle=excluded.lifecycle,outcome=excluded.outcome,attribution=excluded.attribution,mode=excluded.mode,routing_integrity=excluded.routing_integrity,coverage=excluded.coverage,requested_at=excluded.requested_at,entered_or_loaded_at=excluded.entered_or_loaded_at,finished_at=excluded.finished_at,last_observed_at=excluded.last_observed_at`,
        )
        .run(
          activity.id,
          activity.worktreeId,
          activity.runId,
          activity.resourceKind,
          activity.resourceId,
          activity.resourceVersion,
          activity.resourceDigest,
          activity.assignmentRevision,
          activity.assignmentGenerationId,
          activity.catalogGenerationId,
          activity.runtimeGenerationId,
          activity.provider,
          activity.providerVersion,
          activity.adapterContractVersion,
          activity.requestKey,
          activity.correlationKey,
          activity.requestState,
          activity.useState,
          activity.lifecycle,
          activity.outcome,
          activity.attribution,
          activity.mode,
          activity.routingIntegrity,
          activity.coverage,
          activity.requestedAt?.getTime() ?? null,
          activity.enteredOrLoadedAt?.getTime() ?? null,
          activity.finishedAt?.getTime() ?? null,
          activity.firstObservedAt.getTime(),
          activity.lastObservedAt.getTime(),
        );
      this.sqlite
        .prepare(
          `INSERT INTO resource_activity_evidence (id,activity_id,boundary,source_event_key,correlation_key,provider_contract,observed_at) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          evidence.id,
          evidence.activityId,
          evidence.boundary,
          evidence.sourceEventKey,
          evidence.correlationKey,
          evidence.providerContract,
          evidence.observedAt.getTime(),
        );
      let sequence: bigint | null = null;
      if (event !== null) {
        const prior = this.sqlite
          .prepare(
            "SELECT sequence FROM resource_activity_streams WHERE run_id=?",
          )
          .safeIntegers()
          .get(event.runId) as { sequence: bigint } | undefined;
        sequence = (prior?.sequence ?? 0n) + 1n;
        if (event.sequence !== sequence.toString())
          throw new Error("Activity event sequence mismatch.");
        this.sqlite
          .prepare(
            `INSERT INTO resource_activity_streams (run_id,sequence) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET sequence=excluded.sequence`,
          )
          .run(event.runId, sequence);
        this.sqlite
          .prepare(
            `INSERT INTO resource_activity_outbox (event_id,run_id,sequence,schema_version,safe_delta_json,created_at) VALUES (?,?,?,1,?,?)`,
          )
          .run(
            event.eventId,
            event.runId,
            sequence,
            JSON.stringify(event),
            evidence.observedAt.getTime(),
          );
      }
      this.sqlite.exec("COMMIT");
      return { kind: "recorded", sequence: sequence?.toString() ?? null };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  private getSequence(runId: string): string {
    const row = this.sqlite
      .prepare("SELECT sequence FROM resource_activity_streams WHERE run_id=?")
      .safeIntegers()
      .get(runId) as { sequence: bigint } | undefined;
    return (row?.sequence ?? 0n).toString();
  }
}

function decodeRow(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid activity row.");
  return Object.fromEntries(
    Object.entries(raw).map(([column, value]) => {
      const key = column.replace(/_([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      );
      return [
        key,
        key.endsWith("At") && value !== null ? new Date(Number(value)) : value,
      ];
    }),
  );
}
function insertObject(
  sqlite: BetterSqlite3.Database,
  table: "resource_activity" | "resource_activity_evidence",
  value: object,
) {
  const entries = Object.entries(value);
  const columns = entries.map(([key]) =>
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
  );
  sqlite
    .prepare(
      `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .run(
      ...entries.map(([, item]) =>
        item instanceof Date ? item.getTime() : item,
      ),
    );
}
function projectItem(activity: ResourceActivity): SessionResourceActivityItem {
  return {
    id: activity.id,
    resourceKind: activity.resourceKind,
    resourceId: activity.resourceId,
    resourceVersion: activity.resourceVersion,
    requestState: activity.requestState,
    useState: activity.useState,
    lifecycle: activity.lifecycle,
    outcome: activity.outcome,
    mode: activity.mode,
    coverage: activity.coverage,
    occurredAt: (
      activity.enteredOrLoadedAt ??
      activity.requestedAt ??
      activity.firstObservedAt
    ).toISOString(),
  };
}
function boundaryFor(
  observation: ResourceActivityObservation,
): ResourceActivityEvidence["boundary"] {
  switch (observation.type) {
    case "application_request":
      return "application.request";
    case "provider_request":
      return "provider.request";
    case "capability_host_entered":
      return "capability_host.entered";
    case "capability_host_outcome":
      return "capability_host.outcome";
    case "provider_capability_receipt":
      return "provider.capability_receipt";
    case "skill_context_receipt":
      return "provider.skill_context_receipt";
    case "pre_entry_outcome":
      return "provider.outcome";
  }
}
