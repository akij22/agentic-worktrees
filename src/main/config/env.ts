import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

export interface EnvConfig {
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

export const getEnvConfig = (): EnvConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const workspaceRoot = resolveUserPath(requireEnv('WORKTREEHUB_WORKSPACE_ROOT'));

  cachedConfig = { workspaceRoot };

  return cachedConfig;
};
