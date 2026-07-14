import { app } from 'electron';
import { join } from 'node:path';
import { Octokit } from 'octokit';
import type {
  GitHubAuthErrorCode,
  GitHubAuthStatusDto,
  GitHubDeviceChallengeDto,
} from '../../shared/ipc/schemas';
import { GITHUB_CONFIG } from './config';
import {
  createElectronGitHubCredentialStore,
  type GitHubCredentialPayload,
  type GitHubCredentialStore,
} from './credential-store';

type GitHubConfig = typeof GITHUB_CONFIG;

interface GitHubAuthServiceDependencies {
  config: GitHubConfig;
  store: GitHubCredentialStore;
  fetch: typeof fetch;
  now: () => number;
  createOctokit: (accessToken: string) => Octokit;
}

interface DeviceAuthorization {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  cancelled: boolean;
  abortController: AbortController;
  cancel: () => void;
  cancellation: Promise<void>;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  token_type: string;
}

interface OAuthErrorResponse {
  error: string;
}

interface CompletionState {
  authorization: DeviceAuthorization;
  promise: Promise<GitHubAuthStatusDto>;
}

export interface GitHubAuthService {
  getStatus(): Promise<GitHubAuthStatusDto>;
  startLogin(): Promise<GitHubDeviceChallengeDto>;
  completeLogin(): Promise<GitHubAuthStatusDto>;
  cancelLogin(): Promise<void>;
  refreshInstallations(): Promise<GitHubAuthStatusDto>;
  logout(): Promise<GitHubAuthStatusDto>;
  retrySession(): Promise<GitHubAuthStatusDto>;
  assertAuthenticated(): Promise<void>;
  onStatusChange(listener: (status: GitHubAuthStatusDto) => void): () => void;
  handleOperationError(error: unknown): Promise<never>;
  getOctokit(): Promise<Octokit>;
  getAccessToken(): Promise<string>;
}

const SIGN_IN_AGAIN_ERROR =
  'GitHub authentication is no longer valid. Please sign in again.';
const SESSION_CHANGED_ERROR =
  'GitHub authentication changed. Please sign in again.';

interface ClassifiedAuthError {
  code: GitHubAuthErrorCode;
  message: string;
  recoverable: boolean;
}

const getErrorStatus = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
};

const classifyAuthError = (error: unknown): ClassifiedAuthError => {
  const record = isRecord(error) ? error : null;
  const rawMessage = record && typeof record.message === 'string'
    ? record.message.toLowerCase()
    : '';
  const headers = record && isRecord(record.response) && isRecord(record.response.headers)
    ? record.response.headers
    : null;
  const networkCodes = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT',
  ]);
  if (error instanceof TypeError ||
      (record && typeof record.code === 'string' && networkCodes.has(record.code))) {
    return {
      code: 'network',
      message: 'GitHub is temporarily unreachable. Check your connection and retry.',
      recoverable: true,
    };
  }
  if (getErrorStatus(error) === 401 || rawMessage.includes('sign in again')) {
    return {
      code: 'session_expired',
      message: 'Your GitHub session expired or was revoked. Sign in again.',
      recoverable: false,
    };
  }
  if (headers && typeof headers['x-github-sso'] === 'string') {
    return {
      code: 'saml_required',
      message: 'Your organization requires an active SAML SSO authorization.',
      recoverable: true,
    };
  }
  if (getErrorStatus(error) === 403 && rawMessage.includes('approval')) {
    return {
      code: 'organization_approval_required',
      message: 'An organization administrator must approve this GitHub App.',
      recoverable: true,
    };
  }
  if (getErrorStatus(error) === 403) {
    return {
      code: 'insufficient_permissions',
      message: 'The GitHub App does not have permission for this operation.',
      recoverable: false,
    };
  }
  if (rawMessage.includes('not configured') || rawMessage.includes('client')) {
    return {
      code: 'publisher_configuration',
      message: 'This build is missing its public GitHub App configuration.',
      recoverable: false,
    };
  }
  return {
    code: 'unknown',
    message: 'GitHub authentication failed. Retry or manage your authorization.',
    recoverable: true,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDeviceCodeResponse = (value: unknown): value is DeviceCodeResponse =>
  isRecord(value) &&
  typeof value.device_code === 'string' &&
  typeof value.user_code === 'string' &&
  typeof value.verification_uri === 'string' &&
  typeof value.expires_in === 'number' &&
  (value.interval === undefined || typeof value.interval === 'number');

const isTokenResponse = (value: unknown): value is TokenResponse =>
  isRecord(value) &&
  typeof value.access_token === 'string' &&
  (value.refresh_token === undefined || typeof value.refresh_token === 'string') &&
  typeof value.expires_in === 'number' &&
  (value.refresh_token_expires_in === undefined ||
    typeof value.refresh_token_expires_in === 'number') &&
  typeof value.token_type === 'string';

const isOAuthErrorResponse = (value: unknown): value is OAuthErrorResponse =>
  isRecord(value) && typeof value.error === 'string';

const getDeviceCodeRequestError = (body: unknown): Error => {
  if (isOAuthErrorResponse(body)) {
    if (body.error === 'device_flow_disabled') {
      return new Error(
        'Device Flow is disabled for this GitHub App. Enable Device Flow in the GitHub App settings and try again.',
      );
    }
    if (body.error === 'incorrect_client_credentials') {
      return new Error(
        'The configured GitHub Client ID is invalid. Copy the Client ID from the GitHub App settings, not the App ID.',
      );
    }
  }
  return new Error(
    'GitHub could not start authorization. Check the GitHub App configuration and try again.',
  );
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error('GitHub returned an invalid authentication response.');
  }
};

const formRequest = (parameters: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams(parameters).toString(),
});

const createCredentials = (
  response: TokenResponse,
  now: number,
  previous?: GitHubCredentialPayload,
): GitHubCredentialPayload => {
  const tokenType = response.token_type.toLowerCase();
  if (tokenType !== 'bearer') {
    throw new Error('GitHub returned an unsupported token type.');
  }

  const refreshToken = response.refresh_token ?? previous?.refreshToken;
  if (!refreshToken) {
    throw new Error('GitHub did not return a refresh token.');
  }

  const refreshTokenExpiresAt = response.refresh_token_expires_in === undefined
    ? previous?.refreshTokenExpiresAt
    : now + response.refresh_token_expires_in * 1_000;
  if (refreshTokenExpiresAt === undefined) {
    throw new Error('GitHub did not return a refresh token expiry.');
  }

  return {
    version: 1,
    accessToken: response.access_token,
    refreshToken,
    accessTokenExpiresAt: now + response.expires_in * 1_000,
    refreshTokenExpiresAt,
    tokenType: 'bearer',
  };
};

export const createGitHubAuthService = (
  dependencies: GitHubAuthServiceDependencies,
): GitHubAuthService => {
  let authorization: DeviceAuthorization | null = null;
  let credentials: GitHubCredentialPayload | null = null;
  let credentialsLoaded = false;
  let authenticatedOctokit: Octokit | null = null;
  let authenticatedToken: string | null = null;
  let refreshPromise: Promise<GitHubCredentialPayload> | null = null;
  let completionState: CompletionState | null = null;
  let credentialMutationQueue: Promise<void> = Promise.resolve();
  let sessionGeneration = 0;
  let cachedStatus: GitHubAuthStatusDto | null = null;
  const statusListeners = new Set<(status: GitHubAuthStatusDto) => void>();

  const publishStatus = (status: GitHubAuthStatusDto): GitHubAuthStatusDto => {
    cachedStatus = status;
    for (const listener of statusListeners) listener(status);
    return status;
  };

  const signedOutStatus = (classified?: ClassifiedAuthError): GitHubAuthStatusDto => ({
    state: 'signed_out',
    profile: null,
    installationCount: 0,
    persistent: dependencies.store.isPersistent(),
    message: classified?.message ?? null,
    errorCode: classified?.code ?? null,
    recoverable: false,
  });

  const requireConfiguration = (): void => {
    if (!dependencies.config.configured) {
      throw new Error('GitHub OAuth is not configured.');
    }
  };

  const loadCredentials = async (): Promise<GitHubCredentialPayload | null> => {
    if (!credentialsLoaded) {
      credentials = await dependencies.store.load();
      credentialsLoaded = true;
    }
    return credentials;
  };

  const enqueueCredentialMutation = <T>(
    mutation: () => Promise<T>,
  ): Promise<T> => {
    const result = credentialMutationQueue.then(mutation, mutation);
    credentialMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const resetCredentialMemory = (): void => {
    credentials = null;
    credentialsLoaded = true;
    authenticatedOctokit = null;
    authenticatedToken = null;
    cachedStatus = null;
  };

  const saveCredentials = (
    payload: GitHubCredentialPayload,
    validate?: () => void,
    clearIfInvalid = false,
  ): Promise<void> =>
    enqueueCredentialMutation(async () => {
      validate?.();
      await dependencies.store.save(payload);
      try {
        validate?.();
      } catch (error) {
        if (clearIfInvalid) {
          resetCredentialMemory();
          try {
            await dependencies.store.clear();
          } catch (cleanupError) {
            console.error('Failed to clear cancelled GitHub credentials', cleanupError);
          }
        }
        throw error;
      }
      credentials = payload;
      credentialsLoaded = true;
      authenticatedOctokit = null;
      authenticatedToken = null;
    });

  const clearCredentials = (): Promise<void> => {
    resetCredentialMemory();
    publishStatus(signedOutStatus());
    return enqueueCredentialMutation(async () => {
      try {
        await dependencies.store.clear();
      } catch (error) {
        console.error('Failed to clear local GitHub credentials', error);
        throw new Error('Unable to clear local GitHub credentials.');
      }
    });
  };

  const waitForPoll = async (
    pending: DeviceAuthorization,
    intervalMs: number,
  ): Promise<void> => {
    const remainingMs = pending.expiresAt - dependencies.now();
    if (remainingMs <= 0) {
      throw new Error('GitHub authorization expired.');
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, Math.min(intervalMs, remainingMs));
      }),
      pending.cancellation,
    ]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }

    if (pending.cancelled) {
      throw new Error('GitHub authorization was cancelled.');
    }
    if (dependencies.now() >= pending.expiresAt) {
      throw new Error('GitHub authorization expired.');
    }
  };

  const ensureAuthorizationActive = (
    pending: DeviceAuthorization,
  ): void => {
    if (pending.cancelled) {
      throw new Error('GitHub authorization was cancelled.');
    }
    if (dependencies.now() >= pending.expiresAt) {
      throw new Error('GitHub authorization expired.');
    }
  };

  const raceAuthorization = async <T>(
    pending: DeviceAuthorization,
    operation: Promise<T>,
  ): Promise<T> => {
    let expirationTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        operation.then((value) => ({ kind: 'value' as const, value })),
        pending.cancellation.then(() => ({ kind: 'cancelled' as const })),
        new Promise<{ kind: 'expired' }>((resolve) => {
          expirationTimeout = setTimeout(
            () => resolve({ kind: 'expired' }),
            Math.max(0, pending.expiresAt - dependencies.now()),
          );
        }),
      ]);

      if (result.kind === 'cancelled') {
        throw new Error('GitHub authorization was cancelled.');
      }
      if (result.kind === 'expired') {
        pending.abortController.abort();
        throw new Error('GitHub authorization expired.');
      }
      ensureAuthorizationActive(pending);
      return result.value;
    } catch (error) {
      ensureAuthorizationActive(pending);
      throw error;
    } finally {
      if (expirationTimeout !== undefined) {
        clearTimeout(expirationTimeout);
      }
    }
  };

  const performRefresh = async (
    current: GitHubCredentialPayload,
  ): Promise<GitHubCredentialPayload> => {
    const refreshGeneration = sessionGeneration;
    if (current.refreshTokenExpiresAt <= dependencies.now()) {
      await clearCredentials().catch(() => undefined);
      throw new Error(SIGN_IN_AGAIN_ERROR);
    }

    const response = await dependencies.fetch(
      `${dependencies.config.webBaseUrl}/login/oauth/access_token`,
      formRequest({
        client_id: dependencies.config.clientId,
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      }),
    );
    const body = await readJson(response);

    if (refreshGeneration !== sessionGeneration) {
      throw new Error(SESSION_CHANGED_ERROR);
    }

    if (isOAuthErrorResponse(body)) {
      if (
        [
          'bad_refresh_token',
          'bad_verification_code',
          'expired_token',
          'incorrect_client_credentials',
          'invalid_grant',
        ].includes(body.error)
      ) {
        await clearCredentials().catch(() => undefined);
        throw new Error(SIGN_IN_AGAIN_ERROR);
      }
      throw new Error('Unable to refresh GitHub authentication.');
    }
    if (!response.ok || !isTokenResponse(body)) {
      throw new Error('Unable to refresh GitHub authentication.');
    }

    const updated = createCredentials(body, dependencies.now(), current);
    if (refreshGeneration !== sessionGeneration) {
      throw new Error(SESSION_CHANGED_ERROR);
    }
    await saveCredentials(updated, () => {
      if (refreshGeneration !== sessionGeneration) {
        throw new Error(SESSION_CHANGED_ERROR);
      }
    });
    return updated;
  };

  const getValidCredentials = async (): Promise<GitHubCredentialPayload> => {
    if (refreshPromise) {
      return refreshPromise;
    }

    const current = await loadCredentials();
    if (!current) {
      throw new Error('GitHub is not signed in.');
    }
    if (
      current.accessTokenExpiresAt >
      dependencies.now() + dependencies.config.refreshSkewMs
    ) {
      return current;
    }
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = performRefresh(current);
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  };

  const getAccessToken = async (): Promise<string> =>
    (await getValidCredentials()).accessToken;

  const getOctokit = async (): Promise<Octokit> => {
    const accessToken = await getAccessToken();
    if (authenticatedOctokit && authenticatedToken === accessToken) {
      return authenticatedOctokit;
    }
    authenticatedOctokit = dependencies.createOctokit(accessToken);
    authenticatedToken = accessToken;
    return authenticatedOctokit;
  };

  const getStatus = async (): Promise<GitHubAuthStatusDto> => {
    if (!dependencies.config.configured) {
      const classified = classifyAuthError(new Error('GitHub OAuth is not configured.'));
      return publishStatus({
        state: 'error', profile: null, installationCount: 0,
        persistent: dependencies.store.isPersistent(),
        message: classified.message, errorCode: classified.code,
        recoverable: classified.recoverable,
      });
    }
    if (authorization && !authorization.cancelled) {
      return publishStatus({
        state: 'authorizing',
        profile: null,
        installationCount: 0,
        persistent: dependencies.store.isPersistent(),
        message: null,
        errorCode: null,
        recoverable: false,
      });
    }

    let stored: GitHubCredentialPayload | null;
    try {
      stored = await loadCredentials();
    } catch (error) {
      const classified = classifyAuthError(error);
      return publishStatus({
        state: 'error', profile: null, installationCount: 0,
        persistent: dependencies.store.isPersistent(),
        message: classified.message, errorCode: classified.code,
        recoverable: classified.recoverable,
      });
    }
    if (!stored) {
      return publishStatus(signedOutStatus());
    }

    try {
      const octokit = await getOctokit();
      const [{ data: user }, installations] = await Promise.all([
        octokit.rest.users.getAuthenticated(),
        octokit.paginate(
          octokit.rest.apps.listInstallationsForAuthenticatedUser,
          { per_page: 100 },
        ),
      ]);
      const installationCount = installations.length;
      return publishStatus({
        state: installationCount === 0
          ? 'installation_required'
          : 'authenticated',
        profile: {
          id: user.id,
          login: user.login,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
        installationCount,
        persistent: dependencies.store.isPersistent(),
        message: null,
        errorCode: null,
        recoverable: false,
      });
    } catch (error) {
      const classified = classifyAuthError(error);
      if (classified.code === 'session_expired') {
        await clearCredentials().catch(() => undefined);
        return publishStatus(signedOutStatus(classified));
      }
      const status: GitHubAuthStatusDto = {
        state: credentials ? 'error' : 'signed_out',
        profile: null,
        installationCount: 0,
        persistent: dependencies.store.isPersistent(),
        message: classified.message,
        errorCode: classified.code,
        recoverable: classified.recoverable,
      };
      return publishStatus(status);
    }
  };

  const cancelAuthorization = (pending: DeviceAuthorization): void => {
    pending.cancelled = true;
    pending.cancel();
    pending.abortController.abort();
  };

  const runCompletion = async (
    pending: DeviceAuthorization,
  ): Promise<GitHubAuthStatusDto> => {
    let intervalMs = pending.intervalMs;
    try {
      for (;;) {
        await waitForPoll(pending, intervalMs);
        const response = await raceAuthorization(
          pending,
          dependencies.fetch(
            `${dependencies.config.webBaseUrl}/login/oauth/access_token`,
            {
              ...formRequest({
                client_id: dependencies.config.clientId,
                device_code: pending.deviceCode,
                grant_type:
                  'urn:ietf:params:oauth:grant-type:device_code',
              }),
              signal: pending.abortController.signal,
            },
          ),
        );
        const body = await raceAuthorization(pending, readJson(response));

        if (!response.ok) {
          throw new Error('GitHub authorization failed.');
        }
        if (isTokenResponse(body)) {
          const payload = createCredentials(body, dependencies.now());
          ensureAuthorizationActive(pending);
          await saveCredentials(
            payload,
            () => ensureAuthorizationActive(pending),
            true,
          );
          ensureAuthorizationActive(pending);
          authorization = null;
          return getStatus();
        }
        if (!isOAuthErrorResponse(body)) {
          throw new Error('GitHub returned an invalid authentication response.');
        }
        if (body.error === 'authorization_pending') {
          continue;
        }
        if (body.error === 'slow_down') {
          intervalMs += 5_000;
          continue;
        }
        if (body.error === 'access_denied') {
          throw new Error('GitHub authorization was denied.');
        }
        if (body.error === 'expired_token') {
          throw new Error('GitHub authorization expired.');
        }
        throw new Error('GitHub authorization failed.');
      }
    } finally {
      if (authorization === pending) {
        authorization = null;
      }
    }
  };

  return {
    getStatus,

    async startLogin() {
      requireConfiguration();
      if (authorization) {
        const previousCompletion =
          completionState?.authorization === authorization
            ? completionState.promise
            : null;
        cancelAuthorization(authorization);
        authorization = null;
        await previousCompletion?.catch(() => undefined);
      }

      const response = await dependencies.fetch(
        `${dependencies.config.webBaseUrl}/login/device/code`,
        formRequest({ client_id: dependencies.config.clientId }),
      );
      const body = await readJson(response);
      if (!response.ok || !isDeviceCodeResponse(body)) {
        throw getDeviceCodeRequestError(body);
      }

      let cancel = (): void => undefined;
      const cancellation = new Promise<void>((resolve) => {
        cancel = resolve;
      });
      authorization = {
        deviceCode: body.device_code,
        expiresAt: dependencies.now() + body.expires_in * 1_000,
        intervalMs: (body.interval ?? 5) * 1_000,
        cancelled: false,
        abortController: new AbortController(),
        cancel,
        cancellation,
      };
      return {
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        expiresAt: authorization.expiresAt,
      };
    },

    completeLogin() {
      requireConfiguration();
      const pending = authorization;
      if (!pending) {
        return Promise.reject(
          new Error('No GitHub authorization is in progress.'),
        );
      }
      if (completionState?.authorization === pending) {
        return completionState.promise;
      }

      const currentCompletion = runCompletion(pending);
      const currentState: CompletionState = {
        authorization: pending,
        promise: currentCompletion,
      };
      completionState = currentState;
      void currentCompletion.then(
        () => {
          if (completionState === currentState) {
            completionState = null;
          }
        },
        () => {
          if (completionState === currentState) {
            completionState = null;
          }
        },
      );
      return currentCompletion;
    },

    async cancelLogin() {
      if (!authorization) {
        return;
      }
      const pending = authorization;
      authorization = null;
      cancelAuthorization(pending);
    },

    refreshInstallations: getStatus,

    async logout() {
      sessionGeneration += 1;
      if (authorization) {
        cancelAuthorization(authorization);
        authorization = null;
      }
      await clearCredentials();
      return signedOutStatus();
    },

    retrySession: getStatus,

    async assertAuthenticated() {
      if (cachedStatus &&
          (cachedStatus.state !== 'authenticated' || cachedStatus.installationCount < 1)) {
        throw new Error('GitHub authentication is required to use this feature.');
      }
      try {
        await getValidCredentials();
      } catch (error) {
        const classified = classifyAuthError(error);
        if (classified.code === 'session_expired') {
          publishStatus(signedOutStatus(classified));
        } else {
          publishStatus({
            state: 'error', profile: null, installationCount: 0,
            persistent: dependencies.store.isPersistent(),
            message: classified.message, errorCode: classified.code,
            recoverable: classified.recoverable,
          });
        }
        throw new Error(classified.message);
      }
      const status = cachedStatus ?? await getStatus();
      if (status.state !== 'authenticated' || status.installationCount < 1) {
        throw new Error('GitHub authentication is required to use this feature.');
      }
    },

    onStatusChange(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    async handleOperationError(error) {
      const classified = classifyAuthError(error);
      if (classified.code === 'session_expired') {
        await clearCredentials().catch(() => undefined);
        publishStatus(signedOutStatus(classified));
      } else {
        publishStatus({
          state: 'error', profile: null, installationCount: 0,
          persistent: dependencies.store.isPersistent(),
          message: classified.message, errorCode: classified.code,
          recoverable: classified.recoverable,
        });
      }
      throw new Error(classified.message);
    },

    getOctokit,
    getAccessToken,
  };
};

let defaultService: GitHubAuthService | null = null;

const getDefaultService = (): GitHubAuthService => {
  if (!defaultService) {
    defaultService = createGitHubAuthService({
      config: GITHUB_CONFIG,
      store: createElectronGitHubCredentialStore(
        join(app.getPath('userData'), 'github-oauth.enc'),
      ),
      fetch: globalThis.fetch,
      now: Date.now,
      createOctokit: (accessToken) =>
        new Octokit({
          auth: accessToken,
          baseUrl: GITHUB_CONFIG.apiBaseUrl,
          userAgent: 'agentic-worktrees',
          request: {
            headers: {
              'X-GitHub-Api-Version': GITHUB_CONFIG.apiVersion,
            },
          },
        }),
    });
  }
  return defaultService;
};

export const githubAuthService: GitHubAuthService = {
  getStatus: () => getDefaultService().getStatus(),
  startLogin: () => getDefaultService().startLogin(),
  completeLogin: () => getDefaultService().completeLogin(),
  cancelLogin: () => getDefaultService().cancelLogin(),
  refreshInstallations: () => getDefaultService().refreshInstallations(),
  logout: () => getDefaultService().logout(),
  retrySession: () => getDefaultService().retrySession(),
  assertAuthenticated: () => getDefaultService().assertAuthenticated(),
  onStatusChange: (listener) => getDefaultService().onStatusChange(listener),
  handleOperationError: (error) => getDefaultService().handleOperationError(error),
  getOctokit: () => getDefaultService().getOctokit(),
  getAccessToken: () => getDefaultService().getAccessToken(),
};

export const getAuthStatus = (): Promise<GitHubAuthStatusDto> =>
  githubAuthService.getStatus();
export const startGitHubLogin = (): Promise<GitHubDeviceChallengeDto> =>
  githubAuthService.startLogin();
export const completeGitHubLogin = (): Promise<GitHubAuthStatusDto> =>
  githubAuthService.completeLogin();
export const cancelGitHubLogin = (): Promise<void> =>
  githubAuthService.cancelLogin();
export const refreshGitHubInstallations = (): Promise<GitHubAuthStatusDto> =>
  githubAuthService.refreshInstallations();
export const logoutFromGitHub = (): Promise<GitHubAuthStatusDto> =>
  githubAuthService.logout();
export const getAuthenticatedOctokit = (): Promise<Octokit> =>
  githubAuthService.getOctokit();
export const getGitHubAccessToken = (): Promise<string> =>
  githubAuthService.getAccessToken();
