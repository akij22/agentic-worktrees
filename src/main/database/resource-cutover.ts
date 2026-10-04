import { createHash, createHmac } from "node:crypto";
import type Sqlite from "better-sqlite3";
import { resourceActivitySchema } from "../../shared/resource-activity";
import {
  AssignmentMigrator,
  type AssignmentMigrationCatalog,
} from "../assignments/assignment-migrator";
import { DatabaseAssignmentMigrationCatalog } from "../assignments/database-assignment-migration-catalog";
import { AssignmentCoordinatorStore } from "../assignments/assignment-coordinator-store";
import { projectWorktreeAssignment } from "../assignments/assignment-coordinator-projection";
import type { AssignmentAggregate } from "../../shared/assignments";

const migrationKey = "worktree-resource-release-v1";
interface LegacyRequest {
  id: string;
  runId: string;
  worktreeId: string;
  skillId: string;
  version: string;
  mode: string;
  requestedAt: number;
}
/** Switches authority only in the same transaction as baseline, legacy request import and write guards. */
export class ResourceCutover {
  constructor(
    private readonly sqlite: Sqlite.Database,
    private readonly catalog: AssignmentMigrationCatalog = new DatabaseAssignmentMigrationCatalog(
      sqlite,
    ),
    private readonly evidence?: { keyVersion: number; evidenceKey: Uint8Array },
  ) {}
  /** Commit a newly persisted Worktree and its empty Assignment as one unit. Existing Assignments are preserved. */
  writeWorktree<T>(worktreeId: string, operation: () => T): T {
    return this.sqlite
      .transaction(() => {
        const result = operation();
        const authoritative = this.sqlite
          .prepare(
            "SELECT 1 FROM worktree_assignment_migrations WHERE migration_key=? AND status='verified'",
          )
          .get(migrationKey);
        if (authoritative) {
          const store = new AssignmentCoordinatorStore(this.sqlite);
          if (!store.load(worktreeId)) {
            const generation = store.generation(worktreeId, []);
            const state: AssignmentAggregate = {
              worktreeId,
              revision: "0",
              projectionSequence: "0",
              phase: "stable",
              desiredGeneration: generation,
              verifiedGeneration: generation,
              participants: [],
              attempt: null,
              failure: null,
              updatedAt: new Date().toISOString(),
            };
            store.persist(state, projectWorktreeAssignment(state), null);
          }
        }
        return result;
      })
      .immediate();
  }
  run(): {
    authority: "assignment";
    worktreeCount: number;
    legacyRequestCount: number;
  } {
    const ready = this.sqlite
      .prepare(
        "SELECT 1 FROM worktree_assignment_migrations WHERE migration_key=? AND status='verified'",
      )
      .get(migrationKey);
    if (
      !ready &&
      this.sqlite.prepare("SELECT 1 FROM skill_invocations LIMIT 1").get() &&
      (!this.evidence ||
        this.evidence.evidenceKey.byteLength < 32 ||
        !Number.isSafeInteger(this.evidence.keyVersion) ||
        this.evidence.keyVersion < 1)
    )
      throw new Error("resource_evidence_key_unavailable");
    let completed = false;
    const finish = () => {
      this.importLegacyRequests();
      this.installWriteGuards();
      if ((this.sqlite.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("migration_constraint_invalid");
      const count = (
        this.sqlite
          .prepare("SELECT count(*) count FROM worktree_assignments")
          .get() as { count: number }
      ).count;
      const worktreeCount = (
        this.sqlite.prepare("SELECT count(*) count FROM worktrees").get() as {
          count: number;
        }
      ).count;
      if (count !== worktreeCount)
        throw new Error("migration_assignment_count_invalid");
      const resourceCount = (
        this.sqlite
          .prepare("SELECT count(*) count FROM resource_versions")
          .get() as { count: number }
      ).count;
      const generationCount = (
        this.sqlite
          .prepare("SELECT count(*) count FROM worktree_assignment_generations")
          .get() as { count: number }
      ).count;
      const baseline = this.sqlite
        .prepare(
          "SELECT source_fingerprint FROM worktree_assignment_migrations WHERE migration_key='worktree-resource-assignment-v1'",
        )
        .get();
      const requests = this.sqlite
        .prepare(
          "SELECT request_key,resource_id,resource_version,mode FROM resource_activity WHERE coverage='legacy_unverified' ORDER BY request_key",
        )
        .all();
      const fingerprint =
        "sha256:" +
        createHash("sha256")
          .update(
            JSON.stringify({
              baseline,
              requests,
              worktreeCount,
              resourceCount,
              generationCount,
            }),
          )
          .digest("hex");
      this.sqlite
        .prepare(
          `INSERT INTO worktree_assignment_migrations
        (migration_key,status,source_fingerprint,worktree_count,resource_version_count,generation_count,completed_at)
        VALUES (?,'verified',?,?,?,?,?)`,
        )
        .run(
          migrationKey,
          fingerprint,
          count,
          resourceCount,
          generationCount,
          Date.now(),
        );
      completed = true;
    };
    const result = new AssignmentMigrator(
      this.sqlite,
      this.catalog,
      undefined,
      ready ? undefined : finish,
    ).runInitialMigration();
    if (!ready && !completed) this.sqlite.transaction(finish).immediate();
    if (ready) this.sqlite.transaction(() => this.installWriteGuards()).immediate();
    return {
      authority: "assignment",
      worktreeCount: result.worktreeCount,
      legacyRequestCount: this.legacyRequestCount(),
    };
  }

  private legacyRequestCount(): number {
    return (
      this.sqlite
        .prepare(
          "SELECT count(*) count FROM resource_activity WHERE coverage='legacy_unverified'",
        )
        .get() as { count: number }
    ).count;
  }
  private importLegacyRequests(): void {
    const rows = this.sqlite
      .prepare(
        `SELECT si.id,si.run_id runId,r.worktree_id worktreeId,si.skill_id skillId,
      si.version,si.mode,si.requested_at requestedAt FROM skill_invocations si
      JOIN runs r ON r.id=si.run_id ORDER BY si.id`,
      )
      .all() as LegacyRequest[];
    for (const row of rows) {
      if (!this.evidence) throw new Error("resource_evidence_key_unavailable");
      const requestKey = `hmac:v${this.evidence.keyVersion}:${createHmac(
        "sha256",
        this.evidence.evidenceKey,
      )
        .update(
          JSON.stringify({ domain: "legacy-skill-request-v1", id: row.id }),
        )
        .digest("hex")}`;
      const requestedAt = new Date(row.requestedAt);
      const activity = resourceActivitySchema.parse({
        id: `legacy:${requestKey.split(":").at(-1)}`,
        worktreeId: row.worktreeId,
        runId: row.runId,
        resourceKind: "skill",
        resourceId: row.skillId,
        resourceVersion: row.version,
        resourceDigest: null,
        assignmentRevision: null,
        assignmentGenerationId: null,
        catalogGenerationId: null,
        runtimeGenerationId: null,
        provider: null,
        providerVersion: null,
        adapterContractVersion: null,
        requestKey,
        correlationKey: null,
        requestState: "requested",
        useState: "not_confirmed",
        lifecycle: "terminal",
        outcome: "not_observed",
        attribution: "exact",
        mode: row.mode,
        routingIntegrity: "unknown",
        coverage: "legacy_unverified",
        requestedAt,
        enteredOrLoadedAt: null,
        finishedAt: requestedAt,
        firstObservedAt: requestedAt,
        lastObservedAt: requestedAt,
      });
      const entries = Object.entries(activity);
      const columns = entries.map(([key]) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      );
      this.sqlite
        .prepare(
          `INSERT INTO resource_activity (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .run(
          ...entries.map(([, value]) =>
            value instanceof Date ? value.getTime() : value,
          ),
        );
    }
    if (this.legacyRequestCount() !== rows.length)
      throw new Error("migration_activity_count_invalid");
  }
  private installWriteGuards(): void {
    for (const table of [
      "session_capabilities",
      "worktree_capabilities",
      "skill_invocations",
    ] as const) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"] as const) {
        // Parent deletion may cascade history; ordinary legacy mutations must stop after cutover.
        const condition =
          operation === "DELETE"
            ? table === "worktree_capabilities"
              ? "AND EXISTS (SELECT 1 FROM worktrees WHERE id=OLD.worktree_id)"
              : "AND EXISTS (SELECT 1 FROM runs WHERE id=OLD.run_id)"
            : "";
        this.sqlite
          .exec(`CREATE TRIGGER IF NOT EXISTS ${table}_resource_read_only_${operation.toLowerCase()}
          BEFORE ${operation} ON ${table}
          WHEN EXISTS (SELECT 1 FROM worktree_assignment_migrations WHERE migration_key='${migrationKey}' AND status='verified') ${condition}
          BEGIN SELECT RAISE(ABORT,'legacy_resource_read_only'); END`);
      }
    }
  }
}
