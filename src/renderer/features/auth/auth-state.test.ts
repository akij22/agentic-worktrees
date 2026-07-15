import { describe, expect, it } from 'vitest';
import {
  authReducer,
  createInitialAuthState,
  getAuthView,
  getUserFacingAuthActionError,
  getUserFacingAuthFailure,
} from './auth-state';
import type {
  GitHubAuthStatusDto,
  GitHubDeviceChallengeDto,
} from '../../../shared/ipc/schemas';

const status = (
  state: GitHubAuthStatusDto['state'],
): GitHubAuthStatusDto => ({
  state,
  profile:
    state === 'authenticated' || state === 'installation_required'
      ? {
          id: 7,
          login: 'octocat',
          name: 'The Octocat',
          avatarUrl: 'https://avatars.example/octocat.png',
        }
      : null,
  installationCount: state === 'authenticated' ? 2 : 0,
  persistent: true,
  message: null,
  errorCode: null,
  recoverable: false,
});

const challenge: GitHubDeviceChallengeDto = {
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiresAt: 1_800_000,
};

describe('GitHub renderer auth state', () => {
  it('moves startup loading to signed out', () => {
    const next = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('signed_out'),
      operationId: 0,
    });

    expect(next.status.state).toBe('signed_out');
    expect(getAuthView(next)).toBe('sign-in');
  });

  it('moves startup loading to the app after restoring an authenticated session', () => {
    const next = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('authenticated'),
      operationId: 0,
    });

    expect(next.status.state).toBe('authenticated');
    expect(getAuthView(next)).toBe('app');
  });

  it('moves a login challenge to authorizing without private credentials', () => {
    const signedOut = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('signed_out'),
      operationId: 0,
    });
    const next = authReducer(signedOut, {
      type: 'loginStarted',
      challenge,
      operationId: 0,
    });

    expect(next.status.state).toBe('authorizing');
    expect(next.challenge).toEqual(challenge);
    expect(Object.keys(next.challenge ?? {}).sort()).toEqual([
      'expiresAt',
      'userCode',
      'verificationUri',
    ]);
    expect(getAuthView(next)).toBe('authorization');
  });

  it('mounts the app only for an authenticated status', () => {
    const next = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('authenticated'),
      operationId: 0,
    });

    expect(getAuthView(next)).toBe('app');
  });

  it('shows the installation action for installation-required status', () => {
    const next = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('installation_required'),
      operationId: 0,
    });

    expect(getAuthView(next)).toBe('installation');
  });

  it('returns to signed out after logout', () => {
    const authenticated = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('authenticated'),
      operationId: 0,
    });
    const next = authReducer(authenticated, {
      type: 'loggedOut',
      status: status('signed_out'),
      operationId: 0,
    });

    expect(next.status.state).toBe('signed_out');
    expect(next.challenge).toBeNull();
    expect(getAuthView(next)).toBe('sign-in');
  });

  it('applies a pushed session invalidation even while another operation is active', () => {
    const authenticated = authReducer(createInitialAuthState(), {
      type: 'statusResolved', status: status('authenticated'), operationId: 0,
    });
    const busy = authReducer(authenticated, { type: 'operationStarted', operationId: 4 });
    const invalidated = authReducer(busy, {
      type: 'statusChanged', status: status('signed_out'),
    });
    expect(invalidated.status.state).toBe('signed_out');
    expect(invalidated.busy).toBe(false);
    expect(getAuthView(invalidated)).toBe('sign-in');
  });

  it('keeps a recoverable network error in retry-existing-session state', () => {
    const next = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: { ...status('error'), errorCode: 'network', recoverable: true },
      operationId: 0,
    });
    expect(getAuthView(next)).toBe('error');
    expect(next.status.recoverable).toBe(true);
  });

  it('falls back to signed out after a terminal refresh failure', () => {
    const authorizing = authReducer(createInitialAuthState(), {
      type: 'loginStarted',
      challenge,
      operationId: 0,
    });
    const next = authReducer(authorizing, {
      type: 'terminalFailure',
      message: 'GitHub authorization expired.',
      operationId: 0,
    });

    expect(next.status.state).toBe('signed_out');
    expect(next.challenge).toBeNull();
    expect(next.error).toBe('GitHub authorization expired.');
    expect(getAuthView(next)).toBe('sign-in');
  });

  it('ignores a late installation refresh after logout has started', () => {
    const authenticated = authReducer(createInitialAuthState(), {
      type: 'statusResolved',
      status: status('authenticated'),
      operationId: 0,
    });
    const refreshing = authReducer(authenticated, {
      type: 'operationStarted',
      operationId: 1,
    });
    const loggingOut = authReducer(refreshing, {
      type: 'operationStarted',
      operationId: 2,
    });
    const loggedOut = authReducer(loggingOut, {
      type: 'loggedOut',
      status: status('signed_out'),
      operationId: 2,
    });
    const lateRefresh = authReducer(loggedOut, {
      type: 'statusResolved',
      status: status('authenticated'),
      operationId: 1,
    });

    expect(lateRefresh.status.state).toBe('signed_out');
    expect(getAuthView(lateRefresh)).toBe('sign-in');
  });

  it('maps rejected renderer actions to concise user-facing feedback', () => {
    expect(getUserFacingAuthActionError('clipboard')).toBe(
      'Could not copy the code. Copy it manually and try again.',
    );
    expect(getUserFacingAuthActionError('external')).toBe(
      'Could not open GitHub. Try again.',
    );
  });

  it('removes Electron IPC framing from an authentication failure', () => {
    expect(getUserFacingAuthFailure(
      new Error(
        "Error invoking remote method 'github:auth-start': Error: Device Flow is disabled for this GitHub App.",
      ),
    )).toBe('Device Flow is disabled for this GitHub App.');
  });
});
