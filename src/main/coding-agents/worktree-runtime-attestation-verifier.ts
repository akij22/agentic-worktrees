import type BetterSqlite3 from "better-sqlite3";
import { getSqlite } from "../database/client";
import type {
  RuntimeAttestationIdentity,
  RuntimeAttestationVerifier,
} from "./worktree-runtime-manager";

export class DatabaseRuntimeAttestationVerifier implements RuntimeAttestationVerifier {
  constructor(private readonly database: BetterSqlite3.Database = getSqlite()) {}

  invalidate(input: Pick<RuntimeAttestationIdentity, "worktreeId" | "agentKind" | "runtimeGeneration">): void {
    this.database.prepare(`UPDATE worktree_runtime_assignment_attestations
      SET invalidated_at = ?, invalidation_code = 'runtime_unavailable'
      WHERE worktree_id = ? AND agent_kind = ? AND runtime_generation = ?
        AND invalidated_at IS NULL`).run(Date.now(), input.worktreeId, input.agentKind, input.runtimeGeneration);
  }

  async verify(input: RuntimeAttestationIdentity): Promise<boolean> {
    const row = this.database.prepare(`
      SELECT 1
      FROM worktree_runtime_assignment_attestations attestation
      INNER JOIN worktree_assignments assignment
        ON assignment.worktree_id = attestation.worktree_id
      INNER JOIN worktree_runtime_catalog_generations catalog
        ON catalog.id = attestation.catalog_generation_id
      WHERE attestation.worktree_id = ?
        AND attestation.agent_kind = ?
        AND attestation.runtime_generation = ?
        AND attestation.assignment_generation_id = ?
        AND attestation.catalog_generation_id = ?
        AND attestation.provider_version = ?
        AND attestation.invalidated_at IS NULL
        AND assignment.phase IN ('stable', 'failed_rolled_back')
        AND assignment.verified_generation_id = attestation.assignment_generation_id
        AND catalog.worktree_id = attestation.worktree_id
        AND catalog.agent_kind = attestation.agent_kind
        AND catalog.assignment_generation_id = attestation.assignment_generation_id
        AND catalog.provider_version = attestation.provider_version
      LIMIT 1
    `).get(
      input.worktreeId,
      input.agentKind,
      input.runtimeGeneration,
      input.assignmentGenerationId,
      input.catalogGenerationId,
      input.providerVersion,
    );
    return row !== undefined;
  }
}
