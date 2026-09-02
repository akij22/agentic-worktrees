import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { getSqlite } from "../database/client";

export type SkillInstallationState =
  | "pending_verification"
  | "installed"
  | "invalid"
  | "update_available";
export type SkillCompatibility = "supported" | "unsupported";

export interface SkillInstallationRecord {
  skillId: string;
  version: string;
  sourceKind: "bundled" | "local";
  sourceRef: string;
  contentDigest: string;
  name: string;
  description: string;
  license?: string;
  codexCompatibility: SkillCompatibility;
  opencodeCompatibility: SkillCompatibility;
  automaticInvocation: boolean;
  state: SkillInstallationState;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SkillInvocationStatus = "requested" | "loaded" | "failed";
export interface SkillInvocationRecord {
  id: string;
  runId: string;
  skillId: string;
  version: string;
  mode: "explicit" | "automatic";
  status: SkillInvocationStatus;
  errorCode?: string;
  requestedAt: Date;
  loadedAt?: Date;
  failedAt?: Date;
}

type InstallationInput = Omit<SkillInstallationRecord, "createdAt" | "updatedAt">;
type Row = Record<string, unknown>;
const installationSelect = `SELECT skill_id skillId, version, source_kind sourceKind, source_ref sourceRef, content_digest contentDigest, name, description, license, codex_compatibility codexCompatibility, opencode_compatibility opencodeCompatibility, automatic_invocation automaticInvocation, state, error_code errorCode, created_at createdAt, updated_at updatedAt FROM skill_installations`;
const invocationSelect = `SELECT id, run_id runId, skill_id skillId, version, mode, status, error_code errorCode, requested_at requestedAt, loaded_at loadedAt, failed_at failedAt FROM skill_invocations`;

function installation(row: Row): SkillInstallationRecord {
  return {
    ...(row as unknown as SkillInstallationRecord),
    automaticInvocation: Boolean(row.automaticInvocation),
    createdAt: new Date(row.createdAt as number),
    updatedAt: new Date(row.updatedAt as number),
    ...(row.license ? {} : { license: undefined }),
    ...(row.errorCode ? {} : { errorCode: undefined }),
  };
}
function invocation(row: Row): SkillInvocationRecord {
  return {
    ...(row as unknown as SkillInvocationRecord),
    requestedAt: new Date(row.requestedAt as number),
    ...(row.loadedAt ? { loadedAt: new Date(row.loadedAt as number) } : {}),
    ...(row.failedAt ? { failedAt: new Date(row.failedAt as number) } : {}),
    ...(row.errorCode ? {} : { errorCode: undefined }),
  };
}

export class SkillRepository {
  constructor(private readonly sqlite: BetterSqlite3.Database = getSqlite()) {}

  saveInstallation(input: InstallationInput): SkillInstallationRecord {
    const now = Date.now();
    this.sqlite.prepare(`INSERT INTO skill_installations (skill_id,version,source_kind,source_ref,content_digest,name,description,license,codex_compatibility,opencode_compatibility,automatic_invocation,state,error_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET version=excluded.version,source_kind=excluded.source_kind,source_ref=excluded.source_ref,content_digest=excluded.content_digest,name=excluded.name,description=excluded.description,license=excluded.license,codex_compatibility=excluded.codex_compatibility,opencode_compatibility=excluded.opencode_compatibility,automatic_invocation=excluded.automatic_invocation,state=excluded.state,error_code=excluded.error_code,updated_at=excluded.updated_at`).run(
      input.skillId, input.version, input.sourceKind, input.sourceRef,
      input.contentDigest, input.name, input.description, input.license ?? null,
      input.codexCompatibility, input.opencodeCompatibility,
      input.automaticInvocation ? 1 : 0, input.state, input.errorCode ?? null,
      now, now,
    );
    const saved = this.getInstallation(input.skillId);
    if (!saved) throw new Error("Skill installation could not be saved.");
    return saved;
  }

  setInstallationState(skillId: string, state: SkillInstallationState, errorCode?: string): SkillInstallationRecord {
    this.sqlite.prepare("UPDATE skill_installations SET state=?, error_code=?, updated_at=? WHERE skill_id=?").run(state, errorCode ?? null, Date.now(), skillId);
    const record = this.getInstallation(skillId);
    if (!record) throw new Error("Skill is not installed.");
    return record;
  }

  getInstallation(skillId: string): SkillInstallationRecord | undefined {
    const row = this.sqlite.prepare(`${installationSelect} WHERE skill_id=?`).get(skillId) as Row | undefined;
    return row ? installation(row) : undefined;
  }
  listInstallations(): SkillInstallationRecord[] {
    return (this.sqlite.prepare(`${installationSelect} ORDER BY skill_id`).all() as Row[]).map(installation);
  }
  removeInstallation(skillId: string): void {
    this.sqlite.prepare("DELETE FROM skill_installations WHERE skill_id=?").run(skillId);
  }

  startInvocation(input: { runId: string; skillId: string; version: string; mode: "explicit" | "automatic" }): SkillInvocationRecord {
    const id = randomUUID();
    this.sqlite.prepare("INSERT INTO skill_invocations (id,run_id,skill_id,version,mode,status,requested_at) VALUES (?,?,?,?,?,'requested',?)").run(id, input.runId, input.skillId, input.version, input.mode, Date.now());
    const saved = this.getInvocation(id);
    if (!saved) throw new Error("Skill invocation could not be saved.");
    return saved;
  }
  transitionInvocation(id: string, status: "loaded" | "failed", errorCode?: string): SkillInvocationRecord {
    const current = this.getInvocation(id);
    if (!current) throw new Error("Skill invocation not found.");
    if (current.status !== "requested") throw new Error(`Invalid skill invocation transition: ${current.status} -> ${status}.`);
    const timestampColumn = status === "loaded" ? "loaded_at" : "failed_at";
    this.sqlite.prepare(`UPDATE skill_invocations SET status=?, error_code=?, ${timestampColumn}=? WHERE id=?`).run(status, errorCode ?? null, Date.now(), id);
    const updated = this.getInvocation(id);
    if (!updated) throw new Error("Skill invocation could not be updated.");
    return updated;
  }
  listRunInvocations(runId: string): SkillInvocationRecord[] {
    return (this.sqlite.prepare(`${invocationSelect} WHERE run_id=? ORDER BY requested_at,id`).all(runId) as Row[]).map(invocation);
  }
  private getInvocation(id: string): SkillInvocationRecord | undefined {
    const row = this.sqlite.prepare(`${invocationSelect} WHERE id=?`).get(id) as Row | undefined;
    return row ? invocation(row) : undefined;
  }
}
