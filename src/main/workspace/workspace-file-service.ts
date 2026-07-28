import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceEntryDto,
  WorkspaceFilePreviewDto,
} from '../../shared/ipc/schemas';
import { getWorktreeById } from '../worktrees/worktree-service';
import {
  resolveWorkspacePath,
  type WorkspacePathDependencies,
} from './workspace-path';

const PREVIEW_LIMIT_BYTES = 1_048_576;
const BINARY_SCAN_BYTES = 8_192;

export interface WorkspaceFileService {
  listDirectory(
    worktreeId: string,
    relativePath: string,
  ): Promise<WorkspaceEntryDto[]>;
  readFile(
    worktreeId: string,
    relativePath: string,
  ): Promise<WorkspaceFilePreviewDto>;
}

type WorkspaceFileServiceDependencies = WorkspacePathDependencies;

const relativeEntryPath = (
  parentRelativePath: string,
  name: string,
): string =>
  [parentRelativePath.replace(/\\/g, '/').replace(/\/+$/, ''), name]
    .filter(Boolean)
    .join('/');

const isSafeWorkspaceError = (error: unknown): boolean =>
  error instanceof Error &&
  [
    'Worktree not found.',
    'Path must stay inside the worktree.',
  ].includes(error.message);

export const createWorkspaceFileService = (
  dependencies: WorkspaceFileServiceDependencies,
): WorkspaceFileService => ({
  async listDirectory(worktreeId, relativePath) {
    try {
      const { targetPath } = await resolveWorkspacePath(
        worktreeId,
        relativePath,
        dependencies,
      );
      const targetStats = await stat(targetPath);
      if (!targetStats.isDirectory()) {
        throw new Error('Directory is unavailable.');
      }

      const directoryEntries = await readdir(targetPath, {
        withFileTypes: true,
      });
      const entries = await Promise.all(
        directoryEntries
          .filter(({ name }) => name !== '.git')
          .map(async (entry): Promise<WorkspaceEntryDto | undefined> => {
            const entryPath = path.join(targetPath, entry.name);
            const entryStats = await stat(entryPath);
            const kind = entryStats.isDirectory()
              ? 'directory'
              : entryStats.isFile()
                ? 'file'
                : undefined;
            if (!kind) return undefined;
            return {
              name: entry.name,
              relativePath: relativeEntryPath(relativePath, entry.name),
              kind,
              size: kind === 'file' ? entryStats.size : null,
              hidden: entry.name.startsWith('.'),
            };
          }),
      );

      return entries
        .filter((entry): entry is WorkspaceEntryDto => entry !== undefined)
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === 'directory' ? -1 : 1;
          }
          return left.name.localeCompare(right.name, undefined, {
            sensitivity: 'base',
          });
        });
    } catch (error) {
      if (isSafeWorkspaceError(error)) throw error;
      console.error(
        `Failed to list workspace directory for worktree ${worktreeId}`,
        error,
      );
      throw new Error('Directory is unavailable.', { cause: error });
    }
  },

  async readFile(worktreeId, relativePath) {
    try {
      const { targetPath } = await resolveWorkspacePath(
        worktreeId,
        relativePath,
        dependencies,
      );
      const fileStats = await stat(targetPath);
      if (!fileStats.isFile()) {
        throw new Error('File is unavailable.');
      }
      if (fileStats.size === 0) {
        return {
          relativePath,
          size: 0,
          kind: 'empty',
        };
      }
      if (fileStats.size > PREVIEW_LIMIT_BYTES) {
        return {
          relativePath,
          size: fileStats.size,
          kind: 'too_large',
        };
      }

      const content = await readFile(targetPath);
      if (content.subarray(0, BINARY_SCAN_BYTES).includes(0)) {
        return {
          relativePath,
          size: fileStats.size,
          kind: 'binary',
        };
      }

      return {
        relativePath,
        size: fileStats.size,
        kind: 'text',
        content: content.toString('utf8'),
      };
    } catch (error) {
      if (isSafeWorkspaceError(error)) throw error;
      console.error(
        `Failed to read workspace file for worktree ${worktreeId}`,
        error,
      );
      throw new Error('File is unavailable.', { cause: error });
    }
  },
});

export const workspaceFileService = createWorkspaceFileService({
  getWorktree: getWorktreeById,
});
