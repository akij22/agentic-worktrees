import type BetterSqlite3 from 'better-sqlite3';
import { ManagedPackageRepository } from '../packages/package-repository';
import { getSqlite } from './client';
import { bootstrapSchemaSql, managedPackageSchemaStatements } from './bootstrap';

type TableInfoRow = {
  name: string;
};

export const applyDatabaseUpgrades = (sqlite: BetterSqlite3.Database): void => {
  const evidenceColumns = sqlite.prepare("PRAGMA table_info(resource_activity_evidence)").all() as TableInfoRow[];
  if (evidenceColumns.length > 0 && !evidenceColumns.some(({ name }) => name === "canonical_digest")) {
    sqlite.exec("ALTER TABLE resource_activity_evidence ADD COLUMN canonical_digest TEXT");
  }
	sqlite.exec(managedPackageSchemaStatements.join(";\n"));
	const worktreeColumns = sqlite
		.prepare("PRAGMA table_info(worktrees)")
		.all() as TableInfoRow[];
	if (
		worktreeColumns.length > 0 &&
		!worktreeColumns.some(({ name }) => name === "kind")
	) {
		sqlite.exec(
			"ALTER TABLE worktrees ADD COLUMN kind TEXT NOT NULL DEFAULT 'linked'",
		);
	}

  const sessionColumns = sqlite
    .prepare('PRAGMA table_info(coding_agent_sessions)')
    .all() as TableInfoRow[];
  if (
    sessionColumns.length > 0 &&
    !sessionColumns.some(({ name }) => name === 'last_viewed_at')
  ) {
    sqlite.exec(
      'ALTER TABLE coding_agent_sessions ADD COLUMN last_viewed_at INTEGER',
    );
  }
};

export const initDatabase = (): void => {
  const sqlite = getSqlite();
  sqlite.exec(bootstrapSchemaSql);
  applyDatabaseUpgrades(sqlite);
  // Quarantine incomplete updates before any catalog or host is constructed.
  new ManagedPackageRepository(sqlite).quarantineUpdateRecoveries();
};
