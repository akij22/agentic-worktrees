import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  AlertCircle,
  CircleDot,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceTerminalEventDto } from '../../../../shared/ipc/schemas';
import { Button } from '../../../components/ui/button';
import './TerminalPanel.css';

type TerminalPanelProps = {
  worktreeId: string;
  active: boolean;
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const TerminalPanel = ({
  worktreeId,
  active,
}: TerminalPanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitAddonRef = useRef<FitAddon | undefined>(undefined);
  const terminalIdRef = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  const startingRef = useRef(false);
  const disposedRef = useRef(false);
  const pendingEventsRef = useRef<WorkspaceTerminalEventDto[]>([]);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [exitCode, setExitCode] = useState<number>();
  const [error, setError] = useState<string>();

  activeRef.current = active;

  const dimensions = useCallback(() => {
    const terminal = terminalRef.current;
    return {
      cols: Math.max(1, terminal?.cols ?? 80),
      rows: Math.max(1, terminal?.rows ?? 24),
    };
  }, []);

  const processEvent = useCallback(
    (event: WorkspaceTerminalEventDto) => {
      if (event.worktreeId !== worktreeId) return;
      const terminalId = terminalIdRef.current;
      if (!terminalId) {
        pendingEventsRef.current.push(event);
        return;
      }
      if (event.terminalId !== terminalId) return;
      if (event.type === 'data') {
        terminalRef.current?.write(event.data);
      } else if (event.type === 'exit') {
        setExitCode(event.exitCode);
      } else {
        setError(event.message);
      }
    },
    [worktreeId],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    disposedRef.current = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Geist Mono Variable, ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: {
        background: '#0f1115',
        foreground: '#e5e7eb',
        cursor: '#ef4444',
        selectionBackground: '#7f1d1d80',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const inputSubscription = terminal.onData((data) => {
      const terminalId = terminalIdRef.current;
      if (!terminalId) return;
      void window.api.workspace.terminal
        .write({ worktreeId, terminalId, data })
        .catch((cause) => setError(errorMessage(cause)));
    });
    const unsubscribe = window.api.workspace.terminal.onEvent(processEvent);
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (!activeRef.current) return;
            fitAddon.fit();
            const terminalId = terminalIdRef.current;
            if (!terminalId) return;
            void window.api.workspace.terminal
              .resize({ worktreeId, terminalId, ...dimensions() })
              .catch((cause) => setError(errorMessage(cause)));
          });
    resizeObserver?.observe(container);

    return () => {
      disposedRef.current = true;
      const terminalId = terminalIdRef.current;
      terminalIdRef.current = undefined;
      pendingEventsRef.current = [];
      resizeObserver?.disconnect();
      unsubscribe();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      fitAddonRef.current = undefined;
      if (terminalId) {
        void window.api.workspace.terminal.dispose({
          worktreeId,
          terminalId,
        });
      }
    };
  }, [dimensions, processEvent, worktreeId]);

  useEffect(() => {
    if (
      !active ||
      terminalIdRef.current ||
      startingRef.current ||
      !terminalRef.current
    ) {
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setError(undefined);
    fitAddonRef.current?.fit();
    void window.api.workspace.terminal
      .create({ worktreeId, ...dimensions() })
      .then(({ terminalId }) => {
        if (disposedRef.current) {
          return window.api.workspace.terminal.dispose({
            worktreeId,
            terminalId,
          });
        }
        terminalIdRef.current = terminalId;
        const pendingEvents = pendingEventsRef.current;
        pendingEventsRef.current = [];
        for (const event of pendingEvents) processEvent(event);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => {
        startingRef.current = false;
        setStarting(false);
      });
  }, [active, dimensions, processEvent, worktreeId]);

  useEffect(() => {
    if (!active) return;
    fitAddonRef.current?.fit();
    const terminalId = terminalIdRef.current;
    if (!terminalId) return;
    void window.api.workspace.terminal
      .resize({ worktreeId, terminalId, ...dimensions() })
      .catch((cause) => setError(errorMessage(cause)));
  }, [active, dimensions, worktreeId]);

  const restart = async () => {
    const terminalId = terminalIdRef.current;
    if (!terminalId) return;
    setRestarting(true);
    setError(undefined);
    try {
      fitAddonRef.current?.fit();
      await window.api.workspace.terminal.restart({
        worktreeId,
        terminalId,
        ...dimensions(),
      });
      setExitCode(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#0f1115]" aria-label="Terminale del worktree">
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-gray-300">
        <CircleDot
          aria-hidden="true"
          className={`size-3 ${
            exitCode === undefined ? 'text-emerald-400' : 'text-amber-400'
          }`}
        />
        <span className="flex-1 text-[11px] font-medium">
          {starting
            ? 'Avvio terminale…'
            : exitCode === undefined
              ? 'Shell attiva'
              : `Processo terminato · codice ${exitCode}`}
        </span>
        {exitCode !== undefined ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={restarting}
            onClick={() => void restart()}
            className="h-7 border-white/15 bg-white/5 px-2 text-[10px] text-gray-200 hover:bg-white/10 hover:text-white"
          >
            {restarting ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <RotateCcw aria-hidden="true" className="size-3" />
            )}
            Riavvia
          </Button>
        ) : null}
      </header>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="workspace-terminal min-h-0 flex-1 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary"
      />
    </section>
  );
};
