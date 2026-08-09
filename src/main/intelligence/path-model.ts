import path from 'node:path';

const IGNORED_ROOTS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const TYPESCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

export const normalizeGitPath = (value: string): string => {
  if (value.includes('\0')) {
    throw new Error('Git path must not contain a NUL character.');
  }

  const slashPath = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(slashPath)) {
    throw new Error('Git path must be repository relative.');
  }

  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized === '.' ||
    normalized.length === 0
  ) {
    throw new Error('Git path resolves outside the worktree.');
  }

  return normalized;
};

export const shouldIgnoreIntelligencePath = (value: string): boolean => {
  const normalized = normalizeGitPath(value);
  return normalized.split('/').some((segment) => IGNORED_ROOTS.has(segment));
};

export const deriveModulePath = (value: string): string => {
  const normalized = normalizeGitPath(value);
  const directorySegments = normalized.split('/').slice(0, -1);
  if (directorySegments.length === 0) return '.';

  if (
    directorySegments[0] === 'src' &&
    ['main', 'renderer', 'shared'].includes(directorySegments[1] ?? '')
  ) {
    if (directorySegments[2] === 'features' && directorySegments[3]) {
      return directorySegments.slice(0, 4).join('/');
    }
    if (directorySegments[2]) {
      return directorySegments.slice(0, 3).join('/');
    }
  }

  if (
    ['apps', 'packages'].includes(directorySegments[0]) &&
    directorySegments[1]
  ) {
    return directorySegments.slice(0, 2).join('/');
  }

  return directorySegments.join('/');
};

export const isTypeScriptFamily = (value: string): boolean =>
  TYPESCRIPT_EXTENSIONS.has(path.posix.extname(normalizeGitPath(value)).toLowerCase());
