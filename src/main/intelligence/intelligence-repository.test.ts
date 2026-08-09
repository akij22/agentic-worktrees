import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapSchemaSql } from '../database/bootstrap';
import * as schema from '../../shared/db/schema';
import { createIntelligenceRepository } from './intelligence-repository';
import type {
  CollectedFileChange,
  PersistedIntelligenceSnapshot,
} from './types';

const changedFile = (filePath: string, patch: string): CollectedFileChange => ({
  path: filePath,
  previousPath: null,
  changeType: 'modified',
  folderPath: 'src',
  modulePath: 'src',
  additions: 1,
  deletions: 1,
  patch,
  ranges: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 }],
  binary: false,
  fingerprint: `${filePath}-${patch}`,
  afterContent: null,
  symbols: [{
    kind: 'function',
    name: 'createSession',
    qualifiedName: 'createSession',
    declarationStart: 1,
    declarationEnd: 3,
    changedStart: 2,
    changedEnd: 2,
  }],
});

const snapshot = (
  id: string,
  duplicateFile = false,
): PersistedIntelligenceSnapshot => ({
  id,
  repositoryId: 'repository-1',
  startedAt: 1,
  completedAt: 2,
  warnings: [],
  worktrees: [
    {
      id: `${id}-left-analysis`,
      worktreeId: 'left',
      runId: null,
      task: 'Left task',
      branch: 'feat/left',
      baseBranch: 'main',
      agentKind: 'codex',
      agentName: 'Codex',
      status: 'busy',
      additions: 1,
      deletions: 1,
      independent: false,
      warning: null,
      updatedAt: 2,
      files: [
        changedFile('src/session.ts', '@@ left @@'),
        ...(duplicateFile ? [changedFile('src/session.ts', '@@ duplicate @@')] : []),
      ],
    },
    {
      id: `${id}-right-analysis`,
      worktreeId: 'right',
      runId: null,
      task: 'Right task',
      branch: 'feat/right',
      baseBranch: 'main',
      agentKind: 'opencode',
      agentName: 'OpenCode',
      status: 'idle',
      additions: 1,
      deletions: 1,
      independent: false,
      warning: null,
      updatedAt: 2,
      files: [changedFile('src/session.ts', '@@ right @@')],
    },
  ],
  overlaps: [{
    id: `${id}-overlap`,
    leftWorktreeId: 'left',
    rightWorktreeId: 'right',
    risk: 'high',
    category: 'symbol',
    reasonCode: 'same-symbol',
    summary: 'Both agents modified createSession',
    actionable: true,
    targets: [{
      type: 'symbol',
      path: 'src/session.ts',
      symbol: 'createSession',
      leftFilePath: 'src/session.ts',
      rightFilePath: 'src/session.ts',
      reasonCode: 'same-symbol',
      risk: 'high',
    }],
  }],
});

describe('intelligence repository', () => {
  let sqlite: BetterSqlite3.Database;
  let database: BetterSQLite3Database<typeof schema>;

  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(bootstrapSchemaSql);
    sqlite.exec(`
      INSERT INTO repositories (
        id, github_repo_id, owner_login, name, full_name, is_private,
        is_archived, clone_url, html_url, local_clone_status, created_at, updated_at
      ) VALUES (
        'repository-1', -1, 'local', 'repo', 'local/repo', 0,
        0, '', '', 'ready', 0, 0
      );
      INSERT INTO worktrees (
        id, repository_id, name, path, branch_name, base_branch_name,
        status, created_at, updated_at
      ) VALUES
        ('left', 'repository-1', 'left', '/tmp/left', 'feat/left', 'main', 'ready', 0, 0),
        ('right', 'repository-1', 'right', '/tmp/right', 'feat/right', 'main', 'ready', 0, 0);
    `);
    database = drizzle(sqlite, { schema });
  });

  afterEach(() => sqlite.close());

  it('replaces one repository snapshot and reloads normalized children', () => {
    const repository = createIntelligenceRepository(database);
    repository.replaceSnapshot(snapshot('first'));
    repository.replaceSnapshot(snapshot('second'));

    expect(repository.getLatestSnapshot('repository-1')).toMatchObject({
      id: 'second',
      worktrees: [
        expect.objectContaining({ worktreeId: 'left' }),
        expect.objectContaining({ worktreeId: 'right' }),
      ],
      overlaps: [expect.objectContaining({ id: 'second-overlap' })],
    });
    const count = sqlite
      .prepare('SELECT COUNT(*) AS count FROM intelligence_snapshots')
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('rolls back replacement when a child insert fails', () => {
    const repository = createIntelligenceRepository(database);
    repository.replaceSnapshot(snapshot('first'));

    expect(() => repository.replaceSnapshot(snapshot('invalid', true))).toThrow();
    expect(repository.getLatestSnapshot('repository-1')?.id).toBe('first');
  });

  it('loads overlap details and persisted patches for both worktrees', () => {
    const repository = createIntelligenceRepository(database);
    repository.replaceSnapshot(snapshot('first'));

    expect(repository.getOverlap('first-overlap')).toMatchObject({
      overlap: { reasonCode: 'same-symbol' },
      left: { worktreeId: 'left' },
      right: { worktreeId: 'right' },
    });
    expect(repository.compareDiffs('first-overlap')).toMatchObject({
      left: {
        worktreeId: 'left',
        files: [{ patch: '@@ left @@' }],
      },
      right: {
        worktreeId: 'right',
        files: [{ patch: '@@ right @@' }],
      },
    });
  });
});
