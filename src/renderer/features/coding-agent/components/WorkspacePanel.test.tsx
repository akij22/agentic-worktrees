// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../../shared/ipc/api';
import { FileBrowserPanel } from './FileBrowserPanel';

const mocks = vi.hoisted(() => ({
  listDirectory:
    vi.fn<Api['workspace']['files']['listDirectory']>(),
  readFile: vi.fn<Api['workspace']['files']['readFile']>(),
}));

const api = {
  workspace: {
    files: {
      listDirectory: mocks.listDirectory,
      readFile: mocks.readFile,
    },
  },
} as unknown as Api;

describe('workspace file browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api,
    });
  });

  afterEach(() => cleanup());

  it('expands folders lazily and previews a selected text file', async () => {
    mocks.listDirectory.mockImplementation(async ({ relativePath }) =>
      relativePath === ''
        ? [
            {
              name: 'src',
              relativePath: 'src',
              kind: 'directory',
              size: null,
              hidden: false,
            },
          ]
        : [
            {
              name: 'index.ts',
              relativePath: 'src/index.ts',
              kind: 'file',
              size: 24,
              hidden: false,
            },
          ],
    );
    mocks.readFile.mockResolvedValue({
      relativePath: 'src/index.ts',
      size: 24,
      kind: 'text',
      content: 'export const value = 1;\n',
    });
    const user = userEvent.setup();

    render(<FileBrowserPanel worktreeId="worktree-1" />);
    await user.click(await screen.findByRole('button', { name: /src/i }));
    await user.click(
      await screen.findByRole('button', { name: /index\.ts/i }),
    );

    expect(mocks.listDirectory).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      relativePath: 'src',
    });
    expect(mocks.readFile).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      relativePath: 'src/index.ts',
    });
    expect(await screen.findByText('export const value = 1;')).toBeDefined();
    expect(screen.getByText(/sola lettura/i)).toBeDefined();
  });

  it.each([
    ['empty', 'Il file è vuoto.'],
    ['binary', 'Anteprima non disponibile per i file binari.'],
    ['too_large', 'Il file supera il limite di anteprima di 1 MiB.'],
  ] as const)('renders the %s preview state', async (kind, expectedMessage) => {
    mocks.listDirectory.mockResolvedValue([
      {
        name: 'sample.dat',
        relativePath: 'sample.dat',
        kind: 'file',
        size: kind === 'empty' ? 0 : 2_000_000,
        hidden: false,
      },
    ]);
    mocks.readFile.mockResolvedValue({
      relativePath: 'sample.dat',
      size: kind === 'empty' ? 0 : 2_000_000,
      kind,
    });
    const user = userEvent.setup();

    render(<FileBrowserPanel worktreeId="worktree-1" />);
    await user.click(
      await screen.findByRole('button', { name: /sample\.dat/i }),
    );

    expect(await screen.findByText(expectedMessage)).toBeDefined();
  });

  it('shows directory and preview errors in their local regions', async () => {
    mocks.listDirectory.mockRejectedValueOnce(
      new Error('Directory is unavailable.'),
    );

    render(<FileBrowserPanel worktreeId="worktree-1" />);

    expect(
      await screen.findByText('Directory is unavailable.'),
    ).toBeDefined();
  });
});
