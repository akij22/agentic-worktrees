import { Octokit } from 'octokit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GitHubCredentialPayload,
  GitHubCredentialStore,
} from './credential-store';
import { createGitHubAuthService } from './auth-service';

const now = 1_800_000_000_000;

const credentials: GitHubCredentialPayload = {
  version: 1,
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  accessTokenExpiresAt: now + 60_000,
  refreshTokenExpiresAt: now + 86_400_000,
  tokenType: 'bearer',
};

const config = {
  clientId: 'client-id',
  appSlug: 'agentic-worktrees',
  apiBaseUrl: 'https://api.github.com',
  webBaseUrl: 'https://github.com',
  apiVersion: '2026-03-10',
  refreshSkewMs: 5 * 60 * 1000,
  configured: true,
} as const;

const jsonResponse = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const deferredJsonResponse = () => {
  let resolveBody: ((body: object) => void) | undefined;
  const body = new Promise<object>((resolve) => {
    resolveBody = resolve;
  });
  const response = jsonResponse({});
  vi.spyOn(response, 'json').mockReturnValue(body);
  return { response, resolveBody: (value: object) => resolveBody?.(value) };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

const createStore = (loaded: GitHubCredentialPayload | null = null) => ({
  load: vi.fn<GitHubCredentialStore['load']>().mockResolvedValue(loaded),
  save: vi.fn<GitHubCredentialStore['save']>().mockResolvedValue(undefined),
  clear: vi.fn<GitHubCredentialStore['clear']>().mockResolvedValue(undefined),
  isPersistent: vi.fn<GitHubCredentialStore['isPersistent']>().mockReturnValue(true),
});

const createOctokit = () => {
  const octokit = new Octokit({ auth: 'test-token' });
  vi.spyOn(octokit.rest.users, 'getAuthenticated').mockResolvedValue({
    data: {
      id: 7,
      login: 'octocat',
      name: 'Octo Cat',
      avatar_url: 'https://avatars.example/octocat.png',
    },
  } as never);
  vi.spyOn(octokit, 'paginate').mockResolvedValue([
    { id: 10 },
    { id: 11 },
  ] as never);
  return octokit;
};

const createService = (
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  store = createStore(),
  octokitFactory = vi.fn(() => createOctokit()),
) => {
  return {
    service: createGitHubAuthService({
      config,
      store,
      fetch: fetchMock,
      now: () => Date.now(),
      createOctokit: octokitFactory,
    }),
    octokitFactory,
    store,
  };
};

const deviceChallenge = {
  device_code: 'private-device-code',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 2,
};

const successfulToken = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  expires_in: 28_800,
  refresh_token_expires_in: 15_552_000,
  token_type: 'bearer',
};

describe('GitHub authentication service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a cached authenticated assertion without repeating profile discovery', async () => {
    const octokit = createOctokit();
    const { service } = createService(
      vi.fn<typeof fetch>(),
      createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 }),
      vi.fn(() => octokit),
    );

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'authenticated' });
    await expect(service.assertAuthenticated()).resolves.toBeUndefined();
    await expect(service.assertAuthenticated()).resolves.toBeUndefined();

    expect(octokit.rest.users.getAuthenticated).toHaveBeenCalledOnce();
    expect(octokit.paginate).toHaveBeenCalledOnce();
  });

  it.each(['signed_out', 'installation_required'] as const)(
    'rejects application access while status is %s',
    async (expectedState) => {
      const octokit = createOctokit();
      if (expectedState === 'installation_required') {
        vi.mocked(octokit.paginate).mockResolvedValue([] as never);
      }
      const store = expectedState === 'signed_out'
        ? createStore()
        : createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 });
      const { service } = createService(vi.fn<typeof fetch>(), store, vi.fn(() => octokit));

      await expect(service.getStatus()).resolves.toMatchObject({ state: expectedState });
      await expect(service.assertAuthenticated()).rejects.toThrow(
        'GitHub authentication is required',
      );
    },
  );

  it('invalidates memory and cached client even when logout persistence cleanup fails', async () => {
    const store = createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 });
    store.clear.mockRejectedValueOnce(new Error('unlink failed'));
    const octokitFactory = vi.fn(() => createOctokit());
    const { service } = createService(vi.fn<typeof fetch>(), store, octokitFactory);
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'authenticated' });

    await expect(service.logout()).rejects.toThrow('Unable to clear local GitHub credentials.');
    await expect(service.assertAuthenticated()).rejects.toThrow();
    await expect(service.getAccessToken()).rejects.toThrow('not signed in');
    expect(octokitFactory).toHaveBeenCalledOnce();
  });

  it('invalidates a cancelled login token even when cleanup fails', async () => {
    let resolveSave: (() => void) | undefined;
    const store = createStore();
    store.save.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    store.clear.mockRejectedValueOnce(new Error('unlink failed'));
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service } = createService(fetchMock, store);
    await service.startLogin();
    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    await service.cancelLogin();
    resolveSave?.();

    await expect(outcome).resolves.toEqual(new Error('GitHub authorization was cancelled.'));
    await expect(service.getAccessToken()).rejects.toThrow('not signed in');
  });

  it('classifies a temporary network failure and retries the existing session', async () => {
    const octokit = createOctokit();
    vi.mocked(octokit.rest.users.getAuthenticated)
      .mockRejectedValueOnce(new TypeError('secret network detail'))
      .mockResolvedValueOnce({ data: {
        id: 7, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://avatars.example/octocat.png',
      } } as never);
    const { service } = createService(
      vi.fn<typeof fetch>(),
      createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 }),
      vi.fn(() => octokit),
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'error', errorCode: 'network', recoverable: true,
      message: 'GitHub is temporarily unreachable. Check your connection and retry.',
    });
    await expect(service.retrySession()).resolves.toMatchObject({ state: 'authenticated' });
  });

  it.each([
    [{ status: 403, response: { headers: { 'x-github-sso': 'required' } } }, 'saml_required'],
    [{ status: 403, message: 'organization approval required' }, 'organization_approval_required'],
    [{ status: 403, message: 'Resource not accessible by integration' }, 'insufficient_permissions'],
  ] as const)('classifies policy failures without exposing raw details', async (failure, errorCode) => {
    const octokit = createOctokit();
    vi.mocked(octokit.rest.users.getAuthenticated).mockRejectedValueOnce(failure);
    const { service } = createService(
      vi.fn<typeof fetch>(),
      createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 }),
      vi.fn(() => octokit),
    );
    const status = await service.getStatus();
    expect(status).toMatchObject({ state: 'error', errorCode });
    expect(status.message).not.toContain('Resource not accessible');
  });

  it('reports an unconfigured publisher build as a structured terminal status', async () => {
    const store = createStore();
    const service = createGitHubAuthService({
      config: { ...config, configured: false },
      store,
      fetch: vi.fn<typeof fetch>(),
      now: () => Date.now(),
      createOctokit: vi.fn(() => createOctokit()),
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'error',
      errorCode: 'publisher_configuration',
      recoverable: false,
    });
  });

  it('explains how to enable Device Flow when GitHub rejects the authorization request', async () => {
    const { service } = createService(
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({ error: 'device_flow_disabled' }, 400),
      ),
    );

    await expect(service.startLogin()).rejects.toThrow(
      'Device Flow is disabled for this GitHub App. Enable Device Flow in the GitHub App settings and try again.',
    );
  });

  it('explains when the configured Client ID is not a GitHub App Client ID', async () => {
    const { service } = createService(
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({ error: 'incorrect_client_credentials' }, 401),
      ),
    );

    await expect(service.startLogin()).rejects.toThrow(
      'The configured GitHub Client ID is invalid. Copy the Client ID from the GitHub App settings, not the App ID.',
    );
  });

  it('turns credential load failures into an unknown sanitized status', async () => {
    const store = createStore();
    store.load.mockRejectedValueOnce(new Error('private filesystem path'));
    const { service } = createService(vi.fn<typeof fetch>(), store);
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'error', errorCode: 'unknown', recoverable: true,
      message: 'GitHub authentication failed. Retry or manage your authorization.',
    });
  });

  it('clears and broadcasts a revoked API session', async () => {
    const octokit = createOctokit();
    vi.mocked(octokit.rest.users.getAuthenticated).mockRejectedValueOnce({
      status: 401,
      message: 'raw revoked token detail',
    });
    const store = createStore({ ...credentials, accessTokenExpiresAt: now + 3_600_000 });
    const { service } = createService(vi.fn<typeof fetch>(), store, vi.fn(() => octokit));
    const listener = vi.fn();
    service.onStatusChange(listener);

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_out', errorCode: 'session_expired', recoverable: false,
    });
    expect(store.clear).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'signed_out', errorCode: 'session_expired',
    }));
  });

  it('sanitizes and broadcasts policy failures raised after the access gate', async () => {
    const { service } = createService(vi.fn<typeof fetch>());
    const listener = vi.fn();
    service.onStatusChange(listener);
    await expect(service.handleOperationError({
      status: 403,
      message: 'secret Resource not accessible by integration detail',
    })).rejects.toThrow('does not have permission');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      state: 'error', errorCode: 'insufficient_permissions',
    }));
  });

  it('sanitizes Octokit transport errors raised after the access gate', async () => {
    const { service } = createService(vi.fn<typeof fetch>());
    const failure = Object.assign(new Error('getaddrinfo secret-host'), {
      code: 'ENOTFOUND',
    });
    await expect(service.handleOperationError(failure)).rejects.toThrow(
      'GitHub is temporarily unreachable',
    );
    await expect(service.handleOperationError(failure)).rejects.not.toThrow(
      'secret-host',
    );
  });

  it('starts Device Flow with form encoding and completes a successful login', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service, store, octokitFactory } = createService(fetchMock);

    await expect(service.startLogin()).resolves.toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: now + 900_000,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/device/code',
      expect.objectContaining({ method: 'POST' }),
    );
    const startRequest = fetchMock.mock.calls[0]?.[1];
    expect(startRequest?.headers).toEqual(
      expect.objectContaining({ Accept: 'application/json' }),
    );
    expect(startRequest?.body).toBe('client_id=client-id');

    const completion = service.completeLogin();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(completion).resolves.toEqual({
      state: 'authenticated',
      profile: {
        id: 7,
        login: 'octocat',
        name: 'Octo Cat',
        avatarUrl: 'https://avatars.example/octocat.png',
      },
      installationCount: 2,
      persistent: true,
      message: null,
      errorCode: null,
      recoverable: false,
    });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      'client_id=client-id&device_code=private-device-code&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
    );
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    );
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      octokitFactory.mock.invocationCallOrder[0],
    );
  });

  it('waits the server interval again after authorization_pending', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(completion).resolves.toMatchObject({ state: 'authenticated' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares one polling loop between concurrent completion callers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const first = service.completeLogin();
    const second = service.completeLogin();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: 'authenticated' }),
      expect.objectContaining({ state: 'authenticated' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('does not reuse an old completion tail for a newly started challenge', async () => {
    let resolveProfile: (() => void) | undefined;
    const profilePending = new Promise<void>((resolve) => {
      resolveProfile = resolve;
    });
    const firstOctokit = createOctokit();
    vi.mocked(firstOctokit.rest.users.getAuthenticated).mockImplementation(
      async () => {
        await profilePending;
        return {
          data: {
            id: 7,
            login: 'octocat',
            name: 'Octo Cat',
            avatar_url: 'https://avatars.example/octocat.png',
          },
        } as never;
      },
    );
    const octokitFactory = vi
      .fn(() => createOctokit())
      .mockReturnValueOnce(firstOctokit);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken))
      .mockResolvedValueOnce(
        jsonResponse({ ...deviceChallenge, device_code: 'second-device-code' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...successfulToken,
          access_token: 'second-access',
          refresh_token: 'second-refresh',
        }),
      );
    const { service, store } = createService(
      fetchMock,
      createStore(),
      octokitFactory,
    );
    await service.startLogin();
    const firstCompletion = service.completeLogin();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.save).toHaveBeenCalledOnce();

    await service.startLogin();
    const secondCompletion = service.completeLogin();
    expect(secondCompletion).not.toBe(firstCompletion);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(secondCompletion).resolves.toMatchObject({
      state: 'authenticated',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(store.save).toHaveBeenCalledTimes(2);
    resolveProfile?.();
    await expect(firstCompletion).resolves.toMatchObject({
      state: 'authenticated',
    });
  });

  it('adds five seconds to the polling interval after slow_down', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(completion).resolves.toMatchObject({ state: 'authenticated' });
  });

  it('reports authorization denial without exposing the endpoint description', async () => {
    const returnedSecret = 'secret-returned-in-description';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'access_denied', error_description: returnedSecret }),
      );
    const { service } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);

    const error = await outcome;
    expect(error).toEqual(new Error('GitHub authorization was denied.'));
    expect(String(error)).not.toContain(returnedSecret);
  });

  it('stops polling when the Device Flow challenge expires', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...deviceChallenge, expires_in: 3 }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }));
    const { service } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization expired.'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight Device Flow poll', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge));
    const { service } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    await service.cancelLogin();

    await expect(completion).rejects.toThrow('GitHub authorization was cancelled.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not persist a token when cancellation happens during a token request', async () => {
    const tokenResponse = new Promise<Response>(() => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockReturnValueOnce(tokenResponse);
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await service.cancelLogin();

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization was cancelled.'),
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('does not persist a token when the challenge expires during a token request', async () => {
    const tokenResponse = new Promise<Response>(() => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...deviceChallenge, expires_in: 3 }),
      )
      .mockReturnValueOnce(tokenResponse);
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization expired.'),
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('cancels while a fetched token response body is still pending', async () => {
    const deferred = deferredJsonResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(deferred.response);
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    await service.cancelLogin();

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization was cancelled.'),
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('clears a Device Flow token when cancellation happens during persistence', async () => {
    let resolveSave: (() => void) | undefined;
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const store = createStore();
    store.save.mockReturnValueOnce(savePending);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service } = createService(fetchMock, store);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.save).toHaveBeenCalledOnce();
    await service.cancelLogin();
    resolveSave?.();

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization was cancelled.'),
    );
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.clear.mock.invocationCallOrder[0],
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_out',
    });
  });

  it('expires while a fetched token response body is still pending', async () => {
    const deferred = deferredJsonResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...deviceChallenge, expires_in: 3 }),
      )
      .mockResolvedValueOnce(deferred.response);
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization expired.'),
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('clears a Device Flow token when expiry happens during persistence', async () => {
    let resolveSave: (() => void) | undefined;
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const store = createStore();
    store.save.mockReturnValueOnce(savePending);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ ...deviceChallenge, expires_in: 3 }),
      )
      .mockResolvedValueOnce(jsonResponse(successfulToken));
    const { service } = createService(fetchMock, store);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.save).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    resolveSave?.();

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization expired.'),
    );
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.clear.mock.invocationCallOrder[0],
    );
  });

  it('rejects a token-shaped Device Flow body from an unsuccessful response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(deviceChallenge))
      .mockResolvedValueOnce(jsonResponse(successfulToken, 400));
    const { service, store } = createService(fetchMock);
    await service.startLogin();

    const completion = service.completeLogin();
    const outcome = completion.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(outcome).resolves.toEqual(
      new Error('GitHub authorization failed.'),
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('refreshes an access token inside the configured expiry skew', async () => {
    const store = createStore(credentials);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...successfulToken,
        refresh_token: 'rotated-refresh',
      }),
    );
    const { service } = createService(fetchMock, store);

    await expect(service.getAccessToken()).resolves.toBe('new-access');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'application/json' }),
        body: 'client_id=client-id&grant_type=refresh_token&refresh_token=old-refresh',
      }),
    );
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'rotated-refresh' }),
    );
  });

  it('shares one refresh request between concurrent token callers', async () => {
    const store = createStore(credentials);
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response);
    const { service } = createService(fetchMock, store);

    const first = service.getAccessToken();
    const second = service.getAccessToken();
    await Promise.resolve();
    await Promise.resolve();
    resolveResponse?.(jsonResponse(successfulToken));

    await expect(Promise.all([first, second])).resolves.toEqual([
      'new-access',
      'new-access',
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('does not persist an in-flight refresh after logout', async () => {
    const store = createStore(credentials);
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response);
    const { service } = createService(fetchMock, store);

    const refresh = service.getAccessToken();
    const refreshOutcome = refresh.catch((error: unknown) => error);
    await Promise.resolve();
    await Promise.resolve();
    await expect(service.logout()).resolves.toMatchObject({ state: 'signed_out' });
    resolveResponse?.(jsonResponse(successfulToken));

    await expect(refreshOutcome).resolves.toEqual(
      new Error('GitHub authentication changed. Please sign in again.'),
    );
    expect(store.save).not.toHaveBeenCalled();
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_out',
    });
  });

  it('makes logout clearing the final mutation when refresh save is pending', async () => {
    let resolveSave: (() => void) | undefined;
    const savePending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const store = createStore(credentials);
    store.save.mockReturnValueOnce(savePending);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(successfulToken));
    const { service } = createService(fetchMock, store);

    const refresh = service.getAccessToken();
    const refreshOutcome = refresh.catch((error: unknown) => error);
    await flushMicrotasks();
    expect(store.save).toHaveBeenCalledOnce();
    const logout = service.logout();
    expect(store.clear).not.toHaveBeenCalled();
    resolveSave?.();

    await expect(logout).resolves.toMatchObject({ state: 'signed_out' });
    await expect(refreshOutcome).resolves.toEqual(
      new Error('GitHub authentication changed. Please sign in again.'),
    );
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.clear.mock.invocationCallOrder[0],
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_out',
    });
  });

  it('clears credentials after an invalid refresh without exposing returned values', async () => {
    const returnedSecret = 'server-returned-token-value';
    const store = createStore(credentials);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        error: 'bad_refresh_token',
        error_description: returnedSecret,
        access_token: returnedSecret,
      }),
    );
    const { service } = createService(fetchMock, store);

    const refresh = service.getAccessToken();

    await expect(refresh).rejects.toThrow('Please sign in again.');
    await expect(refresh).rejects.not.toThrow(returnedSecret);
    expect(store.clear).toHaveBeenCalledOnce();
  });
});
