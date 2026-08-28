import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import { getSqlite } from "../database/client";

export type PersistedCapabilityStatus =
  | "inactive" | "pending_activation" | "reloading" | "active"
  | "pending_deactivation" | "activation_failed";

export interface CapabilityInstallationRecord {
  capabilityId: string;
  version: string;
  permissionDigest: string;
  configured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CapabilitySettingRecord {
  key: string;
  value?: unknown;
  secretRef?: string;
}

export interface SessionCapabilityRecord {
  id: string;
  runId: string;
  capabilityId: string;
  version: string;
  status: PersistedCapabilityStatus;
  errorCode?: string;
  activatedAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const allowedTransitions: Record<PersistedCapabilityStatus, readonly PersistedCapabilityStatus[]> = {
  inactive: ["pending_activation"],
  activation_failed: ["pending_activation", "inactive"],
  pending_activation: ["reloading", "active", "activation_failed"],
  reloading: ["active", "activation_failed", "inactive"],
  active: ["pending_deactivation"],
  pending_deactivation: ["reloading", "inactive", "activation_failed"],
};

type InstallationRow = Omit<CapabilityInstallationRecord, "configured" | "createdAt" | "updatedAt"> & { configured: number; createdAt: number; updatedAt: number };
type SessionRow = Omit<SessionCapabilityRecord, "createdAt" | "updatedAt" | "activatedAt" | "deactivatedAt" | "errorCode"> & { errorCode: string | null; activatedAt: number | null; deactivatedAt: number | null; createdAt: number; updatedAt: number };

function installationFromRow(row: InstallationRow): CapabilityInstallationRecord {
  return { ...row, configured: Boolean(row.configured), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}
function sessionFromRow(row: SessionRow): SessionCapabilityRecord {
  return {
    id: row.id, runId: row.runId, capabilityId: row.capabilityId, version: row.version,
    status: row.status, ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.activatedAt ? { activatedAt: new Date(row.activatedAt) } : {}),
    ...(row.deactivatedAt ? { deactivatedAt: new Date(row.deactivatedAt) } : {}),
    createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt),
  };
}

const installationSelect = `SELECT capability_id capabilityId, version, permission_digest permissionDigest, configured, created_at createdAt, updated_at updatedAt FROM capability_installations`;
function parseStoredSetting(serialized: string): unknown {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return parsed;
  } catch {
    throw new CapabilityError("internal_error", "Stored capability settings are invalid.");
  }
}
const sessionSelect = `SELECT id, run_id runId, capability_id capabilityId, version, status, error_code errorCode, activated_at activatedAt, deactivated_at deactivatedAt, created_at createdAt, updated_at updatedAt FROM session_capabilities`;

export class CapabilityRepository {
  constructor(private readonly sqlite: Database.Database = getSqlite()) {}

  getInstallation(capabilityId: string): CapabilityInstallationRecord | undefined {
    const row = this.sqlite.prepare(`${installationSelect} WHERE capability_id = ?`).get(capabilityId) as InstallationRow | undefined;
    return row ? installationFromRow(row) : undefined;
  }

  upsertInstallation(input: Omit<CapabilityInstallationRecord, "createdAt" | "updatedAt">): CapabilityInstallationRecord {
    const transaction = this.sqlite.transaction(() => {
      const now = Date.now();
      this.sqlite.prepare(`INSERT INTO capability_installations (capability_id, version, permission_digest, configured, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(capability_id) DO UPDATE SET version = excluded.version, permission_digest = excluded.permission_digest, configured = excluded.configured, updated_at = excluded.updated_at`)
        .run(input.capabilityId, input.version, input.permissionDigest, input.configured ? 1 : 0, now, now);
      return this.getInstallation(input.capabilityId);
    });
    const record = transaction();
    if (!record) throw new CapabilityError("internal_error", "Capability configuration could not be saved.");
    return record;
  }

  replaceSettings(capabilityId: string, settings: readonly CapabilitySettingRecord[]): CapabilitySettingRecord[] {
    return this.sqlite.transaction(() => {
      const now = Date.now();
      this.sqlite.prepare("DELETE FROM capability_settings WHERE capability_id = ?").run(capabilityId);
      const insert = this.sqlite.prepare(`INSERT INTO capability_settings (id, capability_id, key, value_json, secret_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const setting of settings) insert.run(randomUUID(), capabilityId, setting.key, setting.value === undefined ? null : JSON.stringify(setting.value), setting.secretRef ?? null, now, now);
      return this.getSettings(capabilityId);
    })();
  }

  getSettings(capabilityId: string): CapabilitySettingRecord[] {
    const rows = this.sqlite.prepare("SELECT key, value_json valueJson, secret_ref secretRef FROM capability_settings WHERE capability_id = ? ORDER BY key").all(capabilityId) as Array<{ key: string; valueJson: string | null; secretRef: string | null }>;
    return rows.map((row) => ({ key: row.key, ...(row.valueJson !== null ? { value: parseStoredSetting(row.valueJson) } : {}), ...(row.secretRef ? { secretRef: row.secretRef } : {}) }));
  }

  getSessionCapability(runId: string, capabilityId: string): SessionCapabilityRecord | undefined {
    const row = this.sqlite.prepare(`${sessionSelect} WHERE run_id = ? AND capability_id = ?`).get(runId, capabilityId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  listSessionCapabilities(runId: string): SessionCapabilityRecord[] {
    return (this.sqlite.prepare(`${sessionSelect} WHERE run_id = ? ORDER BY capability_id`).all(runId) as SessionRow[]).map(sessionFromRow);
  }

  transitionSessionCapability(input: { runId: string; capabilityId: string; version: string; to: PersistedCapabilityStatus; errorCode?: string }): SessionCapabilityRecord {
    return this.sqlite.transaction(() => {
      const now = Date.now();
      const current = this.getSessionCapability(input.runId, input.capabilityId);
      const from: PersistedCapabilityStatus = current?.status ?? "inactive";
      if (from === input.to) return current ?? this.insertInitial(input, now);
      if (!allowedTransitions[from].includes(input.to)) throw new CapabilityError("invalid_input", `Invalid capability state transition: ${from} -> ${input.to}.`);
      if (!current) this.insertInitial(input, now);
      else this.sqlite.prepare(`UPDATE session_capabilities SET status = ?, error_code = ?, activated_at = CASE WHEN ? = 'active' THEN ? ELSE activated_at END, deactivated_at = CASE WHEN ? = 'inactive' THEN ? ELSE deactivated_at END, updated_at = ? WHERE id = ?`)
        .run(input.to, input.errorCode ?? null, input.to, now, input.to, now, now, current.id);
      const record = this.getSessionCapability(input.runId, input.capabilityId);
      if (!record) throw new CapabilityError("internal_error", "Capability state could not be saved.");
      return record;
    })();
  }

  private insertInitial(input: { runId: string; capabilityId: string; version: string; to: PersistedCapabilityStatus; errorCode?: string }, now: number): SessionCapabilityRecord {
    this.sqlite.prepare(`INSERT INTO session_capabilities (id, run_id, capability_id, version, status, error_code, activated_at, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), input.runId, input.capabilityId, input.version, input.to, input.errorCode ?? null, input.to === "active" ? now : null, input.to === "inactive" ? now : null, now, now);
    const record = this.getSessionCapability(input.runId, input.capabilityId);
    if (!record) throw new CapabilityError("internal_error", "Capability state could not be saved.");
    return record;
  }

  listActiveSessionCapabilities(): SessionCapabilityRecord[] {
    return (this.sqlite.prepare(`${sessionSelect} WHERE status = 'active' ORDER BY run_id, capability_id`).all() as SessionRow[]).map(sessionFromRow);
  }

  listInterruptedSessionCapabilities(): SessionCapabilityRecord[] {
    return (this.sqlite.prepare(`${sessionSelect} WHERE status IN ('pending_activation', 'pending_deactivation', 'reloading') ORDER BY updated_at`).all() as SessionRow[]).map(sessionFromRow);
  }
}
