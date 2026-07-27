import type Database from 'better-sqlite3';
import { getSqlite } from './client';
import { bootstrapSchemaSql } from './bootstrap';

type TableInfoRow = {
  name: string;
};

export const applyDatabaseUpgrades = (sqlite: Database.Database): void => {
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
};
