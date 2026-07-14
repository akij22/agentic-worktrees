import {
  Archive,
  Bot,
  ChevronRight,
  FileCode2,
  FolderGit2,
  GitBranch,
  LockKeyhole,
  MapPin,
} from 'lucide-react';
import type { Repository, Worktree } from '../../../../shared/db/schema';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import {
  getRepositoryLabel,
  isLocalRepository,
} from '../dashboard-state';
import type { WorktreeChatSummaryState } from '../hooks/use-worktree-chat-summary';

interface RepositoryWorkspaceProps {
  repository?: Repository;
  worktrees: Worktree[];
  selectedWorktreeId?: string;
  chatSummary: WorktreeChatSummaryState;
  onCreateWorktree: (repository: Repository) => void;
  onOpenCodingAgent: (worktree: Worktree) => void;
  onSelectWorktree: (worktreeId: string) => void;
}

const statusLabel = (status: string): string =>
  status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

export const RepositoryWorkspace = ({
  repository,
  worktrees,
  selectedWorktreeId,
  chatSummary,
  onCreateWorktree,
  onOpenCodingAgent,
  onSelectWorktree,
}: RepositoryWorkspaceProps) => {
  if (!repository) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center bg-background p-8">
        <div className="max-w-sm text-center">
          <FolderGit2 className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 text-base font-semibold">Select a repository</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a repository from the sidebar to inspect its worktrees.
          </p>
        </div>
      </section>
    );
  }

  const selectedWorktree =
    worktrees.find((worktree) => worktree.id === selectedWorktreeId) ??
    worktrees[0];

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex min-h-24 shrink-0 items-start justify-between gap-6 border-b border-border px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
            <FolderGit2 aria-hidden="true" className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {getRepositoryLabel(repository)}
              </h1>
              <Badge variant="outline">
                {isLocalRepository(repository) ? 'Local' : 'Remote'}
              </Badge>
              {repository.isPrivate ? (
                <Badge variant="secondary">
                  <LockKeyhole aria-hidden="true" />
                  Private
                </Badge>
              ) : null}
              {repository.isArchived ? (
                <Badge variant="outline">
                  <Archive aria-hidden="true" />
                  Archived
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                  {repository.localRootPath ?? repository.htmlUrl}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <GitBranch aria-hidden="true" className="size-3.5" />
                {repository.defaultBranch ?? 'No default branch'}
              </span>
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => onCreateWorktree(repository)}
          disabled={repository.isArchived}
        >
          <GitBranch aria-hidden="true" />
          New worktree
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
            <div>
              <h2 className="text-sm font-semibold">Worktrees</h2>
              <p className="text-[11px] text-muted-foreground">
                {worktrees.length} {worktrees.length === 1 ? 'workspace' : 'workspaces'}
              </p>
            </div>
          </div>

          {worktrees.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm rounded-lg border border-dashed border-border px-8 py-10 text-center">
                <GitBranch className="mx-auto size-7 text-muted-foreground" />
                <h3 className="mt-4 text-sm font-semibold">No worktrees yet</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Create a worktree to isolate a branch and start a coding session.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-4"
                  onClick={() => onCreateWorktree(repository)}
                  disabled={repository.isArchived}
                >
                  Create worktree
                </Button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              <div className="sticky top-0 z-10 grid min-w-[650px] grid-cols-[minmax(220px,1.4fr)_minmax(120px,.7fr)_minmax(100px,.6fr)_minmax(110px,.65fr)_28px] items-center gap-3 border-b border-border bg-background px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <span>Worktree / branch</span>
                <span>Base branch</span>
                <span>Status</span>
                <span>Session</span>
                <span />
              </div>
              <div className="min-w-[650px] py-1.5">
                {worktrees.map((worktree) => {
                  const selected = worktree.id === selectedWorktree?.id;
                  return (
                    <button
                      key={worktree.id}
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => onSelectWorktree(worktree.id)}
                      className={cn(
                        'grid w-full grid-cols-[minmax(220px,1.4fr)_minmax(120px,.7fr)_minmax(100px,.6fr)_minmax(110px,.65fr)_28px] items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-primary/30 bg-accent text-accent-foreground'
                          : 'border-transparent hover:border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {worktree.name}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                          {worktree.branchName}
                        </span>
                      </span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {worktree.baseBranchName ?? '—'}
                      </span>
                      <Badge variant="outline" className="w-fit">
                        {statusLabel(worktree.status)}
                      </Badge>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            worktree.activeRunId ? 'bg-primary' : 'bg-muted-foreground/50',
                          )}
                        />
                        {worktree.activeRunId ? 'Active' : 'Ready'}
                      </span>
                      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {selectedWorktree ? (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card xl:flex">
            <div className="border-b border-border px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Worktree details
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold">
                {selectedWorktree.name}
              </h3>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <Detail label="Branch" value={selectedWorktree.branchName} mono />
              <Detail
                label="Base branch"
                value={selectedWorktree.baseBranchName ?? '—'}
                mono
              />
              <Detail label="Status" value={statusLabel(selectedWorktree.status)} />
              <Detail label="Local path" value={selectedWorktree.path} mono />
              <WorktreeChatSummary summary={chatSummary} />
            </div>
            <div className="border-t border-border p-4">
              <Button
                type="button"
                className="w-full"
                onClick={() => onOpenCodingAgent(selectedWorktree)}
              >
                <Bot aria-hidden="true" />
                Open Coding Agent
              </Button>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
};

const Detail = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div>
    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {label}
    </p>
    <p
      className={cn(
        'mt-1 break-words text-xs leading-relaxed text-foreground',
        mono && 'font-mono text-[11px]',
      )}
    >
      {value}
    </p>
  </div>
);

const WorktreeChatSummary = ({
  summary,
}: {
  summary: WorktreeChatSummaryState;
}) => {
  if (summary.status === 'loading') {
    return (
      <section className="border-t border-border pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Coding Agent
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Loading chat context…</p>
      </section>
    );
  }

  if (summary.status === 'error') {
    return (
      <section className="border-t border-border pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Coding Agent
        </p>
        <p className="mt-2 text-xs leading-relaxed text-destructive">
          Chat context unavailable: {summary.message}
        </p>
      </section>
    );
  }

  if (summary.status !== 'ready') return null;

  const lastMessage = summary.snapshot.messages.at(-1);
  const changedFiles = summary.snapshot.diff;

  return (
    <section className="space-y-5 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Coding Agent
        </p>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          {summary.snapshot.session.status}
        </span>
      </div>

      <div>
        <p className="text-xs font-semibold text-foreground">Latest message</p>
        {lastMessage ? (
          <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {lastMessage.content}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No messages yet.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-foreground">Changed files</p>
          <span className="text-[11px] text-muted-foreground">
            {changedFiles.length} {changedFiles.length === 1 ? 'file' : 'files'}
          </span>
        </div>
        {changedFiles.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {changedFiles.map((file) => (
              <li
                key={file.file}
                className="flex min-w-0 items-center gap-2 text-xs text-foreground"
              >
                <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                  {file.file}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  +{file.additions} / −{file.deletions}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No changed files.</p>
        )}
      </div>
    </section>
  );
};
