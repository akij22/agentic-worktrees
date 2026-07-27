import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDatabaseUpgrades } from './index';

describe('database upgrades', () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('adds last_viewed_at to an existing coding-agent session table', () => {
    sqlite.exec(`
      CREATE TABLE coding_agent_sessions (
        run_id TEXT PRIMARY KEY NOT NULL
      );
      INSERT INTO coding_agent_sessions (run_id) VALUES ('run-1');
    `);

    applyDatabaseUpgrades(sqlite);

    const columns = sqlite
      .prepare('PRAGMA table_info(coding_agent_sessions)')
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toContain('last_viewed_at');
    expect(
      sqlite
        .prepare(
          'SELECT run_id, last_viewed_at FROM coding_agent_sessions WHERE run_id = ?',
        )
        .get('run-1'),
    ).toEqual({ run_id: 'run-1', last_viewed_at: null });
  });
});
