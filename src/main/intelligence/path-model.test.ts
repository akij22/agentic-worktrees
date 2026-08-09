import { describe, expect, it } from 'vitest';
import {
  deriveModulePath,
  isTypeScriptFamily,
  normalizeGitPath,
  shouldIgnoreIntelligencePath,
} from './path-model';

describe('intelligence path model', () => {
  it('normalizes Git paths and rejects traversal', () => {
    expect(normalizeGitPath('src\\main\\index.ts')).toBe('src/main/index.ts');
    expect(() => normalizeGitPath('../outside.ts')).toThrow('outside');
    expect(() => normalizeGitPath('/absolute.ts')).toThrow('relative');
    expect(() => normalizeGitPath('src/\0secret.ts')).toThrow('NUL');
  });

  it.each([
    '.git/index',
    'node_modules/a.js',
    'dist/app.js',
    'coverage/a.ts',
    '.cache/result.json',
  ])('ignores generated or internal path %s', (filePath) => {
    expect(shouldIgnoreIntelligencePath(filePath)).toBe(true);
  });

  it('keeps regular source paths', () => {
    expect(shouldIgnoreIntelligencePath('src/main/index.ts')).toBe(false);
  });

  it('derives stable feature and process module paths', () => {
    expect(deriveModulePath('src/main/coding-agents/diff-stats.ts')).toBe(
      'src/main/coding-agents',
    );
    expect(
      deriveModulePath('src/renderer/features/dashboard/components/Card.tsx'),
    ).toBe('src/renderer/features/dashboard');
    expect(deriveModulePath('packages/contracts/src/index.ts')).toBe(
      'packages/contracts',
    );
    expect(deriveModulePath('scripts/release.ts')).toBe('scripts');
  });

  it.each(['a.ts', 'a.tsx', 'a.js', 'a.jsx'])('recognizes %s', (filePath) => {
    expect(isTypeScriptFamily(filePath)).toBe(true);
  });

  it.each(['a.json', 'a.md', 'a.css'])('does not parse %s as TypeScript', (filePath) => {
    expect(isTypeScriptFamily(filePath)).toBe(false);
  });
});
