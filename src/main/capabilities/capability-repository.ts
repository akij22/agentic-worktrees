import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { CapabilityError } from "@agentic-worktrees/capability-sdk";
import { getSqlite } from "../database/client";

export type PersistedCapabilityStatus =
  | "inactive"
  | "pending_activation"
  | "reloading"
  | "active"
  | "pending_deactivation"
  | "activation_failed";

export interface CapabilityInstallationRecord {
  capabilityId: string;
  version: string;
  permissionDigest: string;
  configured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type CapabilitySettingValue = string | number | boolean;

export interface CapabilitySettingRecord {
  key: string;
  value?: CapabilitySettingValue;
  secretRef?: string;
}

export interface InstalledConfigurationSnapshot {
  readonly capabilityId: string;
  readonly installation: CapabilityInstallationRecord | undefined;
  readonly settings: readonly CapabilitySettingRecord[];
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

/**
 * The Assignment for one Worktree. Distinct from a SessionCapabilityRecord:
 * this is the decision, that one is its materialisation into a runtime.
 */
export interface WorktreeCapabilityRecord {
  id: string;
  worktreeId: string;
  capabilityId: string;
  version: string;
  status: string;
  errorCode?: string;
  activatedAt?: Date;
  deactivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const allowedTransitions: Record<
  PersistedCapabilityStatus,
  readonly PersistedCapabilityStatus[]
> = {
  inactive: ["pending_activation"],
  activation_failed: ["pending_activation", "inactive"],
  pending_activation: ["reloading", "active", "activation_failed"],
  reloading: ["active", "activation_failed", "inactive"],
  active: ["pending_deactivation"],
  pending_deactivation: ["reloading", "inactive", "activation_failed"],
};

type InstallationRow = Omit<
  CapabilityInstallationRecord,
  "configured" | "createdAt" | "updatedAt"
> & { configured: number; createdAt: number; updatedAt: number };
type SessionRow = Omit<
  SessionCapabilityRecord,
  "createdAt" | "updatedAt" | "activatedAt" | "deactivatedAt" | "errorCode"
> & {
  errorCode: string | null;
  activatedAt: number | null;
  deactivatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function installationFromRow(
  row: InstallationRow,
): CapabilityInstallationRecord {
  return {
    ...row,
    configured: Boolean(row.configured),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function sessionFromRow(row: SessionRow): SessionCapabilityRecord {
  return {
    id: row.id,
    runId: row.runId,
    capabilityId: row.capabilityId,
    version: row.version,
    status: row.status,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.activatedAt ? { activatedAt: new Date(row.activatedAt) } : {}),
    ...(row.deactivatedAt
      ? { deactivatedAt: new Date(row.deactivatedAt) }
      : {}),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

const installationSelect = `SELECT capability_id capabilityId, version, permission_digest permissionDigest, configured, created_at createdAt, updated_at updatedAt FROM capability_installations`;
function parseStoredSetting(serialized: string): CapabilitySettingValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new CapabilityError(
      "internal_error",
      "Stored capability settings are invalid.",
    );
  }
  if (
    typeof parsed === "string" ||
    typeof parsed === "boolean" ||
    (typeof parsed === "number" && Number.isFinite(parsed))
  ) {
    return parsed;
  }
  throw new CapabilityError(
    "internal_error",
    "Stored capability settings are invalid.",
  );
}
export interface SessionCapabilitySnapshotRecord extends Omit<
  SessionCapabilityRecord,
  "createdAt" | "updatedAt" | "activatedAt" | "deactivatedAt"
> {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt?: number;
  readonly deactivatedAt?: number;
}
export interface SessionCapabilityIdentity {
  readonly id: string;
  readonly runId: string;
  readonly capabilityId: string;
  readonly version: string;
  readonly status: PersistedCapabilityStatus;
}
export interface SessionCapabilitySnapshot {
  readonly capabilityId: string;
  readonly records: readonly Readonly<SessionCapabilitySnapshotRecord>[];
}

const sessionSelect = `SELECT id, run_id runId, capability_id capabilityId, version, status, error_code errorCode, activated_at activatedAt, deactivated_at deactivatedAt, created_at createdAt, updated_at updatedAt FROM session_capabilities`;

type WorktreeRow = Omit<
  WorktreeCapabilityRecord,
  "createdAt" | "updatedAt" | "activatedAt" | "deactivatedAt" | "errorCode"
> & {
  errorCode: string | null;
  activatedAt: number | null;
  deactivatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function worktreeFromRow(row: WorktreeRow): WorktreeCapabilityRecord {
  return {
    id: row.id,
    worktreeId: row.worktreeId,
    capabilityId: row.capabilityId,
    version: row.version,
    status: row.status,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.activatedAt ? { activatedAt: new Date(row.activatedAt) } : {}),
    ...(row.deactivatedAt ? { deactivatedAt: new Date(row.deactivatedAt) } : {}),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

const worktreeSelect = `SELECT id, worktree_id worktreeId, capability_id capabilityId, version, status, error_code errorCode, activated_at activatedAt, deactivated_at deactivatedAt, created_at createdAt, updated_at updatedAt FROM worktree_capabilities`;

export class CapabilityRepository {
  constructor(private readonly sqlite: Database.Database = getSqlite()) {}

  getInstallation(
    capabilityId: string,
  ): CapabilityInstallationRecord | undefined {
    const row = this.sqlite
      .prepare(`${installationSelect} WHERE capability_id = ?`)
      .get(capabilityId) as InstallationRow | undefined;
    return row ? installationFromRow(row) : undefined;
  }

  upsertInstallation(
    input: Omit<CapabilityInstallationRecord, "createdAt" | "updatedAt">,
  ): CapabilityInstallationRecord {
    const transaction = this.sqlite.transaction(() => {
      const now = Date.now();
      this.sqlite
        .prepare(
          `INSERT INTO capability_installations (capability_id, version, permission_digest, configured, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(capability_id) DO UPDATE SET version = excluded.version, permission_digest = excluded.permission_digest, configured = excluded.configured, updated_at = excluded.updated_at`,
        )
        .run(
          input.capabilityId,
          input.version,
          input.permissionDigest,
          input.configured ? 1 : 0,
          now,
          now,
        );
      return this.getInstallation(input.capabilityId);
    });
    const record = transaction();
    if (!record)
      throw new CapabilityError(
        "internal_error",
        "Capability configuration could not be saved.",
      );
    return record;
  }

  initializeInstalledConfiguration(
    manifest: {
      id: string;
      version: string;
      settings?: Record<
        string,
        { default?: CapabilitySettingValue; required?: boolean; type?: string }
      >;
    },
    permissionDigest: string,
  ): CapabilityInstallationRecord {
    const settings = Object.entries(manifest.settings ?? {}).map(
      ([key, value]) => ({
        key,
        ...(value.default !== undefined ? { value: value.default } : {}),
      }),
    );
    const configured = Object.entries(manifest.settings ?? {}).every(
      ([, value]) =>
        value.type === "secret"
          ? !value.required
          : !value.required || value.default !== undefined,
    );
    return this.saveConfiguration(
      {
        capabilityId: manifest.id,
        version: manifest.version,
        permissionDigest,
        configured,
      },
      settings,
    );
  }

  replaceSettings(
    capabilityId: string,
    settings: readonly CapabilitySettingRecord[],
  ): CapabilitySettingRecord[] {
    return this.sqlite.transaction(() =>
      this.replaceSettingsWithinTransaction(capabilityId, settings),
    )();
  }

  saveConfiguration(
    installation: Omit<CapabilityInstallationRecord, "createdAt" | "updatedAt">,
    settings: readonly CapabilitySettingRecord[],
  ): CapabilityInstallationRecord {
    const record = this.sqlite.transaction(() => {
      const now = Date.now();
      this.sqlite
        .prepare(
          `INSERT INTO capability_installations (capability_id, version, permission_digest, configured, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(capability_id) DO UPDATE SET version = excluded.version, permission_digest = excluded.permission_digest, configured = excluded.configured, updated_at = excluded.updated_at`,
        )
        .run(
          installation.capabilityId,
          installation.version,
          installation.permissionDigest,
          installation.configured ? 1 : 0,
          now,
          now,
        );
      this.replaceSettingsWithinTransaction(
        installation.capabilityId,
        settings,
      );
      return this.getInstallation(installation.capabilityId);
    })();
    if (!record)
      throw new CapabilityError(
        "internal_error",
        "Capability configuration could not be saved.",
      );
    return record;
  }

  snapshotInstalledConfiguration(
    capabilityId: string,
  ): InstalledConfigurationSnapshot {
    return Object.freeze({
      capabilityId,
      installation: this.getInstallation(capabilityId),
      settings: Object.freeze(
        this.getSettings(capabilityId).map((setting) =>
          Object.freeze({ ...setting }),
        ),
      ),
    });
  }

  restoreInstalledConfiguration(
    snapshot: InstalledConfigurationSnapshot,
  ): void {
    this.restoreConfiguration(
      snapshot.capabilityId,
      snapshot.installation,
      snapshot.settings,
    );
  }

  restoreConfiguration(
    capabilityId: string,
    installation: CapabilityInstallationRecord | undefined,
    settings: readonly CapabilitySettingRecord[],
  ): void {
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare("DELETE FROM capability_settings WHERE capability_id = ?")
        .run(capabilityId);
      if (!installation) {
        this.sqlite
          .prepare(
            "DELETE FROM capability_installations WHERE capability_id = ?",
          )
          .run(capabilityId);
        return;
      }
      this.sqlite
        .prepare(
          `INSERT INTO capability_installations (capability_id,version,permission_digest,configured,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(capability_id) DO UPDATE SET version=excluded.version,permission_digest=excluded.permission_digest,configured=excluded.configured,created_at=excluded.created_at,updated_at=excluded.updated_at`,
        )
        .run(
          installation.capabilityId,
          installation.version,
          installation.permissionDigest,
          installation.configured ? 1 : 0,
          installation.createdAt.getTime(),
          installation.updatedAt.getTime(),
        );
      this.replaceSettingsWithinTransaction(capabilityId, settings);
    })();
  }

  getSettings(capabilityId: string): CapabilitySettingRecord[] {
    const rows = this.sqlite
      .prepare(
        "SELECT key, value_json valueJson, secret_ref secretRef FROM capability_settings WHERE capability_id = ? ORDER BY key",
      )
      .all(capabilityId) as Array<{
      key: string;
      valueJson: string | null;
      secretRef: string | null;
    }>;
    return rows.map((row) => ({
      key: row.key,
      ...(row.valueJson !== null
        ? { value: parseStoredSetting(row.valueJson) }
        : {}),
      ...(row.secretRef ? { secretRef: row.secretRef } : {}),
    }));
  }

  getSessionCapability(
    runId: string,
    capabilityId: string,
  ): SessionCapabilityRecord | undefined {
    const row = this.sqlite
      .prepare(`${sessionSelect} WHERE run_id = ? AND capability_id = ?`)
      .get(runId, capabilityId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  listSessionCapabilities(runId: string): SessionCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(`${sessionSelect} WHERE run_id = ? ORDER BY capability_id`)
        .all(runId) as SessionRow[]
    ).map(sessionFromRow);
  }

  listSessionCapabilitiesByCapabilityId(
    capabilityId: string,
  ): SessionCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(`${sessionSelect} WHERE capability_id = ? ORDER BY run_id`)
        .all(capabilityId) as SessionRow[]
    ).map(sessionFromRow);
  }

  listActiveRunsByCapabilityId(capabilityId: string): string[] {
    return this.listSessionCapabilitiesByCapabilityId(capabilityId)
      .filter((record) => record.status === "active")
      .map((record) => record.runId);
  }

  /**
   * The worktree a run belongs to, used to decide which sessions a worktree
   * level Assignment has to reconcile.
   */
  getRunWorktreeId(runId: string): string | undefined {
    const row = this.sqlite
      .prepare(`SELECT worktree_id worktreeId FROM runs WHERE id = ?`)
      .get(runId) as { worktreeId: string } | undefined;
    return row?.worktreeId;
  }

  getWorktreeCapability(
    worktreeId: string,
    capabilityId: string,
  ): WorktreeCapabilityRecord | undefined {    const row = this.sqlite
      .prepare(`${worktreeSelect} WHERE worktree_id = ? AND capability_id = ?`)
      .get(worktreeId, capabilityId) as WorktreeRow | undefined;
    return row ? worktreeFromRow(row) : undefined;
  }

  listWorktreeCapabilities(worktreeId: string): WorktreeCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(`${worktreeSelect} WHERE worktree_id = ? ORDER BY capability_id`)
        .all(worktreeId) as WorktreeRow[]
    ).map(worktreeFromRow);
  }

  listWorktreeCapabilitiesByCapabilityId(
    capabilityId: string,
  ): WorktreeCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(`${worktreeSelect} WHERE capability_id = ? ORDER BY worktree_id`)
        .all(capabilityId) as WorktreeRow[]
    ).map(worktreeFromRow);
  }

  /**
   * Moves an Assignment to a new state, inserting it when absent.
   *
   * Unlike the session table this does not police a transition graph: the
   * worktree-level decision can be re-asserted from any state, and the
   * validity rules live in the service that owns the domain.
   */
  transitionWorktreeCapability(input: {
    worktreeId: string;
    capabilityId: string;
    version: string;
    to: string;
    errorCode?: string;
  }): WorktreeCapabilityRecord {
    return this.sqlite.transaction(() => {
      const now = Date.now();
      const current = this.getWorktreeCapability(
        input.worktreeId,
        input.capabilityId,
      );
      if (!current) {
        this.sqlite
          .prepare(
            `INSERT INTO worktree_capabilities (id, worktree_id, capability_id, version, status, error_code, activated_at, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          )
          .run(
            randomUUID(),
            input.worktreeId,
            input.capabilityId,
            input.version,
            input.to,
            input.errorCode ?? null,
            now,
            now,
          );
      } else {
        this.sqlite
          .prepare(
            `UPDATE worktree_capabilities SET version = ?, status = ?, error_code = ?, activated_at = CASE WHEN ? = 'active' THEN ? ELSE activated_at END, deactivated_at = CASE WHEN ? = 'deactivated' THEN ? ELSE deactivated_at END, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.version,
            input.to,
            input.errorCode ?? null,
            input.to,
            now,
            input.to,
            now,
            now,
            current.id,
          );
      }
      const record = this.getWorktreeCapability(
        input.worktreeId,
        input.capabilityId,
      );
      if (!record)
        throw new CapabilityError(
          "internal_error",
          "Assignment state could not be saved.",
        );
      return record;
    })();
  }

  deleteWorktreeCapability(worktreeId: string, capabilityId: string): void {
    this.sqlite
      .prepare(
        `DELETE FROM worktree_capabilities WHERE worktree_id = ? AND capability_id = ?`,
      )
      .run(worktreeId, capabilityId);
  }

  isPackageActivationBlocked(capabilityId: string): boolean {
    return Boolean(this.sqlite.prepare(`SELECT 1 FROM managed_package_installations WHERE item_kind='capability' AND item_id=? AND state IN ('blocked','invalid')
      UNION ALL SELECT 1 FROM managed_package_update_recoveries WHERE json_extract(snapshot, '$.capabilityId')=? LIMIT 1`).get(capabilityId, capabilityId));
  }

  snapshotSessionCapabilities(capabilityId: string): SessionCapabilitySnapshot {
    return Object.freeze({
      capabilityId,
      records: Object.freeze(
        this.listSessionCapabilitiesByCapabilityId(capabilityId).map((record) =>
          Object.freeze({
            id: record.id,
            runId: record.runId,
            capabilityId: record.capabilityId,
            version: record.version,
            status: record.status,
            ...(record.errorCode ? { errorCode: record.errorCode } : {}),
            createdAt: record.createdAt.getTime(),
            updatedAt: record.updatedAt.getTime(),
            ...(record.activatedAt
              ? { activatedAt: record.activatedAt.getTime() }
              : {}),
            ...(record.deactivatedAt
              ? { deactivatedAt: record.deactivatedAt.getTime() }
              : {}),
          }),
        ),
      ),
    });
  }

  updateSessionCapabilityVersionsIfMatches(
    capabilityId: string,
    expected: readonly SessionCapabilityIdentity[],
    runIds: readonly string[],
    version: string,
  ): boolean {
    return this.sqlite.transaction(() => {
      if (!this.sessionCapabilitiesMatch(capabilityId, expected)) return false;
      this.updateSessionCapabilityVersions(capabilityId, runIds, version);
      return true;
    })();
  }

  updateSessionCapabilityVersions(
    capabilityId: string,
    runIds: readonly string[],
    version: string,
  ): void {
    this.sqlite.transaction(() => {
      const update = this.sqlite.prepare(
        "UPDATE session_capabilities SET version = ?, updated_at = ? WHERE capability_id = ? AND run_id = ?",
      );
      const now = Date.now();
      for (const runId of runIds) {
        const result = update.run(version, now, capabilityId, runId);
        if (result.changes !== 1)
          throw new CapabilityError(
            "internal_error",
            "Capability session could not be updated.",
          );
      }
    })();
  }

  sessionCapabilitiesMatch(
    capabilityId: string,
    expected: readonly SessionCapabilityIdentity[],
  ): boolean {
    const current = this.listSessionCapabilitiesByCapabilityId(capabilityId);
    return (
      current.length === expected.length &&
      current.every((record, index) => {
        const wanted = expected[index];
        return (
          wanted !== undefined &&
          record.id === wanted.id &&
          record.runId === wanted.runId &&
          record.capabilityId === wanted.capabilityId &&
          record.version === wanted.version &&
          record.status === wanted.status
        );
      })
    );
  }

  restoreSessionCapabilitiesIfMatches(
    expected: readonly SessionCapabilityIdentity[],
    snapshot: SessionCapabilitySnapshot,
  ): boolean {
    return this.sqlite.transaction(() => {
      if (!this.sessionCapabilitiesMatch(snapshot.capabilityId, expected))
        return false;
      this.restoreSessionCapabilities(snapshot);
      return true;
    })();
  }

  restoreSessionCapabilities(snapshot: SessionCapabilitySnapshot): void {
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare("DELETE FROM session_capabilities WHERE capability_id = ?")
        .run(snapshot.capabilityId);
      const insert = this.sqlite.prepare(
        "INSERT INTO session_capabilities (id, run_id, capability_id, version, status, error_code, activated_at, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const record of snapshot.records)
        insert.run(
          record.id,
          record.runId,
          record.capabilityId,
          record.version,
          record.status,
          record.errorCode ?? null,
          record.activatedAt ?? null,
          record.deactivatedAt ?? null,
          record.createdAt,
          record.updatedAt,
        );
    })();
  }

  transitionSessionCapability(input: {
    runId: string;
    capabilityId: string;
    version: string;
    to: PersistedCapabilityStatus;
    errorCode?: string;
  }): SessionCapabilityRecord {
    return this.sqlite.transaction(() => {
      const now = Date.now();
      const current = this.getSessionCapability(
        input.runId,
        input.capabilityId,
      );
      const from: PersistedCapabilityStatus = current?.status ?? "inactive";
      if (from === input.to) return current ?? this.insertInitial(input, now);
      if (!allowedTransitions[from].includes(input.to))
        throw new CapabilityError(
          "invalid_input",
          `Invalid capability state transition: ${from} -> ${input.to}.`,
        );
      if (!current) this.insertInitial(input, now);
      else
        this.sqlite
          .prepare(
            `UPDATE session_capabilities SET status = ?, error_code = ?, activated_at = CASE WHEN ? = 'active' THEN ? ELSE activated_at END, deactivated_at = CASE WHEN ? = 'inactive' THEN ? ELSE deactivated_at END, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.to,
            input.errorCode ?? null,
            input.to,
            now,
            input.to,
            now,
            now,
            current.id,
          );
      const record = this.getSessionCapability(input.runId, input.capabilityId);
      if (!record)
        throw new CapabilityError(
          "internal_error",
          "Capability state could not be saved.",
        );
      return record;
    })();
  }

  private replaceSettingsWithinTransaction(
    capabilityId: string,
    settings: readonly CapabilitySettingRecord[],
  ): CapabilitySettingRecord[] {
    const now = Date.now();
    this.sqlite
      .prepare("DELETE FROM capability_settings WHERE capability_id = ?")
      .run(capabilityId);
    const insert = this.sqlite.prepare(
      `INSERT INTO capability_settings (id, capability_id, key, value_json, secret_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const setting of settings)
      insert.run(
        randomUUID(),
        capabilityId,
        setting.key,
        setting.value === undefined ? null : JSON.stringify(setting.value),
        setting.secretRef ?? null,
        now,
        now,
      );
    return this.getSettings(capabilityId);
  }

  private insertInitial(
    input: {
      runId: string;
      capabilityId: string;
      version: string;
      to: PersistedCapabilityStatus;
      errorCode?: string;
    },
    now: number,
  ): SessionCapabilityRecord {
    this.sqlite
      .prepare(
        `INSERT INTO session_capabilities (id, run_id, capability_id, version, status, error_code, activated_at, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.runId,
        input.capabilityId,
        input.version,
        input.to,
        input.errorCode ?? null,
        input.to === "active" ? now : null,
        input.to === "inactive" ? now : null,
        now,
        now,
      );
    const record = this.getSessionCapability(input.runId, input.capabilityId);
    if (!record)
      throw new CapabilityError(
        "internal_error",
        "Capability state could not be saved.",
      );
    return record;
  }

  listActiveSessionCapabilities(): SessionCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(
          `${sessionSelect} WHERE status = 'active' ORDER BY run_id, capability_id`,
        )
        .all() as SessionRow[]
    ).map(sessionFromRow);
  }

  listInterruptedSessionCapabilities(): SessionCapabilityRecord[] {
    return (
      this.sqlite
        .prepare(
          `${sessionSelect} WHERE status IN ('pending_activation', 'pending_deactivation', 'reloading') ORDER BY updated_at`,
        )
        .all() as SessionRow[]
    ).map(sessionFromRow);
  }
}
