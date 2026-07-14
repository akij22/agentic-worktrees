import { describe, expect, it } from 'vitest';
import type { Repository, Worktree } from '../../../shared/db/schema';
import {
  filterRepositories,
  getRepositoryLabel,
  resolveSelectedRepositoryId,
  resolveSelectedWorktreeId,
} from './dashboard-state';

const repository = (
  overrides: Partial<Repository> & Pick<Repository, 'id' | 'name' | 'fullName'>,
): Repository => ({
  githubRepoId: 1,
  ownerLogin: 'owner',
  defaultBranch: 'main',
  isPrivate: false,
  isArchived: false,
  cloneUrl: 'https://example.com/repository.git',
  sshUrl: null,
  htmlUrl: 'https://example.com/repository',
  localRootPath: null,
  localCloneStatus: 'ready',
  lastLocalScanAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
  ...overrides,
});

const worktree = (
  overrides: Partial<Worktree> & Pick<Worktree, 'id' | 'repositoryId'>,
): Worktree => ({
  name: 'primary',
  path: '/workspace/primary',
  branchName: 'feature/primary',
  baseBranchName: 'main',
  headCommitSha: null,
  status: 'ready',
  activeRunId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSyncedAt: null,
  ...overrides,
});

describe('Dashboard repository workspace state', () => {
  const alpha = repository({
    id: 'alpha',
    name: 'alpha',
    fullName: 'owner/alpha',
  });
  const beta = repository({
    id: 'beta',
    name: 'beta',
    fullName: 'owner/beta',
  });
  const local = repository({
    id: 'local',
    githubRepoId: -1,
    name: 'local-tools',
    fullName: 'local/local-tools',
    localRootPath: '/workspace/local-tools',
  });
  const primary = worktree({ id: 'primary', repositoryId: alpha.id });

  it('filters repositories case-insensitively across names and paths', () => {
    expect(filterRepositories([alpha, beta, local], 'ALPHA')).toEqual([alpha]);
    expect(filterRepositories([alpha, beta, local], 'owner/beta')).toEqual([
      beta,
    ]);
    expect(filterRepositories([alpha, beta, local], 'workspace/local')).toEqual([
      local,
    ]);
  });

  it('keeps a valid repository selection and falls back when it disappears', () => {
    expect(resolveSelectedRepositoryId([alpha, beta], beta.id)).toBe(beta.id);
    expect(resolveSelectedRepositoryId([alpha], beta.id)).toBe(alpha.id);
    expect(resolveSelectedRepositoryId([], alpha.id)).toBeUndefined();
  });

  it('keeps a valid worktree selection and falls back when it disappears', () => {
    expect(resolveSelectedWorktreeId([primary], primary.id)).toBe(primary.id);
    expect(resolveSelectedWorktreeId([primary], 'missing')).toBe(primary.id);
    expect(resolveSelectedWorktreeId([], primary.id)).toBeUndefined();
  });

  it('uses the local name only for local repositories', () => {
    expect(getRepositoryLabel(local)).toBe(local.name);
    expect(getRepositoryLabel(alpha)).toBe(alpha.fullName);
  });
});
