import { DatabaseRuntimeAttestationVerifier } from "../worktree-runtime-attestation-verifier";
import { AssignmentRepository } from "../../assignments/assignment-repository";
import BetterSqlite3 from "better-sqlite3";
import { bootstrapSchemaSql } from "../../database/bootstrap";
import { ResourceActivityRepository } from "../../resource-activity/resource-activity-repository";
import { ResourceActivityEvidenceService } from "../../resource-activity/resource-activity-evidence-service";
import {
  createCodexEvidenceContract,
  type CodexWorktreeRuntimeOptions,
} from "../codex-worktree-runtime";
const databases: BetterSqlite3.Database[] = [];
const evidenceServices: ResourceActivityEvidenceService[] = [];
export function closeEvidenceFixtures(): void {
  for (const service of evidenceServices.splice(0)) service.dispose();
  for (const db of databases.splice(0)) db.close();
}
export function evidenceFor(
  options: CodexWorktreeRuntimeOptions,
  cancelOwnedInvocation?: (
    lineage: CodexWorktreeRuntimeOptions["lineage"],
    id: string,
  ) => Promise<boolean>,
) {
  const db = new BetterSqlite3(":memory:");
  databases.push(db);
  db.exec(bootstrapSchemaSql);
  const l = options.lineage,
    digest = `sha256:${"a".repeat(64)}`;
  db.prepare(
    "INSERT INTO repositories (id,github_repo_id,owner_login,name,full_name,is_private,is_archived,clone_url,html_url,local_clone_status,created_at,updated_at) VALUES ('repo',1,'o','r','o/r',0,0,'u','u','ready',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO worktrees (id,repository_id,name,path,branch_name,kind,status,created_at,updated_at) VALUES (?,'repo','w',?,'main','primary','ready',1,1)",
  ).run(l.worktreeId, options.directory);
  db.prepare(
    "INSERT INTO runs (id,repository_id,worktree_id,title,prompt,status,output_status,last_sequence,created_at,updated_at) VALUES ('run','repo',?,'t','private-prompt','running','idle',0,1,1)",
  ).run(l.worktreeId);
  db.prepare(
    "INSERT INTO worktree_assignment_generations (id,worktree_id,ordinal,resource_set_digest,created_at) VALUES (?,?,0,?,1)",
  ).run(l.assignmentGenerationId, l.worktreeId, digest);
  const identities = [
    ...new Map(
      [
        ...options.skills.map((s) => s.identity),
        ...(options.capabilityTools ?? []).map((t) => t.identity),
      ].map((identity) => [JSON.stringify(identity), identity]),
    ).values(),
  ];
  for (const [index, identity] of identities.entries()) {
    db.prepare(
      "INSERT INTO resource_versions (id,resource_kind,resource_id,version,content_digest,security_digest,created_at) VALUES (?,?,?,?,?,?,1)",
    ).run(
      `resource-${index}`,
      identity.resourceKind,
      identity.resourceId,
      identity.resourceVersion,
      identity.resourceDigest,
      digest,
    );
    db.prepare(
      "INSERT INTO worktree_assignment_generation_resources (id,generation_id,resource_version_id,configuration_digest,invocation_policy_digest) VALUES (?,?,?,?,?)",
    ).run(
      `member-${index}`,
      l.assignmentGenerationId,
      `resource-${index}`,
      digest,
      digest,
    );
  }
  db.prepare(
    "INSERT INTO worktree_runtime_catalog_generations (id,worktree_id,agent_kind,assignment_generation_id,provider_version,adapter_contract_version,projection_digest,created_at) VALUES (?,?,'codex',?,'0.154.0',1,?,1)",
  ).run(l.catalogGenerationId, l.worktreeId, l.assignmentGenerationId, digest);
  db.prepare(
    "INSERT INTO worktree_assignments (worktree_id,revision,projection_sequence,phase,desired_generation_id,verified_generation_id,created_at,updated_at) VALUES (?,1,0,'stable',?,?,1,1)",
  ).run(l.worktreeId, l.assignmentGenerationId, l.assignmentGenerationId);
  db.prepare(
    "INSERT INTO worktree_runtime_assignment_attestations (worktree_id,agent_kind,runtime_generation,assignment_generation_id,catalog_generation_id,provider_version,effective_state_digest,verified_at) VALUES (?,'codex',?,?,?,'0.154.0',?,1)",
  ).run(
    l.worktreeId,
    l.runtimeGenerationId,
    l.assignmentGenerationId,
    l.catalogGenerationId,
    digest,
  );
  const evidence = new ResourceActivityEvidenceService({
    repository: new ResourceActivityRepository(db),
    keyVersion: 1,
    evidenceKey: Buffer.alloc(32, 7),
    providerContracts: [createCodexEvidenceContract(options)],
    quarantine: () => undefined,
    cancelOwnedInvocation,
    cancellationTimeoutMs: 100,
  });
  evidenceServices.push(evidence);
  return evidence;
}

export function attachRuntimeAttestation(options: CodexWorktreeRuntimeOptions) {
  const db = databases.at(-1);
  if (!db) throw new Error("Fixture database unavailable.");
  const verifier = new DatabaseRuntimeAttestationVerifier(db);
  options.verifyAttestation = (l) =>
    verifier.verify({
      agentKind: "codex",
      worktreeId: l.worktreeId,
      runtimeGeneration: l.runtimeGenerationId,
      providerVersion: l.providerVersion,
      assignmentGenerationId: l.assignmentGenerationId,
      catalogGenerationId: l.catalogGenerationId,
    });
  options.onUnavailable = (l) =>
    verifier.invalidate({
      agentKind: "codex",
      worktreeId: l.worktreeId,
      runtimeGeneration: l.runtimeGenerationId,
    });
  options.onVerified = async (digest) =>
    new AssignmentRepository(db).registerRuntimeAttestation({
      agentKind: "codex",
      worktreeId: options.lineage.worktreeId,
      runtimeGeneration: options.lineage.runtimeGenerationId,
      providerVersion: options.lineage.providerVersion,
      assignmentGenerationId: options.lineage.assignmentGenerationId,
      catalogGenerationId: options.lineage.catalogGenerationId,
      effectiveStateDigest: digest,
      verifiedAt: new Date(),
    });
  return verifier;
}
