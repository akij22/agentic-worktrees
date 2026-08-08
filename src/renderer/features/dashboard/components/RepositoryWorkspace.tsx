import {
  Archive,
  ArrowRight,
  Bot,
  ChevronRight,
  FileCode2,
  FolderGit2,
  GitBranch,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Repository, Worktree } from '../../../../shared/db/schema';
import type { CodingAgentSessionDto } from '../../../../shared/ipc/schemas';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';
import {
  getRepositoryLabel,
  getDashboardChatStatus,
  isLocalRepository,
  type DashboardChatStatus,
} from '../dashboard-state';
import type { WorktreeChatSummaryState } from '../hooks/use-worktree-chat-summary';
import type { RepositoryBranchListState } from './RepositorySidebar';

interface RepositoryWorkspaceProps {
  repository?: Repository;
  worktrees: Worktree[];
  branchList?: RepositoryBranchListState;
  selectedWorktreeId?: string;
  sessionsByWorktreeId: Record<string, CodingAgentSessionDto | undefined>;
  chatSummary: WorktreeChatSummaryState;
  onBranchesRequested: (repositoryId: string) => void;
  onCreateWorktree: (
    repository: Repository,
    preferredBaseBranch?: string,
  ) => void;
  onOpenCodingAgent: (worktree: Worktree) => void;
  onSelectWorktree: (worktreeId: string) => void;
}

const statusLabel = (status: string): string =>
  status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());

const CHAT_STATUS_PRESENTATION: Record<
  DashboardChatStatus,
  { label: string; dotClassName: string }
> = {
  ready: { label: 'Ready', dotClassName: 'bg-muted-foreground/50' },
  running: { label: 'Running', dotClassName: 'bg-primary' },
  completed: { label: 'Completed', dotClassName: 'bg-emerald-500' },
  error: { label: 'Error', dotClassName: 'bg-destructive' },
};

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const SummaryCard = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) => (
  <div className="rounded-xl border border-border bg-card/70 px-4 py-3 shadow-sm">
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </p>
    <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
      <p className="truncate font-mono text-lg font-semibold text-foreground">
        {value}
      </p>
      <p className="shrink-0 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  </div>
);

const ChatStatus = ({
  session,
}: {
  session: CodingAgentSessionDto | undefined;
}) => {
  const status = getDashboardChatStatus(session);
  const presentation = CHAT_STATUS_PRESENTATION[status];
  return (
    <span
      aria-label={`Chat status: ${presentation.label}`}
      className="inline-flex items-center gap-2 text-[11px] text-muted-foreground"
    >
      <span className={cn('size-1.5 rounded-full', presentation.dotClassName)} />
      {presentation.label}
    </span>
  );
};

export const RepositoryWorkspace = ({
  repository,
  worktrees,
  branchList = { status: 'idle' },
  selectedWorktreeId,
  sessionsByWorktreeId,
  chatSummary,
  onBranchesRequested,
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
            Choose a repository from the sidebar to inspect its branches and
            worktrees.
          </p>
        </div>
      </section>
    );
  }

  const selectedWorktree =
    worktrees.find((worktree) => worktree.id === selectedWorktreeId) ??
    worktrees[0];
  const branchCount =
    branchList.status === 'ready' ? branchList.branches.length : undefined;
  const branchSummary =
    branchCount === undefined
      ? branchList.status === 'error'
        ? 'Unavailable'
        : 'Loading…'
      : countLabel(branchCount, 'branch', 'branches');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex min-h-24 shrink-0 items-start justify-between gap-6 border-b border-border bg-card/20 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground shadow-sm">
            <FolderGit2 aria-hidden="true" className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {getRepositoryLabel(repository)}
              </h1>
              <Badge variant="outline">
                {isLocalRepository(repository) ? 'Local' : 'Remote'}
              </Badge>
              {repository.isPrivate ? (
                <Badge variant="secondary" className="gap-1.5">
                  <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
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
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">
                  {repository.localRootPath ?? repository.htmlUrl}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono">
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
          <Plus aria-hidden="true" />
          New worktree
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6">
        <div className="mx-auto max-w-[1440px] space-y-7">
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard
              label="Default branch"
              value={repository.defaultBranch ?? 'Not set'}
              detail={repository.defaultBranch ? 'Repository default' : 'Unavailable'}
            />
            <SummaryCard
              label="Branches"
              value={branchSummary}
              detail={branchCount === undefined ? 'Repository branches' : 'Available'}
            />
            <SummaryCard
              label="Worktrees"
              value={countLabel(worktrees.length, 'worktree', 'worktrees')}
              detail={worktrees.length > 0 ? 'Isolated locally' : 'None created'}
            />
          </div>

          <section aria-labelledby="branches-heading">
            <SectionHeading
              id="branches-heading"
              title="Branches"
              description="Choose a branch to create or open an isolated workspace."
            />
            <BranchTable
              repository={repository}
              branchList={branchList}
              worktrees={worktrees}
              sessionsByWorktreeId={sessionsByWorktreeId}
              onBranchesRequested={onBranchesRequested}
              onCreateWorktree={onCreateWorktree}
              onOpenCodingAgent={onOpenCodingAgent}
            />
          </section>

          <section aria-labelledby="worktrees-heading">
            <SectionHeading
              id="worktrees-heading"
              title="Worktrees"
              description="Active isolated environments for this repository."
            />
            {worktrees.length === 0 ? (
              <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border bg-card/30 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <GitBranch aria-hidden="true" className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">
                      No worktrees for this repository
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Create one from a branch above to start an isolated coding
                      session.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => onCreateWorktree(repository)}
                  disabled={repository.isArchived}
                >
                  Create worktree
                </Button>
              </div>
            ) : (
              <div className="grid overflow-hidden rounded-xl border border-border bg-card/40 xl:grid-cols-[minmax(0,1fr)_320px]">
                <WorktreeList
                  worktrees={worktrees}
                  selectedWorktree={selectedWorktree}
                  sessionsByWorktreeId={sessionsByWorktreeId}
                  onSelectWorktree={onSelectWorktree}
                />
                {selectedWorktree ? (
                  <WorktreeDetails
                    worktree={selectedWorktree}
                    chatSummary={chatSummary}
                    onOpenCodingAgent={onOpenCodingAgent}
                  />
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
};

const SectionHeading = ({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) => (
  <div className="mb-3">
    <h2 id={id} className="text-base font-semibold tracking-tight">
      {title}
    </h2>
    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
  </div>
);

const BranchTable = ({
  repository,
  branchList,
  worktrees,
  sessionsByWorktreeId,
  onBranchesRequested,
  onCreateWorktree,
  onOpenCodingAgent,
}: {
  repository: Repository;
  branchList: RepositoryBranchListState;
  worktrees: Worktree[];
  sessionsByWorktreeId: Record<string, CodingAgentSessionDto | undefined>;
  onBranchesRequested: (repositoryId: string) => void;
  onCreateWorktree: (repository: Repository, preferredBaseBranch?: string) => void;
  onOpenCodingAgent: (worktree: Worktree) => void;
}) => {
  const worktreeByBranch = new Map(
    worktrees.map((worktree) => [worktree.branchName, worktree]),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/40">
      <div className="grid min-w-[680px] grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(120px,.65fr)_150px] gap-4 border-b border-border bg-muted/35 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <span>Branch</span>
        <span>Worktree</span>
        <span>Chat status</span>
        <span className="text-right">Action</span>
      </div>
      <div className="overflow-x-auto">
        {branchList.status === 'idle' || branchList.status === 'loading' ? (
          <div className="space-y-2 px-4 py-4" aria-label="Loading branches">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : branchList.status === 'error' ? (
          <div className="flex min-h-24 items-center justify-between gap-4 px-4 py-5">
            <div>
              <p className="text-sm font-medium text-destructive">
                Could not load branches
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {branchList.message}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onBranchesRequested(repository.id)}
            >
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : branchList.branches.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium">No branches found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              This repository did not return any branches.
            </p>
          </div>
        ) : (
          <div className="min-w-[680px] divide-y divide-border/70">
            {branchList.branches.map((branch) => {
              const worktree = worktreeByBranch.get(branch.name);
              return (
                <div
                  key={branch.name}
                  className="grid grid-cols-[minmax(220px,1.4fr)_minmax(150px,.8fr)_minmax(120px,.65fr)_150px] items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/20"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <GitBranch aria-hidden="true" className="size-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold text-foreground">
                        {branch.name}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {branch.name === repository.defaultBranch ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                            Default
                          </Badge>
                        ) : null}
                        {branch.protected ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                            Protected
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {worktree?.name ?? 'Not created'}
                  </p>
                  {worktree ? (
                    <ChatStatus session={sessionsByWorktreeId[worktree.id]} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground/70">—</span>
                  )}
                  <div className="text-right">
                    {worktree ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Open Coding Agent for ${branch.name}`}
                        onClick={() => onOpenCodingAgent(worktree)}
                      >
                        Open
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Create worktree from ${branch.name}`}
                        onClick={() => onCreateWorktree(repository, branch.name)}
                        disabled={repository.isArchived}
                      >
                        Create
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {branchList.status === 'ready' && branchList.branches.length > 0 ? (
        <div className="border-t border-border bg-muted/15 px-4 py-2 text-[10px] text-muted-foreground">
          Showing {countLabel(branchList.branches.length, 'branch', 'branches')}
        </div>
      ) : null}
    </div>
  );
};

const WorktreeList = ({
  worktrees,
  selectedWorktree,
  sessionsByWorktreeId,
  onSelectWorktree,
}: {
  worktrees: Worktree[];
  selectedWorktree: Worktree | undefined;
  sessionsByWorktreeId: Record<string, CodingAgentSessionDto | undefined>;
  onSelectWorktree: (worktreeId: string) => void;
}) => (
  <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
    <div className="grid min-w-[540px] grid-cols-[minmax(220px,1.3fr)_minmax(130px,.7fr)_minmax(120px,.65fr)_28px] items-center gap-3 border-b border-border bg-muted/35 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      <span>Worktree / branch</span>
      <span>Base branch</span>
      <span>Chat status</span>
      <span />
    </div>
    <div className="overflow-x-auto p-2">
      <div className="min-w-[540px] space-y-1">
        {worktrees.map((worktree) => {
          const selected = worktree.id === selectedWorktree?.id;
          return (
            <button
              key={worktree.id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelectWorktree(worktree.id)}
              className={cn(
                'grid w-full grid-cols-[minmax(220px,1.3fr)_minmax(130px,.7fr)_minmax(120px,.65fr)_28px] items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary/30 bg-primary/8'
                  : 'border-transparent hover:border-border hover:bg-muted/30',
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
              <ChatStatus session={sessionsByWorktreeId[worktree.id]} />
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

const WorktreeDetails = ({
  worktree,
  chatSummary,
  onOpenCodingAgent,
}: {
  worktree: Worktree;
  chatSummary: WorktreeChatSummaryState;
  onOpenCodingAgent: (worktree: Worktree) => void;
}) => (
  <aside className="flex min-w-0 flex-col bg-card/50">
    <div className="border-b border-border px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Selected worktree
      </p>
      <h3 className="mt-1 truncate text-sm font-semibold">{worktree.name}</h3>
    </div>
    <div className="space-y-4 p-5">
      <Detail label="Branch" value={worktree.branchName} mono />
      <Detail label="Base branch" value={worktree.baseBranchName ?? '—'} mono />
      <Detail label="Status" value={statusLabel(worktree.status)} />
      <Detail label="Local path" value={worktree.path} mono />
      <WorktreeChatSummary summary={chatSummary} />
    </div>
    <div className="mt-auto border-t border-border p-4">
      <Button
        type="button"
        className="w-full"
        onClick={() => onOpenCodingAgent(worktree)}
      >
        <Bot aria-hidden="true" />
        Open Coding Agent
      </Button>
    </div>
  </aside>
);

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
      <section className="border-t border-border pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Coding Agent
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Loading chat context…</p>
      </section>
    );
  }

  if (summary.status === 'error') {
    return (
      <section className="border-t border-border pt-4">
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
    <section className="space-y-4 border-t border-border pt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Coding Agent
      </p>
      <div>
        <p className="text-xs font-semibold text-foreground">Latest message</p>
        {lastMessage ? (
          <div className="mt-2 line-clamp-4 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
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
            {countLabel(changedFiles.length, 'file', 'files')}
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
                <span className="shrink-0 text-[11px]">
                  <span className="text-emerald-400">+{file.additions}</span>{' '}
                  /<span className="text-red-400"> −{file.deletions}</span>
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
