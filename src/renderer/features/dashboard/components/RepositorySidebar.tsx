import {
  ChevronDown,
  FolderGit2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Repository } from '../../../../shared/db/schema';
import type { BranchDto } from '../../../../shared/ipc/schemas';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';
import {
  getRepositoryLabel,
  isLocalRepository,
} from '../dashboard-state';

export type RepositoryBranchListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; branches: BranchDto[] }
  | { status: 'error'; message: string };

export type BranchChatStatus = {
  status: string;
  errorMessage: string | null;
};

interface RepositorySidebarProps {
  repositories: Repository[];
  selectedRepositoryId?: string;
  branchLists: Record<string, RepositoryBranchListState | undefined>;
  branchChatStatuses: Record<string, Record<string, BranchChatStatus | undefined>>;
  query: string;
  loading: boolean;
  onAdd: () => void;
  onBranchesRequested: (repositoryId: string) => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (repositoryId: string) => void;
}

export const RepositorySidebar = ({
  repositories,
  selectedRepositoryId,
  branchLists,
  branchChatStatuses,
  query,
  loading,
  onAdd,
  onBranchesRequested,
  onRefresh,
  onQueryChange,
  onSelect,
}: RepositorySidebarProps) => {
  const [expandedRepositoryIds, setExpandedRepositoryIds] = useState<Set<string>>(
    () => new Set(selectedRepositoryId ? [selectedRepositoryId] : []),
  );

  useEffect(() => {
    if (!selectedRepositoryId) return;
    setExpandedRepositoryIds((current) => {
      if (current.has(selectedRepositoryId)) return current;
      const next = new Set(current);
      next.add(selectedRepositoryId);
      return next;
    });
    onBranchesRequested(selectedRepositoryId);
  }, [onBranchesRequested, selectedRepositoryId]);

  const selectRepository = (repositoryId: string) => {
    onSelect(repositoryId);
    setExpandedRepositoryIds((current) => {
      if (current.has(repositoryId)) return current;
      const next = new Set(current);
      next.add(repositoryId);
      return next;
    });
    onBranchesRequested(repositoryId);
  };

  const toggleRepository = (repositoryId: string, expanded: boolean) => {
    setExpandedRepositoryIds((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) {
        next.delete(repositoryId);
      } else {
        next.add(repositoryId);
      }
      return next;
    });
    if (!expanded) onBranchesRequested(repositoryId);
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="shrink-0 px-3 pb-3 pt-5">
        <div className="mb-3 px-1">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Repositories
            </h2>
          </div>
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search repositories"
            aria-label="Search repositories"
            className="h-8 bg-background pl-8 text-xs shadow-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <div className="space-y-2 px-1 py-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : repositories.length === 0 ? (
          <div className="mx-1 mt-2 rounded-md border border-dashed border-sidebar-border px-3 py-5 text-center">
            <FolderGit2 className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-xs font-medium text-foreground">
              No repositories found
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Adjust the search or add another repository.
            </p>
          </div>
        ) : (
          <div className="space-y-1 py-1">
            {repositories.map((repository) => {
              const selected = repository.id === selectedRepositoryId;
              const expanded = expandedRepositoryIds.has(repository.id);
              const branchList = branchLists[repository.id] ?? { status: 'idle' };
              const branchesId = `repository-branches-${repository.id}`;
              return (
                <section
                  key={repository.id}
                  className={cn(
                    'overflow-hidden rounded-md border transition-colors',
                    selected
                      ? 'border-sidebar-border bg-sidebar-accent/65 text-sidebar-accent-foreground shadow-sm'
                      : 'border-transparent text-sidebar-foreground hover:border-sidebar-border/70 hover:bg-sidebar-accent/35',
                  )}
                >
                  <div className="flex min-w-0 items-stretch">
                    <button
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => selectRepository(repository.id)}
                      className="group flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                    >
                      <FolderGit2
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          selected ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {getRepositoryLabel(repository)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                          {repository.localRootPath ??
                            `${isLocalRepository(repository) ? 'local' : 'remote'} · ${repository.defaultBranch ?? 'no default'}`}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          repository.isArchived ? 'bg-muted-foreground' : 'bg-primary',
                        )}
                        title={repository.isArchived ? 'Archived' : 'Available'}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} branches for ${getRepositoryLabel(repository)}`}
                      aria-expanded={expanded}
                      aria-controls={branchesId}
                      onClick={() => toggleRepository(repository.id, expanded)}
                      className="flex w-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                    >
                      {branchList.status === 'ready' ? (
                        <span className="mr-0.5 font-mono text-[9px] tabular-nums">
                          {branchList.branches.length}
                        </span>
                      ) : null}
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'size-3.5 transition-transform duration-150',
                          !expanded && '-rotate-90',
                        )}
                      />
                    </button>
                  </div>

                  {expanded ? (
                    <div
                      id={branchesId}
                      role="group"
                      aria-label={`Branches for ${getRepositoryLabel(repository)}`}
                      className="border-t border-sidebar-border/80 bg-sidebar/70 px-2 py-1"
                    >
                      {branchList.status === 'idle' || branchList.status === 'loading' ? (
                        <div className="space-y-1 py-1" aria-label="Loading branches">
                          <Skeleton className="h-6 w-full" />
                          <Skeleton className="h-6 w-4/5" />
                        </div>
                      ) : branchList.status === 'error' ? (
                        <div className="px-2 py-2">
                          <p
                            className="text-[10px] leading-relaxed text-destructive"
                            title={branchList.message}
                          >
                            Could not load branches.
                          </p>
                          <button
                            type="button"
                            className="mt-1 text-[10px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                            onClick={() => onBranchesRequested(repository.id)}
                          >
                            Retry
                          </button>
                        </div>
                      ) : branchList.branches.length === 0 ? (
                        <p className="px-2 py-2 text-[10px] text-muted-foreground">
                          No branches found.
                        </p>
                      ) : (
                        <ul className="space-y-0.5">
                          {branchList.branches.map((branch) => (
                            <BranchRow
                              key={branch.name}
                              branch={branch}
                              chatStatus={
                                branchChatStatuses[repository.id]?.[branch.name]
                              }
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <div className="grid grid-cols-2 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start px-2"
            onClick={onAdd}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start px-2"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>
    </aside>
  );
};

const getChatStatusPresentation = ({
  status,
  errorMessage,
}: BranchChatStatus): { label: string; className: string } => {
  if (errorMessage || status === 'error') {
    return {
      label: 'Failed',
      className: 'text-destructive',
    };
  }
  if (status === 'waiting_permission') {
    return {
      label: 'Permission',
      className: 'text-amber-700 dark:text-chart-4',
    };
  }
  return {
    label: 'Chat',
    className: 'text-primary',
  };
};

const BranchRow = ({
  branch,
  chatStatus,
}: {
  branch: BranchDto;
  chatStatus?: BranchChatStatus;
}) => {
  const presentation = chatStatus
    ? getChatStatusPresentation(chatStatus)
    : undefined;

  return (
    <li className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] text-sidebar-foreground">
      <span className="min-w-0 flex-1 truncate font-mono" title={branch.name}>
        {branch.name}
      </span>
      {branch.protected ? (
        <LockKeyhole
          aria-label="Protected branch"
          className="size-3 shrink-0 text-muted-foreground"
        />
      ) : null}
      {presentation ? (
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 font-mono text-[9px] capitalize',
            presentation.className,
          )}
          title={`Coding agent chat: ${presentation.label}`}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {presentation.label}
        </span>
      ) : null}
    </li>
  );
};
