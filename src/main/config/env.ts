import 'dotenv/config';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type GitHubAuthMode = 'github_app';

export interface EnvConfig {
  githubAuthMode: GitHubAuthMode;
  githubAppId: number;
  githubAppPrivateKey: string;
  githubAppInstallationId: number;
  workspaceRoot: string;
}

let cachedConfig: EnvConfig | null = null;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const resolveUserPath = (inputPath: string): string => {
  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return path.resolve(inputPath);
};

const readPrivateKey = (privateKeyPath: string): string => {
  const resolved = resolveUserPath(privateKeyPath);
  try {
    return readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read GitHub App private key at ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

export const getEnvConfig = (): EnvConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const authMode = process.env.GITHUB_AUTH_MODE ?? 'github_app';
  if (authMode !== 'github_app') {
    throw new Error(
      `Unsupported GITHUB_AUTH_MODE "${authMode}". Only "github_app" is supported.`,
    );
  }

  const appId = Number.parseInt(requireEnv('GITHUB_APP_ID'), 10);
  const installationId = Number.parseInt(
    requireEnv('GITHUB_APP_INSTALLATION_ID'),
    10,
  );
  if (Number.isNaN(appId) || Number.isNaN(installationId)) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID must be integers.');
  }

  const privateKeyPath = requireEnv('GITHUB_APP_PRIVATE_KEY_PATH');
  const privateKey = readPrivateKey(privateKeyPath);

  const workspaceRoot = resolveUserPath(requireEnv('WORKTREEHUB_WORKSPACE_ROOT'));

  cachedConfig = {
    githubAuthMode: 'github_app',
    githubAppId: appId,
    githubAppPrivateKey: privateKey,
    githubAppInstallationId: installationId,
    workspaceRoot,
  };

  return cachedConfig;
};
