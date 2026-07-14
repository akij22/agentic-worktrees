import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { safeStorage } from 'electron';

export interface GitHubCredentialPayload {
  version: 1;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  tokenType: 'bearer';
}

export interface GitHubCredentialStore {
  load(): Promise<GitHubCredentialPayload | null>;
  save(payload: GitHubCredentialPayload): Promise<void>;
  clear(): Promise<void>;
  isPersistent(): boolean;
}

type StorageBackend = ReturnType<
  typeof safeStorage.getSelectedStorageBackend
>;

interface DecryptionResult {
  result: string;
  shouldReEncrypt: boolean;
}

interface GitHubCredentialStoreDependencies {
  credentialPath: string;
  platform: NodeJS.Platform;
  getStorageBackend: () => StorageBackend;
  isEncryptionAvailable: () => Promise<boolean>;
  encrypt: (plainText: string) => Promise<Buffer>;
  decrypt: (encrypted: Buffer) => Promise<DecryptionResult>;
  readFile: (filePath: string) => Promise<Buffer>;
  writeFile: (
    filePath: string,
    data: Buffer,
    options: { mode: number },
  ) => Promise<unknown>;
  rename: (oldPath: string, newPath: string) => Promise<unknown>;
  unlink: (filePath: string) => Promise<unknown>;
  logError: (message: string, cause: unknown) => void;
}

const REAUTHENTICATION_ERROR =
  'GitHub credentials are invalid. Please sign in again.';
const LOAD_ERROR = 'Unable to load GitHub credentials. Please sign in again.';
const SAVE_ERROR = 'Unable to save GitHub credentials. Please try again.';
const CLEAR_ERROR = 'Unable to clear GitHub credentials. Please try again.';

const isMissingFileError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isCredentialPayload = (
  value: unknown,
): value is GitHubCredentialPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.accessToken === 'string' &&
    typeof payload.refreshToken === 'string' &&
    typeof payload.accessTokenExpiresAt === 'number' &&
    Number.isFinite(payload.accessTokenExpiresAt) &&
    typeof payload.refreshTokenExpiresAt === 'number' &&
    Number.isFinite(payload.refreshTokenExpiresAt) &&
    payload.tokenType === 'bearer'
  );
};

const clonePayload = (
  payload: GitHubCredentialPayload,
): GitHubCredentialPayload => ({ ...payload });

const parseCredentialPayload = (serialized: string): unknown => {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    // JSON parser errors can contain excerpts from the decrypted input.
    throw new Error('Stored GitHub credential payload cannot be parsed');
  }
};

const createSafeLogCause = (
  cause: unknown,
  sensitiveValues: readonly string[],
): unknown => {
  const redact = (value: string): string =>
    sensitiveValues
      .filter((sensitiveValue) => sensitiveValue.length > 0)
      .reduce(
        (redacted, sensitiveValue) =>
          redacted.replaceAll(sensitiveValue, '[REDACTED]'),
        value,
      );

  if (cause instanceof Error) {
    const redactedMessage = redact(cause.message);
    if (redactedMessage === cause.message) {
      return cause;
    }

    const safeCause = new Error(redactedMessage);
    safeCause.name = cause.name;
    return safeCause;
  }

  if (typeof cause === 'string') {
    return redact(cause);
  }

  return cause;
};

export const createGitHubCredentialStore = (
  dependencies: GitHubCredentialStoreDependencies,
): GitHubCredentialStore => {
  let memoryPayload: GitHubCredentialPayload | null = null;
  let persistent = false;

  const canPersist = async (): Promise<boolean> => {
    if (
      dependencies.platform === 'linux' &&
      dependencies.getStorageBackend() === 'basic_text'
    ) {
      return false;
    }

    return dependencies.isEncryptionAvailable();
  };

  const removeFile = async (filePath: string): Promise<void> => {
    try {
      await dependencies.unlink(filePath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  };

  const removeCorruptCredentialFile = async (): Promise<void> => {
    try {
      await removeFile(dependencies.credentialPath);
    } catch (error) {
      dependencies.logError(
        'Failed to remove invalid GitHub credential storage',
        error,
      );
    }
  };

  const removeTemporaryFile = async (temporaryPath: string): Promise<void> => {
    try {
      await removeFile(temporaryPath);
    } catch (error) {
      dependencies.logError(
        'Failed to remove temporary GitHub credential storage',
        error,
      );
    }
  };

  const persistPayload = async (
    payload: GitHubCredentialPayload,
  ): Promise<void> => {
    const serialized = JSON.stringify(payload);
    const temporaryPath = `${dependencies.credentialPath}.tmp`;
    let temporaryFileMayExist = false;

    try {
      const encrypted = await dependencies.encrypt(serialized);
      temporaryFileMayExist = true;
      await dependencies.writeFile(temporaryPath, encrypted, { mode: 0o600 });
      await dependencies.rename(temporaryPath, dependencies.credentialPath);
    } catch (error) {
      if (temporaryFileMayExist) {
        await removeTemporaryFile(temporaryPath);
      }
      throw error;
    }
  };

  return {
    async load() {
      if (memoryPayload) {
        return clonePayload(memoryPayload);
      }

      try {
        persistent = await canPersist();
      } catch (error) {
        persistent = false;
        dependencies.logError('Failed to load GitHub credentials', error);
        throw new Error(LOAD_ERROR);
      }

      if (!persistent) {
        return null;
      }

      let parsed: unknown;
      let shouldReEncrypt = false;
      try {
        const encrypted = await dependencies.readFile(
          dependencies.credentialPath,
        );
        let decrypted = await dependencies.decrypt(encrypted);
        shouldReEncrypt = decrypted.shouldReEncrypt;
        if (shouldReEncrypt) {
          decrypted = await dependencies.decrypt(encrypted);
        }
        parsed = parseCredentialPayload(decrypted.result);

        if (!isCredentialPayload(parsed)) {
          throw new Error('Stored GitHub credential payload is invalid');
        }
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }

        dependencies.logError('Failed to load GitHub credentials', error);
        memoryPayload = null;
        await removeCorruptCredentialFile();
        throw new Error(REAUTHENTICATION_ERROR);
      }

      if (shouldReEncrypt) {
        try {
          await persistPayload(parsed);
        } catch (error) {
          dependencies.logError(
            'Failed to migrate GitHub credential storage',
            createSafeLogCause(error, [
              parsed.accessToken,
              parsed.refreshToken,
            ]),
          );
          throw new Error(LOAD_ERROR);
        }
      }

      return parsed;
    },

    async save(payload) {
      try {
        persistent = await canPersist();
        if (!persistent) {
          await removeFile(dependencies.credentialPath);
          memoryPayload = clonePayload(payload);
          return;
        }

        await persistPayload(payload);
        memoryPayload = null;
      } catch (error) {
        dependencies.logError(
          'Failed to save GitHub credentials',
          createSafeLogCause(error, [payload.accessToken, payload.refreshToken]),
        );
        throw new Error(SAVE_ERROR);
      }
    },

    async clear() {
      memoryPayload = null;
      try {
        await removeFile(dependencies.credentialPath);
      } catch (error) {
        dependencies.logError('Failed to clear GitHub credentials', error);
        throw new Error(CLEAR_ERROR);
      }
    },

    isPersistent() {
      return persistent;
    },
  };
};

export const createElectronGitHubCredentialStore = (
  credentialPath: string,
): GitHubCredentialStore =>
  createGitHubCredentialStore({
    credentialPath,
    platform: process.platform,
    getStorageBackend: () => safeStorage.getSelectedStorageBackend(),
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),
    decrypt: (encrypted) => safeStorage.decryptStringAsync(encrypted),
    readFile,
    writeFile,
    rename,
    unlink,
    logError: (message, cause) => console.error(message, cause),
  });
