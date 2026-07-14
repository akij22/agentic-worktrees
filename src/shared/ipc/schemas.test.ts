import { describe, expect, it } from 'vitest';

import {
  editorOpenRequestSchema,
  githubAuthStatusSchema,
  githubDeviceChallengeSchema,
} from './schemas';

describe('GitHub authentication IPC schemas', () => {
  it('accepts structured sanitized authentication errors', () => {
    expect(
      githubAuthStatusSchema.parse({
        state: 'error',
        profile: null,
        installationCount: 0,
        persistent: true,
        message: 'GitHub is temporarily unreachable.',
        errorCode: 'network',
        recoverable: true,
        accessToken: 'must-not-cross-ipc',
      }),
    ).toEqual({
      state: 'error',
      profile: null,
      installationCount: 0,
      persistent: true,
      message: 'GitHub is temporarily unreachable.',
      errorCode: 'network',
      recoverable: true,
    });
  });
  it('accepts a public authentication profile and strips token fields', () => {
    expect(
      githubAuthStatusSchema.parse({
        state: 'authenticated',
        profile: {
          id: 1,
          login: 'octocat',
          name: 'Mona',
          avatarUrl: 'https://example.test/a.png',
        },
        installationCount: 1,
        persistent: true,
        accessToken: 'must-not-cross-ipc',
      }),
    ).not.toHaveProperty('accessToken');
  });

  it('accepts only the public device challenge fields', () => {
    expect(
      githubDeviceChallengeSchema.parse({
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 1_800_000,
      }),
    ).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 1_800_000,
    });
  });
});

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
