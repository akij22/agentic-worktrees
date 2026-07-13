import { describe, expect, it } from 'vitest';

import { editorOpenRequestSchema } from './schemas';

describe('editor IPC schemas', () => {
  it('accepts known editor IDs and a worktree ID', () => {
    expect(
      editorOpenRequestSchema.parse({
        editorId: 'vscode',
        worktreeId: 'worktree-123',
      }),
    ).toEqual({ editorId: 'vscode', worktreeId: 'worktree-123' });
  });

  it('rejects unknown editor IDs', () => {
    expect(() =>
      editorOpenRequestSchema.parse({
        editorId: 'unknown',
        worktreeId: 'worktree-123',
      }),
    ).toThrow();
  });

  it('rejects empty worktree IDs after trimming', () => {
    expect(() =>
      editorOpenRequestSchema.parse({ editorId: 'vscode', worktreeId: '  ' }),
    ).toThrow();
  });

  it('rejects filesystem paths instead of a worktree ID', () => {
    expect(() =>
      editorOpenRequestSchema.parse({
        editorId: 'vscode',
        worktreePath: '/tmp/untrusted-path',
      }),
    ).toThrow();
  });
});
