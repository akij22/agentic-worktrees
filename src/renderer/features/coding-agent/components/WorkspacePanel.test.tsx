// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../../shared/ipc/api';
import { FileBrowserPanel } from './FileBrowserPanel';
import { TerminalPanel } from './TerminalPanel';

const mocks = vi.hoisted(() => ({
  listDirectory:
    vi.fn<Api['workspace']['files']['listDirectory']>(),
  readFile: vi.fn<Api['workspace']['files']['readFile']>(),
  createTerminal:
    vi.fn<Api['workspace']['terminal']['create']>(),
  writeTerminal:
    vi.fn<Api['workspace']['terminal']['write']>(),
  resizeTerminal:
    vi.fn<Api['workspace']['terminal']['resize']>(),
  restartTerminal:
    vi.fn<Api['workspace']['terminal']['restart']>(),
  disposeTerminal:
    vi.fn<Api['workspace']['terminal']['dispose']>(),
  terminalEventListener: undefined as
    | Parameters<Api['workspace']['terminal']['onEvent']>[0]
    | undefined,
  terminalInputListener: undefined as ((data: string) => void) | undefined,
  xtermWrite: vi.fn(),
  xtermOpen: vi.fn(),
  xtermDispose: vi.fn(),
  fit: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    loadAddon = vi.fn();
    open = mocks.xtermOpen;
    write = mocks.xtermWrite;
    dispose = mocks.xtermDispose;
    onData(listener: (data: string) => void) {
      mocks.terminalInputListener = listener;
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mocks.fit;
  },
}));

const api = {
  workspace: {
    files: {
      listDirectory: mocks.listDirectory,
      readFile: mocks.readFile,
    },
    terminal: {
      create: mocks.createTerminal,
      write: mocks.writeTerminal,
      resize: mocks.resizeTerminal,
      restart: mocks.restartTerminal,
      dispose: mocks.disposeTerminal,
      onEvent: (
        listener: Parameters<Api['workspace']['terminal']['onEvent']>[0],
      ) => {
        mocks.terminalEventListener = listener;
        return vi.fn();
      },
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

describe('workspace terminal panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terminalEventListener = undefined;
    mocks.terminalInputListener = undefined;
    mocks.createTerminal.mockResolvedValue({ terminalId: 'terminal-1' });
    mocks.writeTerminal.mockResolvedValue(undefined);
    mocks.resizeTerminal.mockResolvedValue(undefined);
    mocks.restartTerminal.mockResolvedValue(undefined);
    mocks.disposeTerminal.mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api,
    });
  });

  afterEach(() => cleanup());

  it('connects xterm input and output to the worktree PTY lifecycle', async () => {
    const { unmount } = render(
      <TerminalPanel worktreeId="worktree-1" active />,
    );

    await waitFor(() =>
      expect(mocks.createTerminal).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        cols: 100,
        rows: 30,
      }),
    );
    expect(mocks.xtermOpen).toHaveBeenCalledOnce();

    mocks.terminalInputListener?.('pwd\r');
    expect(mocks.writeTerminal).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: 'pwd\r',
    });

    mocks.terminalEventListener?.({
      type: 'data',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      data: '/workspace\r\n',
    });
    expect(mocks.xtermWrite).toHaveBeenCalledWith('/workspace\r\n');

    unmount();
    await waitFor(() =>
      expect(mocks.disposeTerminal).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        terminalId: 'terminal-1',
      }),
    );
    expect(mocks.xtermDispose).toHaveBeenCalledOnce();
  });

  it('shows terminal exit state and restarts with current dimensions', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel worktreeId="worktree-1" active />);
    await waitFor(() => expect(mocks.createTerminal).toHaveBeenCalledOnce());

    mocks.terminalEventListener?.({
      type: 'exit',
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      exitCode: 7,
    });

    expect(await screen.findByText(/codice 7/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /riavvia/i }));

    expect(mocks.restartTerminal).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      terminalId: 'terminal-1',
      cols: 100,
      rows: 30,
    });
  });
});
