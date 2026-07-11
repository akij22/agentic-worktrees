import { useCallback, useEffect, useState } from 'react';
import type { Repository, Worktree } from '../../shared/db/schema';
import type { BranchDto, RemoteRepositoryDto } from '../../shared/ipc/schemas';
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

type AddRepositoryState =
  | { status: 'closed' }
  | {
      status: 'open';
      mode: 'idle' | 'local' | 'remote-loading' | 'remote-selecting' | 'remote-importing';
      remoteCandidates: RemoteRepositoryDto[];
      selectedRemoteIds: number[];
      error?: string;
    };

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

const isLocalRepository = (repo: Repository): boolean => repo.githubRepoId < 0;

export const Dashboard = () => {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [addRepository, setAddRepository] = useState<AddRepositoryState>({
    status: 'closed',
  });
  const [dialog, setDialog] = useState<DialogState>({ status: 'closed' });
  const [createdWorktrees, setCreatedWorktrees] = useState<
    Record<string, Worktree[]>
  >({});

  const loadRepos = useCallback(async (refresh: boolean) => {
    setLoadState({ status: 'loading' });
    try {
      const repos = await window.api.github.listRepos({ refresh });
      setLoadState({ status: 'success', repos });
      return repos;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLoadState({
        status: 'error',
        message,
      });
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    void loadRepos(false);
  }, [loadRepos]);

  const openAddRepositoryDialog = useCallback(() => {
    setAddRepository({
      status: 'open',
      mode: 'idle',
      remoteCandidates: [],
      selectedRemoteIds: [],
    });
  }, []);

  const closeAddRepositoryDialog = useCallback(() => {
    setAddRepository({ status: 'closed' });
  }, []);

  const importLocalRepository = useCallback(async () => {
    setAddRepository((prev) =>
      prev.status === 'open'
        ? { ...prev, mode: 'local', error: undefined }
        : prev,
    );

    try {
      const repository = await window.api.repositories.importLocal();
      if (repository) {
        await loadRepos(false);
        setAddRepository({ status: 'closed' });
        return;
      }
      setAddRepository({
        status: 'open',
        mode: 'idle',
        remoteCandidates: [],
        selectedRemoteIds: [],
      });
    } catch (error) {
      setAddRepository((prev) =>
        prev.status === 'open'
          ? {
              ...prev,
              mode: 'idle',
              error: error instanceof Error ? error.message : String(error),
            }
          : prev,
      );
    }
  }, [loadRepos]);

  const importRemoteRepositories = useCallback(async () => {
    setAddRepository((prev) =>
      prev.status === 'open'
        ? { ...prev, mode: 'remote-loading', error: undefined }
        : prev,
    );

    try {
      const remoteCandidates = await window.api.github.listRemoteRepos();
      setAddRepository((prev) =>
        prev.status === 'open'
          ? {
              ...prev,
              mode: 'remote-selecting',
              remoteCandidates,
              selectedRemoteIds: [],
            }
          : prev,
      );
    } catch (error) {
      setAddRepository((prev) =>
        prev.status === 'open'
          ? {
              ...prev,
              mode: 'idle',
              remoteCandidates: [],
              selectedRemoteIds: [],
              error: error instanceof Error ? error.message : String(error),
            }
          : prev,
      );
    }
  }, []);

  const toggleRemoteRepository = useCallback((repositoryId: number) => {
    setAddRepository((prev) => {
      if (prev.status !== 'open' || prev.mode !== 'remote-selecting') {
        return prev;
      }
      const selectedRemoteIds = prev.selectedRemoteIds.includes(repositoryId)
        ? prev.selectedRemoteIds.filter((id) => id !== repositoryId)
        : [...prev.selectedRemoteIds, repositoryId];
      return { ...prev, selectedRemoteIds, error: undefined };
    });
  }, []);

  const confirmRemoteRepositories = useCallback(async () => {
    if (addRepository.status !== 'open') return;
    if (addRepository.selectedRemoteIds.length === 0) {
      setAddRepository((prev) =>
        prev.status === 'open'
          ? { ...prev, error: 'Select at least one repository.' }
          : prev,
      );
      return;
    }

    const repositoryIds = addRepository.selectedRemoteIds;
    setAddRepository((prev) =>
      prev.status === 'open'
        ? { ...prev, mode: 'remote-importing', error: undefined }
        : prev,
    );
    try {
      await window.api.repositories.importRemote({ repositoryIds });
      await loadRepos(false);
      setAddRepository({ status: 'closed' });
    } catch (error) {
      setAddRepository((prev) =>
        prev.status === 'open'
          ? {
              ...prev,
              mode: 'remote-selecting',
              error: error instanceof Error ? error.message : String(error),
            }
          : prev,
      );
    }
  }, [addRepository, loadRepos]);

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
            Load repositories from a local folder or sync them from GitHub.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openAddRepositoryDialog}
            disabled={loadState.status === 'loading'}
          >
            +
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadRepos(false)}
            disabled={loadState.status === 'loading'}
          >
            {loadState.status === 'loading' ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
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
              Add a local repository or import all repositories available from
              GitHub with the `+` button.
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
                      {isLocalRepository(repo) ? repo.name : repo.fullName}
                    </CardTitle>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge variant="outline">
                        {isLocalRepository(repo) ? 'Local' : 'Remote'}
                      </Badge>
                      {repo.isPrivate && (
                        <Badge variant="secondary">Private</Badge>
                      )}
                      {repo.isArchived && (
                        <Badge variant="outline">Archived</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription className="truncate">
                    {isLocalRepository(repo)
                      ? repo.localRootPath ?? 'Local path unavailable'
                      : `default: ${repo.defaultBranch ?? '—'}`}
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

      {addRepository.status === 'open' && (
        <Dialog open onOpenChange={(open) => !open && closeAddRepositoryDialog()}>
          <DialogHeader>
            <DialogTitle>Add repository</DialogTitle>
            <DialogDescription>
              Choose a local repository or select one or more repositories from
              the connected GitHub account.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-3">
            <button
              type="button"
              className="rounded-lg border border-border bg-muted/40 p-4 text-left transition-colors hover:bg-muted"
              onClick={() => void importLocalRepository()}
              disabled={addRepository.mode !== 'idle'}
            >
              <div className="text-sm font-semibold">Local path</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Select a folder on this computer. The app checks for a valid
                `.git` repository before adding it.
              </div>
            </button>

            {addRepository.mode === 'remote-loading' && (
              <p className="rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                Loading repositories from GitHub…
              </p>
            )}

            {(addRepository.mode === 'remote-selecting' ||
              addRepository.mode === 'remote-importing') && (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Select repositories</div>
                    <div className="text-xs text-muted-foreground">
                      {addRepository.remoteCandidates.length} available ·{' '}
                      {addRepository.selectedRemoteIds.length} selected
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAddRepository((prev) =>
                        prev.status === 'open'
                          ? {
                              ...prev,
                              selectedRemoteIds:
                                prev.selectedRemoteIds.length ===
                                prev.remoteCandidates.length
                                  ? []
                                  : prev.remoteCandidates.map(
                                      (repository) => repository.githubRepoId,
                                    ),
                              error: undefined,
                            }
                          : prev,
                      )
                    }
                    disabled={
                      addRepository.mode === 'remote-importing' ||
                      addRepository.remoteCandidates.length === 0
                    }
                  >
                    {addRepository.remoteCandidates.length > 0 &&
                    addRepository.selectedRemoteIds.length ===
                    addRepository.remoteCandidates.length
                      ? 'Clear all'
                      : 'Select all'}
                  </Button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background">
                  {addRepository.remoteCandidates.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      No repositories are available from this GitHub account.
                    </p>
                  ) : (
                    addRepository.remoteCandidates.map((repository) => {
                      const selected = addRepository.selectedRemoteIds.includes(
                        repository.githubRepoId,
                      );
                      return (
                        <label
                          key={repository.githubRepoId}
                          className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              toggleRemoteRepository(repository.githubRepoId)
                            }
                            disabled={addRepository.mode === 'remote-importing'}
                            className="mt-1 size-4 accent-primary"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {repository.fullName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {repository.isPrivate ? 'Private' : 'Public'} · default:{' '}
                              {repository.defaultBranch ?? '—'}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                <Button
                  type="button"
                  className="mt-3 w-full"
                  onClick={() => void confirmRemoteRepositories()}
                  disabled={
                    addRepository.mode === 'remote-importing' ||
                    addRepository.selectedRemoteIds.length === 0
                  }
                >
                  {addRepository.mode === 'remote-importing'
                    ? 'Adding repositories…'
                    : `Add selected (${addRepository.selectedRemoteIds.length})`}
                </Button>
              </div>
            )}

            <button
              type="button"
              className="rounded-lg border border-border bg-muted/40 p-4 text-left transition-colors hover:bg-muted"
              onClick={() => void importRemoteRepositories()}
              disabled={addRepository.mode !== 'idle'}
            >
              <div className="text-sm font-semibold">GitHub remote</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Browse the repositories available from the connected GitHub
                profile and choose which ones to add.
              </div>
            </button>

            {addRepository.error && (
              <p className="text-sm text-destructive">{addRepository.error}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeAddRepositoryDialog}
              disabled={
                addRepository.mode === 'local' ||
                addRepository.mode === 'remote-loading' ||
                addRepository.mode === 'remote-importing'
              }
            >
              Cancel
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
};
