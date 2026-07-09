import { useCallback, useEffect, useState } from 'react';
import type { Repository, Worktree } from '../../shared/db/schema';
import type { BranchDto } from '../../shared/ipc/schemas';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select } from '../components/ui/select';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; repos: Repository[] };

type DialogState =
  | { status: 'closed' }
  | {
      status: 'open';
      repo: Repository;
      branches: BranchDto[];
      branchesState: 'loading' | 'loaded' | 'error';
      branchesError?: string;
      baseBranch: string;
      newBranchName: string;
      worktreeName: string;
      submitting: boolean;
      error?: string;
    };

const initialOpenDialog = (repo: Repository): DialogState => ({
  status: 'open',
  repo,
  branches: [],
  branchesState: 'loading',
  baseBranch: repo.defaultBranch ?? '',
  newBranchName: '',
  worktreeName: '',
  submitting: false,
});

export const Dashboard = () => {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [dialog, setDialog] = useState<DialogState>({ status: 'closed' });
  const [createdWorktrees, setCreatedWorktrees] = useState<
    Record<string, Worktree[]>
  >({});

  const loadRepos = useCallback(async (refresh: boolean) => {
    setLoadState({ status: 'loading' });
    try {
      const repos = await window.api.github.listRepos({ refresh });
      setLoadState({ status: 'success', repos });
    } catch (error) {
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void loadRepos(true);
  }, [loadRepos]);

  const openCreateDialog = useCallback((repo: Repository) => {
    setDialog(initialOpenDialog(repo));
    void (async () => {
      try {
        const branches = await window.api.github.listBranches({
          repositoryId: repo.id,
        });
        setDialog((prev) =>
          prev.status === 'open'
            ? {
                ...prev,
                branches,
                branchesState: 'loaded',
                baseBranch: prev.baseBranch || branches[0]?.name || '',
              }
            : prev,
        );
      } catch (error) {
        setDialog((prev) =>
          prev.status === 'open'
            ? {
                ...prev,
                branchesState: 'error',
                branchesError:
                  error instanceof Error ? error.message : String(error),
              }
            : prev,
        );
      }
    })();
  }, []);

  const closeDialog = useCallback(() => {
    setDialog({ status: 'closed' });
  }, []);

  const submitCreate = useCallback(async () => {
    if (dialog.status !== 'open') return;
    const { repo, baseBranch, newBranchName, worktreeName } = dialog;
    if (!baseBranch || !newBranchName.trim() || !worktreeName.trim()) {
      setDialog((prev) =>
        prev.status === 'open'
          ? { ...prev, error: 'All fields are required.' }
          : prev,
      );
      return;
    }
    setDialog((prev) =>
      prev.status === 'open' ? { ...prev, submitting: true, error: undefined } : prev,
    );
    try {
      const { worktree } = await window.api.worktrees.create({
        repositoryId: repo.id,
        baseBranch,
        newBranchName: newBranchName.trim(),
        worktreeName: worktreeName.trim(),
      });
      setCreatedWorktrees((prev) => ({
        ...prev,
        [repo.id]: [...(prev[repo.id] ?? []), worktree],
      }));
      setDialog({ status: 'closed' });
    } catch (error) {
      setDialog((prev) =>
        prev.status === 'open'
          ? {
              ...prev,
              submitting: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : prev,
      );
    }
  }, [dialog]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Repositories</h2>
          <p className="text-sm text-muted-foreground">
            Remote GitHub repositories available to your installation.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadRepos(true)}
          disabled={loadState.status === 'loading'}
        >
          {loadState.status === 'loading' ? 'Syncing…' : 'Refresh'}
        </Button>
      </div>

      {loadState.status === 'loading' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {loadState.status === 'error' && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Failed to load repositories</CardTitle>
            <CardDescription>{loadState.message}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" size="sm" onClick={() => void loadRepos(true)}>
              Retry
            </Button>
          </CardFooter>
        </Card>
      )}

      {loadState.status === 'success' && loadState.repos.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No repositories</CardTitle>
            <CardDescription>
              Your GitHub App installation has no repositories. Grant access to at
              least one repository and click Refresh.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {loadState.status === 'success' && loadState.repos.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loadState.repos.map((repo) => {
            const wts = createdWorktrees[repo.id] ?? [];
            return (
              <Card key={repo.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="truncate text-base">
                      {repo.fullName}
                    </CardTitle>
                    <div className="flex shrink-0 gap-1.5">
                      {repo.isPrivate && (
                        <Badge variant="secondary">Private</Badge>
                      )}
                      {repo.isArchived && (
                        <Badge variant="outline">Archived</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription className="truncate">
                    default: {repo.defaultBranch ?? '—'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  {wts.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Recent worktrees
                      </span>
                      {wts.map((wt) => (
                        <div
                          key={wt.id}
                          className="rounded-md border border-border bg-muted/40 px-3 py-2"
                        >
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {wt.path}
                          </div>
                          <div className="mt-1 text-xs">
                            branch{' '}
                            <span className="font-medium text-foreground">
                              {wt.branchName}
                            </span>{' '}
                            from{' '}
                            <span className="text-muted-foreground">
                              {wt.baseBranchName ?? '—'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No worktrees created yet.
                    </p>
                  )}
                </CardContent>
                <CardFooter className="justify-end">
                  <Button
                    size="sm"
                    onClick={() => openCreateDialog(repo)}
                    disabled={repo.isArchived}
                  >
                    Create worktree
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {dialog.status === 'open' && (
        <Dialog open onOpenChange={(o) => !o && closeDialog()}>
          <DialogHeader>
            <DialogTitle>Create worktree — {dialog.repo.fullName}</DialogTitle>
            <DialogDescription>
              Select a base branch and provide a name for the new worktree branch.
              The repository will be cloned locally on first use.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="base-branch">Base branch</Label>
              {dialog.branchesState === 'loading' && (
                <Skeleton className="h-9 w-full" />
              )}
              {dialog.branchesState === 'error' && (
                <p className="text-sm text-destructive">
                  {dialog.branchesError ?? 'Failed to load branches.'}
                </p>
              )}
              {dialog.branchesState === 'loaded' && (
                <Select
                  id="base-branch"
                  value={dialog.baseBranch}
                  onChange={(e) =>
                    setDialog((prev) =>
                      prev.status === 'open'
                        ? { ...prev, baseBranch: e.target.value }
                        : prev,
                    )
                  }
                >
                  {dialog.branches.length === 0 && (
                    <option value="">No branches available</option>
                  )}
                  {dialog.branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.protected ? ' (protected)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-branch">New branch name</Label>
              <Input
                id="new-branch"
                value={dialog.newBranchName}
                placeholder="feature/my-change"
                onChange={(e) =>
                  setDialog((prev) =>
                    prev.status === 'open'
                      ? { ...prev, newBranchName: e.target.value }
                      : prev,
                  )
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="worktree-name">Worktree name</Label>
              <Input
                id="worktree-name"
                value={dialog.worktreeName}
                placeholder="my-change"
                onChange={(e) =>
                  setDialog((prev) =>
                    prev.status === 'open'
                      ? { ...prev, worktreeName: e.target.value }
                      : prev,
                  )
                }
              />
            </div>

            {dialog.error && (
              <p className="text-sm text-destructive">{dialog.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={dialog.submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={
                dialog.submitting ||
                dialog.branchesState !== 'loaded' ||
                !dialog.baseBranch ||
                !dialog.newBranchName.trim() ||
                !dialog.worktreeName.trim()
              }
            >
              {dialog.submitting ? 'Creating…' : 'Create worktree'}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
};