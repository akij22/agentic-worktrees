import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    decryptStringAsync: vi.fn(),
    encryptStringAsync: vi.fn(),
    getSelectedStorageBackend: vi.fn(),
    isAsyncEncryptionAvailable: vi.fn(),
  },
}));

import {
  createGitHubCredentialStore,
  type GitHubCredentialPayload,
} from './credential-store';

const credentials: GitHubCredentialPayload = {
  version: 1,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: 1_800_000_000_000,
  refreshTokenExpiresAt: 1_900_000_000_000,
  tokenType: 'bearer',
};

type StorageBackend =
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'unknown';

const createDependencies = () => ({
  credentialPath: '/user-data/github-oauth.enc',
  platform: 'darwin' as NodeJS.Platform,
  getStorageBackend: vi.fn<() => StorageBackend>(() => 'unknown'),
  isEncryptionAvailable: vi.fn().mockResolvedValue(true),
  encrypt: vi.fn((plainText: string) =>
    Promise.resolve(Buffer.from(`encrypted:${plainText}`)),
  ),
  decrypt: vi.fn((encrypted: Buffer) =>
    Promise.resolve({
      result: encrypted.toString().replace('encrypted:', ''),
      shouldReEncrypt: false,
    }),
  ),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn(),
});

const createStatefulDependencies = () => {
  const files = new Map<string, Buffer>();
  const dependencies = createDependencies();
  dependencies.readFile.mockImplementation((filePath: string) => {
    const contents = files.get(filePath);
    if (!contents) {
      return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    }
    return Promise.resolve(contents);
  });
  dependencies.writeFile.mockImplementation(
    (filePath: string, contents: Buffer) => {
      files.set(filePath, Buffer.from(contents));
      return Promise.resolve();
    },
  );
  dependencies.rename.mockImplementation((oldPath: string, newPath: string) => {
    const contents = files.get(oldPath);
    if (!contents) {
      return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    }
    files.set(newPath, contents);
    files.delete(oldPath);
    return Promise.resolve();
  });
  dependencies.unlink.mockImplementation((filePath: string) => {
    if (!files.delete(filePath)) {
      return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    }
    return Promise.resolve();
  });
  return { dependencies, files };
};

describe('GitHub credential store', () => {
  it('encrypts credentials and atomically replaces the credential file', async () => {
    const dependencies = createDependencies();
    const store = createGitHubCredentialStore(dependencies);

    await store.save(credentials);

    const serialized = JSON.stringify(credentials);
    expect(dependencies.encrypt).toHaveBeenCalledWith(serialized);
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc.tmp',
      Buffer.from(`encrypted:${serialized}`),
      { mode: 0o600 },
    );
    expect(dependencies.rename).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc.tmp',
      '/user-data/github-oauth.enc',
    );
    expect(dependencies.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.rename.mock.invocationCallOrder[0],
    );
    expect(store.isPersistent()).toBe(true);
  });

  it('decrypts and validates stored credentials', async () => {
    const dependencies = createDependencies();
    const encrypted = Buffer.from('encrypted-credentials');
    dependencies.readFile.mockResolvedValue(encrypted);
    dependencies.decrypt.mockResolvedValue({
      result: JSON.stringify(credentials),
      shouldReEncrypt: false,
    });
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).resolves.toEqual(credentials);

    expect(dependencies.readFile).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc',
    );
    expect(dependencies.decrypt).toHaveBeenCalledWith(encrypted);
    expect(dependencies.logError).not.toHaveBeenCalled();
  });

  it('round trips encrypted credentials through a stateful filesystem', async () => {
    const { dependencies, files } = createStatefulDependencies();
    const savingStore = createGitHubCredentialStore(dependencies);

    await savingStore.save(credentials);
    const loadingStore = createGitHubCredentialStore(dependencies);

    await expect(loadingStore.load()).resolves.toEqual(credentials);
    expect(files.get('/user-data/github-oauth.enc')?.toString()).toBe(
      `encrypted:${JSON.stringify(credentials)}`,
    );
    expect(files.has('/user-data/github-oauth.enc.tmp')).toBe(false);
  });

  it('obtains migrated plaintext once and atomically re-encrypts it', async () => {
    const { dependencies, files } = createStatefulDependencies();
    const migratedCredentials: GitHubCredentialPayload = {
      ...credentials,
      accessToken: 'migrated-access-token',
    };
    const legacyCiphertext = Buffer.from('legacy-ciphertext');
    files.set('/user-data/github-oauth.enc', legacyCiphertext);
    dependencies.decrypt
      .mockResolvedValueOnce({
        result: JSON.stringify(credentials),
        shouldReEncrypt: true,
      })
      .mockResolvedValueOnce({
        result: JSON.stringify(migratedCredentials),
        shouldReEncrypt: false,
      });
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).resolves.toEqual(migratedCredentials);

    expect(dependencies.decrypt).toHaveBeenCalledTimes(2);
    expect(dependencies.decrypt).toHaveBeenNthCalledWith(1, legacyCiphertext);
    expect(dependencies.decrypt).toHaveBeenNthCalledWith(2, legacyCiphertext);
    expect(dependencies.encrypt).toHaveBeenCalledOnce();
    expect(dependencies.encrypt).toHaveBeenCalledWith(
      JSON.stringify(migratedCredentials),
    );
    expect(files.get('/user-data/github-oauth.enc')?.toString()).toBe(
      `encrypted:${JSON.stringify(migratedCredentials)}`,
    );
  });

  it('limits key-rotation decryption to one migration retry', async () => {
    const { dependencies, files } = createStatefulDependencies();
    files.set('/user-data/github-oauth.enc', Buffer.from('legacy-ciphertext'));
    dependencies.decrypt.mockResolvedValue({
      result: JSON.stringify(credentials),
      shouldReEncrypt: true,
    });
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).resolves.toEqual(credentials);

    expect(dependencies.decrypt).toHaveBeenCalledTimes(2);
    expect(dependencies.encrypt).toHaveBeenCalledOnce();
  });

  it('removes corrupt credentials, logs the cause, and requests reauthentication', async () => {
    const dependencies = createDependencies();
    dependencies.readFile.mockResolvedValue(Buffer.from('ciphertext'));
    dependencies.decrypt.mockResolvedValue({
      result: JSON.stringify({ ...credentials, tokenType: 'mac' }),
      shouldReEncrypt: false,
    });
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).rejects.toThrow(
      'GitHub credentials are invalid. Please sign in again.',
    );

    expect(dependencies.logError).toHaveBeenCalledOnce();
    expect(dependencies.unlink).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc',
    );
  });

  it('does not include decrypted credential content in corruption logs', async () => {
    const dependencies = createDependencies();
    dependencies.readFile.mockResolvedValue(Buffer.from('ciphertext'));
    dependencies.decrypt.mockResolvedValue({
      result: `{"accessToken":"${credentials.accessToken}" invalid}`,
      shouldReEncrypt: false,
    });
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).rejects.toThrow(
      'GitHub credentials are invalid. Please sign in again.',
    );

    const loggedValues = dependencies.logError.mock.calls.flatMap((call) =>
      call.map((value) => (value instanceof Error ? value.message : String(value))),
    );
    expect(loggedValues.join(' ')).not.toContain(credentials.accessToken);
    expect(dependencies.logError.mock.calls[0]?.[1]).toEqual(
      new Error('Stored GitHub credential payload cannot be parsed'),
    );
  });

  it('treats a missing credential file as signed out', async () => {
    const dependencies = createDependencies();
    const missingFileError = Object.assign(new Error('missing'), {
      code: 'ENOENT',
    });
    dependencies.readFile.mockRejectedValue(missingFileError);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).resolves.toBeNull();

    expect(dependencies.unlink).not.toHaveBeenCalled();
    expect(dependencies.logError).not.toHaveBeenCalled();
  });

  it('keeps Linux basic_text credentials in memory only', async () => {
    const dependencies = createDependencies();
    dependencies.platform = 'linux';
    dependencies.getStorageBackend.mockReturnValue('basic_text');
    const store = createGitHubCredentialStore(dependencies);

    await store.save(credentials);

    expect(store.isPersistent()).toBe(false);
    expect(dependencies.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(dependencies.encrypt).not.toHaveBeenCalled();
    expect(dependencies.writeFile).not.toHaveBeenCalled();
    expect(dependencies.unlink).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc',
    );
    await expect(store.load()).resolves.toEqual(credentials);
    expect(dependencies.readFile).not.toHaveBeenCalled();
  });

  it('keeps credentials in memory when asynchronous encryption is unavailable', async () => {
    const dependencies = createDependencies();
    dependencies.isEncryptionAvailable.mockResolvedValue(false);
    const store = createGitHubCredentialStore(dependencies);

    await store.save(credentials);

    expect(store.isPersistent()).toBe(false);
    expect(dependencies.writeFile).not.toHaveBeenCalled();
    expect(dependencies.unlink).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc',
    );
    await expect(store.load()).resolves.toEqual(credentials);
  });

  it('removes stale persisted credentials before using memory-only storage', async () => {
    const { dependencies, files } = createStatefulDependencies();
    files.set('/user-data/github-oauth.enc', Buffer.from('stale-token'));
    dependencies.isEncryptionAvailable.mockResolvedValue(false);
    const store = createGitHubCredentialStore(dependencies);

    await store.save(credentials);

    expect(files.has('/user-data/github-oauth.enc')).toBe(false);
    await expect(store.load()).resolves.toEqual(credentials);
  });

  it('logs stale-file removal failures and rejects memory-only saves safely', async () => {
    const dependencies = createDependencies();
    const removalError = new Error('permission denied');
    dependencies.isEncryptionAvailable.mockResolvedValue(false);
    dependencies.unlink.mockRejectedValue(removalError);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.save(credentials)).rejects.toThrow(
      'Unable to save GitHub credentials. Please try again.',
    );

    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to save GitHub credentials',
      removalError,
    );
    await expect(store.load()).resolves.toBeNull();
  });

  it.each([
    ['availability', 'isEncryptionAvailable'],
    ['encryption', 'encrypt'],
    ['temporary write', 'writeFile'],
    ['atomic rename', 'rename'],
  ] as const)('sanitizes %s failures while preserving backend context', async (_, failingDependency) => {
    const dependencies = createDependencies();
    const cause = new Error(`${failingDependency} failed`);
    dependencies[failingDependency].mockRejectedValueOnce(cause);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.save(credentials)).rejects.toThrow(
      'Unable to save GitHub credentials. Please try again.',
    );

    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to save GitHub credentials',
      cause,
    );
  });

  it('redacts tokens echoed by a save dependency error before logging', async () => {
    const dependencies = createDependencies();
    dependencies.encrypt.mockRejectedValue(
      new Error(
        `encryption failed for ${credentials.accessToken} and ${credentials.refreshToken}`,
      ),
    );
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.save(credentials)).rejects.toThrow(
      'Unable to save GitHub credentials. Please try again.',
    );

    const loggedCause = dependencies.logError.mock.calls[0]?.[1];
    expect(loggedCause).toBeInstanceOf(Error);
    const loggedMessage = (loggedCause as Error).message;
    expect(loggedMessage).toBe(
      'encryption failed for [REDACTED] and [REDACTED]',
    );
  });

  it('logs temporary-file cleanup failures without replacing the save error', async () => {
    const dependencies = createDependencies();
    const renameCause = new Error('rename failed');
    const cleanupCause = new Error('cleanup failed');
    dependencies.rename.mockRejectedValue(renameCause);
    dependencies.unlink.mockRejectedValue(cleanupCause);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.save(credentials)).rejects.toThrow(
      'Unable to save GitHub credentials. Please try again.',
    );

    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to remove temporary GitHub credential storage',
      cleanupCause,
    );
    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to save GitHub credentials',
      renameCause,
    );
  });

  it('sanitizes persistence availability failures during load', async () => {
    const dependencies = createDependencies();
    const cause = new Error('keychain unavailable');
    dependencies.isEncryptionAvailable.mockRejectedValue(cause);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.load()).rejects.toThrow(
      'Unable to load GitHub credentials. Please sign in again.',
    );
    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to load GitHub credentials',
      cause,
    );
  });

  it('clears both memory and the persistent credential file', async () => {
    const dependencies = createDependencies();
    dependencies.platform = 'linux';
    dependencies.getStorageBackend.mockReturnValue('basic_text');
    const store = createGitHubCredentialStore(dependencies);
    await store.save(credentials);

    await store.clear();

    await expect(store.load()).resolves.toBeNull();
    expect(dependencies.unlink).toHaveBeenCalledWith(
      '/user-data/github-oauth.enc',
    );
  });

  it('logs clear failures and exposes only a sanitized caller error', async () => {
    const dependencies = createDependencies();
    const cause = new Error('permission denied');
    dependencies.unlink.mockRejectedValue(cause);
    const store = createGitHubCredentialStore(dependencies);

    await expect(store.clear()).rejects.toThrow(
      'Unable to clear GitHub credentials. Please try again.',
    );
    expect(dependencies.logError).toHaveBeenCalledWith(
      'Failed to clear GitHub credentials',
      cause,
    );
  });
});
