import {
  FolderGit2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Repository } from '../../../../shared/db/schema';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';
import {
  getRepositoryLabel,
  isLocalRepository,
} from '../dashboard-state';

interface RepositorySidebarProps {
  repositories: Repository[];
  selectedRepositoryId?: string;
  query: string;
  loading: boolean;
  onAdd: () => void;
  onRefresh: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (repositoryId: string) => void;
}

export const RepositorySidebar = ({
  repositories,
  selectedRepositoryId,
  query,
  loading,
  onAdd,
  onRefresh,
  onQueryChange,
  onSelect,
}: RepositorySidebarProps) => {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="shrink-0 px-3 pb-3 pt-5">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Repositories
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onAdd}
            aria-label="Add repository"
            title="Add repository"
          >
            <Plus aria-hidden="true" />
          </Button>
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
              return (
                <button
                  key={repository.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onSelect(repository.id)}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    selected
                      ? 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )}
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
