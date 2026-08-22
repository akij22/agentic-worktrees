import {
  FolderTree,
  ScanText,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { CodingAgentDiffDto } from '../../../../shared/ipc/schemas';
import { cn } from '../../../lib/utils';
import { FileBrowserPanel } from './FileBrowserPanel';
import { ReviewPanel } from './ReviewPanel';
import { TerminalPanel } from './TerminalPanel';
import {
  getWorkspaceModeLabel,
  type WorkspacePanelMode,
  workspacePanelModes,
} from './workspace-panel-state';

type WorkspacePanelProps = {
  runId: string;
  worktreeId: string;
  worktreePath: string;
  diff: CodingAgentDiffDto[];
  focusedFile?: string;
  onFocusedFileConsumed?: () => void;
};

const modeIcons: Record<WorkspacePanelMode, LucideIcon> = {
  review: ScanText,
  terminal: SquareTerminal,
  files: FolderTree,
};

export const WorkspacePanel = ({
  runId,
  worktreeId,
  worktreePath,
  diff,
  focusedFile,
  onFocusedFileConsumed,
}: WorkspacePanelProps) => {
  const [mode, setMode] = useState<WorkspacePanelMode>('review');

  return (
    <aside
      aria-label="Workspace tools"
      className="flex min-h-0 flex-col bg-muted/20 xl:overflow-hidden"
    >
      <header className="shrink-0 bg-card/45 px-3 py-3">
        <nav
          aria-label="Workspace modes"
          className="grid grid-cols-3 gap-1 rounded-xl bg-background/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          {workspacePanelModes.map((candidate) => {
            const Icon = modeIcons[candidate];
            const active = mode === candidate;
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(candidate)}
                className={cn(
                  'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                  {getWorkspaceModeLabel(candidate)}
                </span>
              </button>
            );
          })}
        </nav>
        <p
          className="mt-2 truncate px-1 font-mono text-[10px] text-muted-foreground"
          title={worktreePath}
        >
          {worktreePath}
        </p>
      </header>

      <div
        className={mode === 'review' ? 'flex min-h-0 flex-1' : 'hidden'}
        data-run-id={runId}
      >
        <ReviewPanel
          worktreeId={worktreeId}
          diff={diff}
          focusedFile={focusedFile}
          onFocusedFileConsumed={onFocusedFileConsumed}
        />
      </div>
      <div
        className={mode === 'terminal' ? 'flex min-h-0 flex-1' : 'hidden'}
      >
        <TerminalPanel worktreeId={worktreeId} active={mode === 'terminal'} />
      </div>
      {mode === 'files' ? (
        <FileBrowserPanel worktreeId={worktreeId} />
      ) : null}
    </aside>
  );
};
