import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export const parseOpenCodeVersion = (output: string): string | null =>
  output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? null;

const COMMON_PATHS = [
  path.join(os.homedir(), '.local', 'bin', 'opencode'),
  path.join(os.homedir(), '.cargo', 'bin', 'opencode'),
  '/usr/local/bin/opencode',
  '/opt/homebrew/bin/opencode',
  '/usr/bin/opencode',
];

export const findOpenCodeInSystem = async (): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('command', ['-v', 'opencode'], {
      timeout: 5_000,
      windowsHide: true,
    });
    const trimmed = stdout.trim();
    if (trimmed && existsSync(trimmed)) return trimmed;
  } catch {
    // not found in PATH
  }

  for (const candidate of COMMON_PATHS) {
    if (existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const windowsCandidate = path.join(localAppData, 'Programs', 'opencode', 'opencode.exe');
    if (existsSync(windowsCandidate)) return windowsCandidate;
  }

  return null;
};

export const reserveLocalPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a local port for OpenCode.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

export const readOpenCodeSessionId = (properties: unknown): string | null => {
  if (!properties || typeof properties !== 'object') return null;
  if ('sessionID' in properties && typeof properties.sessionID === 'string') {
    return properties.sessionID;
  }
  if (
    'info' in properties &&
    properties.info &&
    typeof properties.info === 'object' &&
    'sessionID' in properties.info &&
    typeof properties.info.sessionID === 'string'
  ) {
    return properties.info.sessionID;
  }
  if (
    'part' in properties &&
    properties.part &&
    typeof properties.part === 'object' &&
    'sessionID' in properties.part &&
    typeof properties.part.sessionID === 'string'
  ) {
    return properties.part.sessionID;
  }
  return null;
};
