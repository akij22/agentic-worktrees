import {
  FolderTree,
  ScanText,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { CodingAgentDiffDto } from '../../../../shared/ipc/schemas';
import { ReviewPanel } from './ReviewPanel';
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
    <aside className="flex min-h-0 flex-col bg-muted/20 xl:overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card/65 px-3 py-3">
        <nav
          aria-label="Workspace tools"
          className="grid grid-cols-3 gap-1 rounded-lg border border-border/70 bg-background/55 p-1 shadow-sm"
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
                className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
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

      {mode === 'review' ? (
        <ReviewPanel
          diff={diff}
          focusedFile={focusedFile}
          onFocusedFileConsumed={onFocusedFileConsumed}
        />
      ) : (
        <div
          className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground"
          data-run-id={runId}
          data-worktree-id={worktreeId}
        >
          {getWorkspaceModeLabel(mode)}
        </div>
      )}
    </aside>
  );
};
