import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export const parseCodexVersion = (output: string): string | null =>
  output.match(/^codex-cli\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/m)?.[1] ??
  null;

export const getCodexCandidates = (): string[] => {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    path.join(os.homedir(), '.npm-global', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/bin/codex',
  ];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'npm', 'codex.cmd'));
  }

  return candidates;
};

export const findCodexInSystem = async (): Promise<string | null> => {
  try {
    const command = process.platform === 'win32' ? 'where' : 'command';
    const args = process.platform === 'win32' ? ['codex'] : ['-v', 'codex'];
    const { stdout } = await execFile(command, args, {
      timeout: 5_000,
      windowsHide: true,
    });
    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && existsSync(line));
    if (candidate) return candidate;
  } catch {
    // Not available on PATH; fall through to the bounded candidate list.
  }

  return getCodexCandidates().find((candidate) => existsSync(candidate)) ?? null;
};
