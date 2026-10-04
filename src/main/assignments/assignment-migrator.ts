import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { assignmentProjectionSchema } from "../../shared/assignments";
import { getSqlite } from "../database/client";

const migrationKey = "worktree-resource-assignment-v1";
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

type MigrationResult = { kind: "migrated" | "already_verified"; worktreeCount: number; generationCount: number; resourceVersionCount: number };

type WorktreeRow = { id: string };
type JournalRow = { status: string; sourceFingerprint: string; worktreeCount: number; generationCount: number; resourceVersionCount: number };
type ResourceKind = "capability" | "skill";
type ResourceRef = { resourceKind: ResourceKind; resourceId: string; version: string };
export type CanonicalMigrationResource = ResourceRef & {
  name: string;
  description: string;
  contentDigest: string;
  securityDigest: string;
  permissionDigest?: string;
  configurationDigest: string;
  invocationPolicyDigest: string;
  providers: Array<{ agentKind: "codex" | "opencode"; availability: "compatible" | "unavailable"; skillIsolation: "enforced" | "not_enforced" | "not_applicable"; qualificationDigest: string; expectedStateDigest: string }>;
};
export interface AssignmentMigrationCatalog { resolve(resource: ResourceRef): CanonicalMigrationResource | undefined }

export class AssignmentMigrator {
  constructor(
    private readonly sqlite: BetterSqlite3.Database = getSqlite(),
    private readonly catalog?: AssignmentMigrationCatalog,
    private readonly onJournalApplied?: () => void,
    private readonly beforeVerified?: () => void,
  ) {}

  runInitialMigration(now = new Date()): MigrationResult {
    const existing = this.sqlite.prepare(`SELECT status,source_fingerprint sourceFingerprint,worktree_count worktreeCount,
      generation_count generationCount,resource_version_count resourceVersionCount FROM worktree_assignment_migrations WHERE migration_key=?`).get(migrationKey) as JournalRow | undefined;
    if (existing?.status === "verified") return { kind: "already_verified", worktreeCount: existing.worktreeCount, generationCount: existing.generationCount, resourceVersionCount: existing.resourceVersionCount };

    const worktrees = this.sqlite.prepare("SELECT id FROM worktrees ORDER BY id").all() as WorktreeRow[];
    const transitional = this.sqlite.prepare("SELECT count(*) count FROM session_capabilities WHERE status IN ('pending_activation','reloading','pending_deactivation')").get() as { count: number };
    const activeRows = this.sqlite.prepare(`SELECT sc.capability_id capabilityId,sc.version,r.worktree_id worktreeId
      FROM session_capabilities sc JOIN runs r ON r.id=sc.run_id WHERE sc.status='active' ORDER BY r.worktree_id,sc.capability_id,sc.version`).all() as Array<{ capabilityId: string; version: string; worktreeId: string }>;
    const skills = this.sqlite.prepare(`SELECT skill_id skillId,version,content_digest contentDigest,codex_compatibility codexCompatibility,opencode_compatibility opencodeCompatibility
      FROM skill_installations WHERE state IN ('installed','update_available') ORDER BY skill_id`).all() as Array<{ skillId: string; version: string; contentDigest: string; codexCompatibility: string; opencodeCompatibility: string }>;
    const sourceFingerprint = digest({ worktrees, capabilities: activeRows, skills });
    const brokenReference = this.sqlite.prepare(`SELECT 1 FROM session_capabilities sc
      LEFT JOIN runs r ON r.id=sc.run_id LEFT JOIN worktrees w ON w.id=r.worktree_id
      WHERE r.id IS NULL OR w.id IS NULL
      UNION ALL SELECT 1 FROM skill_invocations si
      LEFT JOIN runs r ON r.id=si.run_id LEFT JOIN worktrees w ON w.id=r.worktree_id
      WHERE r.id IS NULL OR w.id IS NULL LIMIT 1`).get();
    if (brokenReference) this.failPreflight(sourceFingerprint, worktrees.length, "migration_reference_invalid", now);
    if (transitional.count !== 0) this.failPreflight(sourceFingerprint, worktrees.length, "migration_capability_transitional", now);
    const brokenInstallation = this.sqlite.prepare(`SELECT count(*) count FROM session_capabilities sc
      LEFT JOIN capability_installations ci ON ci.capability_id=sc.capability_id
      WHERE sc.status='active' AND (ci.capability_id IS NULL OR ci.configured<>1 OR ci.version<>sc.version OR length(ci.permission_digest)=0)`).get() as { count: number };
    if (brokenInstallation.count !== 0) this.failPreflight(sourceFingerprint, worktrees.length, "migration_capability_installation_mismatch", now);
    const conflictingVersion = this.sqlite.prepare(`SELECT 1 FROM session_capabilities sc JOIN runs r ON r.id=sc.run_id
      WHERE sc.status='active' GROUP BY r.worktree_id,sc.capability_id HAVING count(DISTINCT sc.version)>1 LIMIT 1`).get();
    if (conflictingVersion) this.failPreflight(sourceFingerprint, worktrees.length, "migration_capability_version_conflict", now);
    const validCompatibility = new Set(["supported", "unsupported"]);
    if (skills.some((skill) => !/^sha256:[a-f0-9]{64}$/.test(skill.contentDigest) || !validCompatibility.has(skill.codexCompatibility) || !validCompatibility.has(skill.opencodeCompatibility))) {
      this.failPreflight(sourceFingerprint, worktrees.length, "migration_skill_metadata_invalid", now);
    }
    const refsByWorktree = new Map(worktrees.map(({ id }) => [id, [] as ResourceRef[]]));
    for (const row of activeRows) {
      const refs = refsByWorktree.get(row.worktreeId);
      if (refs && !refs.some((ref) => ref.resourceKind === "capability" && ref.resourceId === row.capabilityId && ref.version === row.version)) refs.push({ resourceKind: "capability", resourceId: row.capabilityId, version: row.version });
    }
    for (const skill of skills) for (const worktree of worktrees) refsByWorktree.get(worktree.id)?.push({ resourceKind: "skill", resourceId: skill.skillId, version: skill.version });
    const descriptors = new Map<string, CanonicalMigrationResource>();
    for (const refs of refsByWorktree.values()) for (const ref of refs) {
      const key = `${ref.resourceKind}:${ref.resourceId}:${ref.version}`;
      if (descriptors.has(key)) continue;
      const descriptor = this.catalog?.resolve(ref);
      if (!descriptor || descriptor.resourceKind !== ref.resourceKind || descriptor.resourceId !== ref.resourceId || descriptor.version !== ref.version) this.failPreflight(sourceFingerprint, worktrees.length, "migration_resource_descriptor_missing", now);
      const digestValues = [descriptor.contentDigest, descriptor.securityDigest, descriptor.configurationDigest, descriptor.invocationPolicyDigest, ...descriptor.providers.flatMap((provider) => [provider.qualificationDigest, provider.expectedStateDigest])];
      if (descriptor.permissionDigest !== undefined && !/^(?:sha256:)?[a-f0-9]{64}$/.test(descriptor.permissionDigest)) this.failPreflight(sourceFingerprint, worktrees.length, "migration_resource_descriptor_invalid", now);
      if (!digestValues.every((value) => /^sha256:[a-f0-9]{64}$/.test(value))) this.failPreflight(sourceFingerprint, worktrees.length, "migration_resource_descriptor_invalid", now);
      const skill = skills.find((candidate) => ref.resourceKind === "skill" && candidate.skillId === ref.resourceId && candidate.version === ref.version);
      if (skill && skill.contentDigest !== descriptor.contentDigest) this.failPreflight(sourceFingerprint, worktrees.length, "migration_skill_digest_mismatch", now);
      if (ref.resourceKind === "capability") {
        const installation = this.sqlite.prepare("SELECT permission_digest permissionDigest FROM capability_installations WHERE capability_id=? AND version=? AND configured=1").get(ref.resourceId, ref.version) as { permissionDigest: string } | undefined;
        if (!installation || descriptor.permissionDigest !== installation.permissionDigest) this.failPreflight(sourceFingerprint, worktrees.length, "migration_capability_permission_mismatch", now);
      }
      descriptors.set(key, descriptor);
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.prepare(`INSERT INTO worktree_assignment_migrations
        (migration_key,status,source_fingerprint,worktree_count,resource_version_count,generation_count,started_at)
        VALUES (?,'applying',?,?,?,?,?)
        ON CONFLICT(migration_key) DO UPDATE SET status='applying',source_fingerprint=excluded.source_fingerprint,worktree_count=excluded.worktree_count,resource_version_count=excluded.resource_version_count,generation_count=excluded.generation_count,failure_code=NULL,started_at=excluded.started_at,completed_at=NULL`).run(migrationKey, sourceFingerprint, worktrees.length, descriptors.size, worktrees.length, now.getTime());
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }

    this.onJournalApplied?.();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const currentWorktrees = this.sqlite.prepare("SELECT id FROM worktrees ORDER BY id").all() as WorktreeRow[];
      const currentCapabilities = this.sqlite.prepare(`SELECT sc.capability_id capabilityId,sc.version,r.worktree_id worktreeId FROM session_capabilities sc JOIN runs r ON r.id=sc.run_id WHERE sc.status='active' ORDER BY r.worktree_id,sc.capability_id,sc.version`).all();
      const currentSkills = this.sqlite.prepare(`SELECT skill_id skillId,version,content_digest contentDigest,codex_compatibility codexCompatibility,opencode_compatibility opencodeCompatibility FROM skill_installations WHERE state IN ('installed','update_available') ORDER BY skill_id`).all();
      if (digest({ worktrees: currentWorktrees, capabilities: currentCapabilities, skills: currentSkills }) !== sourceFingerprint) throw new Error("Assignment migration source changed after preflight.");
      const insertVersion = this.sqlite.prepare(`INSERT INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES (?,?,?,?,?,?,?)`);
      const versionIds = new Map<string, string>();
      for (const [key, descriptor] of descriptors) {
        const versionId = `rv:${digest(descriptor).slice(7)}`;
        insertVersion.run(versionId, descriptor.resourceKind, descriptor.resourceId, descriptor.version, descriptor.contentDigest, descriptor.securityDigest, now.getTime());
        versionIds.set(key, versionId);
      }
      const insertGeneration = this.sqlite.prepare(`INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,migration_key,created_at) VALUES (?,?,0,?,?,?)`);
      const insertMember = this.sqlite.prepare(`INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES (?,?,?,?,?)`);
      const insertProvider = this.sqlite.prepare(`INSERT INTO worktree_assignment_generation_resource_providers (generation_resource_id,agent_kind,availability,skill_isolation,qualification_digest,expected_state_digest) VALUES (?,?,?,?,?,?)`);
      const insertAssignment = this.sqlite.prepare(`INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES (?,0,0,'stable',?,?,?,?)`);
      const insertOutbox = this.sqlite.prepare(`INSERT INTO worktree_assignment_outbox (event_id,worktree_id,revision,projection_sequence,event_type,schema_version,safe_payload_json,created_at) VALUES (?,?,0,0,'assignment.migrated',1,?,?)`);
      for (const worktree of worktrees) {
        const refs = [...(refsByWorktree.get(worktree.id) ?? [])].sort((a, b) => `${a.resourceKind}:${a.resourceId}:${a.version}`.localeCompare(`${b.resourceKind}:${b.resourceId}:${b.version}`));
        const generationId = refs.length === 0 ? `${migrationKey}:${worktree.id}` : `gen:${digest({ worktreeId: worktree.id, refs }).slice(7)}`;
        insertGeneration.run(generationId, worktree.id, digest(refs), migrationKey, now.getTime());
        for (const ref of refs) {
          const key = `${ref.resourceKind}:${ref.resourceId}:${ref.version}`;
          const descriptor = descriptors.get(key);
          const versionId = versionIds.get(key);
          if (!descriptor || !versionId) throw new Error("Canonical migration descriptor disappeared.");
          const memberId = `member:${digest({ generationId, versionId }).slice(7)}`;
          insertMember.run(memberId, generationId, versionId, descriptor.configurationDigest, descriptor.invocationPolicyDigest);
          for (const provider of descriptor.providers) insertProvider.run(memberId, provider.agentKind, provider.availability, provider.skillIsolation, provider.qualificationDigest, provider.expectedStateDigest);
        }
        insertAssignment.run(worktree.id, generationId, generationId, now.getTime(), now.getTime());
        const projection = assignmentProjectionSchema.parse({
          worktreeId: worktree.id, revision: "0", projectionSequence: "0", phase: "stable", currentAgentKind: "codex",
          resources: refs.map((ref) => {
            const descriptor = descriptors.get(`${ref.resourceKind}:${ref.resourceId}:${ref.version}`);
            if (!descriptor) throw new Error("Canonical projection descriptor disappeared.");
            const codex = descriptor.providers.find((provider) => provider.agentKind === "codex");
            const available = codex?.availability === "compatible";
            return { kind: ref.resourceKind, id: ref.resourceId, name: descriptor.name, version: ref.version, description: descriptor.description,
              desired: true, verified: true, operation: null, status: available ? "enabled" : "unavailable", assignable: available,
              unavailableReason: available ? null : "provider_incompatible", automaticUsageReporting: ref.resourceKind === "capability" ? "supported" : "unknown",
              skillIsolation: ref.resourceKind === "capability" ? "not_applicable" : (codex?.skillIsolation ?? "not_enforced") };
          }),
          blockers: [], progress: null, admission: { canCreateSession: true, canResumeSession: true, canSend: true, reason: null, message: null },
          allowedActions: [], failure: null, updatedAt: now.toISOString(),
        });
        insertOutbox.run(`migration:${worktree.id}`, worktree.id, JSON.stringify(projection), now.getTime());
      }
      this.beforeVerified?.();
      const journal = this.sqlite.prepare("UPDATE worktree_assignment_migrations SET status='verified',completed_at=? WHERE migration_key=? AND status='applying' AND source_fingerprint=?").run(now.getTime(), migrationKey, sourceFingerprint);
      if (journal.changes !== 1) throw new Error("Assignment migration journal changed during conversion.");
      this.sqlite.exec("COMMIT");
      return { kind: "migrated", worktreeCount: worktrees.length, generationCount: worktrees.length, resourceVersionCount: descriptors.size };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      this.recordFailedPreflight(sourceFingerprint, worktrees.length, "migration_data_failed", now);
      throw error;
    }
  }

  private failPreflight(sourceFingerprint: string, worktreeCount: number, failureCode: string, now: Date): never {
    this.recordFailedPreflight(sourceFingerprint, worktreeCount, failureCode, now);
    throw new Error(`Assignment migration preflight failed: ${failureCode}.`);
  }

  private recordFailedPreflight(sourceFingerprint: string, worktreeCount: number, failureCode: string, now: Date): void {
    this.sqlite.prepare(`INSERT INTO worktree_assignment_migrations
      (migration_key,status,source_fingerprint,worktree_count,resource_version_count,generation_count,failure_code,started_at,completed_at)
      VALUES (?,'failed',?,?,0,0,?,?,?)
      ON CONFLICT(migration_key) DO UPDATE SET status='failed',source_fingerprint=excluded.source_fingerprint,worktree_count=excluded.worktree_count,resource_version_count=0,generation_count=0,failure_code=excluded.failure_code,started_at=excluded.started_at,completed_at=excluded.completed_at`).run(migrationKey, sourceFingerprint, worktreeCount, failureCode, now.getTime(), now.getTime());
  }
}
