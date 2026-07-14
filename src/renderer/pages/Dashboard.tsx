import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Repository, Worktree } from '../../shared/db/schema';
import type { BranchDto, RemoteRepositoryDto } from '../../shared/ipc/schemas';
import { Button } from '../components/ui/button';
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
import { RepositorySidebar } from '../features/dashboard/components/RepositorySidebar';
import { RepositoryWorkspace } from '../features/dashboard/components/RepositoryWorkspace';
import { useWorktreeChatSummary } from '../features/dashboard/hooks/use-worktree-chat-summary';
import {
  filterRepositories,
  resolveSelectedRepositoryId,
  resolveSelectedWorktreeId,
} from '../features/dashboard/dashboard-state';

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

export const Dashboard = () => {
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [addRepository, setAddRepository] = useState<AddRepositoryState>({
    status: 'closed',
  });
  const [dialog, setDialog] = useState<DialogState>({ status: 'closed' });
  const [createdWorktrees, setCreatedWorktrees] = useState<
    Record<string, Worktree[]>
  >({});
  const [repositoryQuery, setRepositoryQuery] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string>();
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string>();

  const loadRepos = useCallback(async (refresh: boolean) => {
    setLoadState({ status: 'loading' });
    try {
      const repos = await window.api.github.listRepos({ refresh });
      const persistedWorktrees = await window.api.worktrees.listAll();
      const groupedWorktrees = persistedWorktrees.reduce<Record<string, Worktree[]>>(
        (grouped, worktree) => {
          grouped[worktree.repositoryId] = [
            ...(grouped[worktree.repositoryId] ?? []),
            worktree,
          ];
          return grouped;
        },
        {},
      );
      setCreatedWorktrees(groupedWorktrees);
      setSelectedRepositoryId((currentId) =>
        resolveSelectedRepositoryId(repos, currentId),
      );
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

  const repositories = loadState.status === 'success' ? loadState.repos : [];
  const visibleRepositories = useMemo(
    () => filterRepositories(repositories, repositoryQuery),
    [repositories, repositoryQuery],
  );
  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepositoryId),
    [repositories, selectedRepositoryId],
  );
  const selectedRepositoryWorktrees = useMemo(
    () =>
      selectedRepository ? (createdWorktrees[selectedRepository.id] ?? []) : [],
    [createdWorktrees, selectedRepository],
  );

  useEffect(() => {
    setSelectedWorktreeId((currentId) =>
      resolveSelectedWorktreeId(selectedRepositoryWorktrees, currentId),
    );
  }, [selectedRepositoryId, selectedRepositoryWorktrees]);

  const selectedWorktree = useMemo(
    () =>
      selectedRepositoryWorktrees.find(
        (worktree) => worktree.id === selectedWorktreeId,
      ) ?? selectedRepositoryWorktrees[0],
    [selectedRepositoryWorktrees, selectedWorktreeId],
  );
  const worktreeChatSummary = useWorktreeChatSummary(selectedWorktree);

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
      setSelectedRepositoryId(repo.id);
      setSelectedWorktreeId(worktree.id);
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
    <>
      <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
        <RepositorySidebar
          repositories={visibleRepositories}
          selectedRepositoryId={selectedRepositoryId}
          query={repositoryQuery}
          loading={loadState.status === 'idle' || loadState.status === 'loading'}
          onAdd={openAddRepositoryDialog}
          onRefresh={() => void loadRepos(false)}
          onQueryChange={setRepositoryQuery}
          onSelect={setSelectedRepositoryId}
        />

        {loadState.status === 'error' ? (
          <section className="flex min-w-0 flex-1 items-center justify-center p-8">
            <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 px-8 py-7 text-center">
              <h2 className="text-base font-semibold text-destructive">
                Failed to load repositories
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {loadState.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={() => void loadRepos(true)}
              >
                Retry
              </Button>
            </div>
          </section>
        ) : loadState.status === 'success' && repositories.length === 0 ? (
          <section className="flex min-w-0 flex-1 items-center justify-center p-8">
            <div className="max-w-md rounded-lg border border-dashed border-border px-8 py-10 text-center">
              <h2 className="text-base font-semibold">No repositories</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Add a local repository or select repositories from the connected
                GitHub account.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-5"
                onClick={openAddRepositoryDialog}
              >
                Add repository
              </Button>
            </div>
          </section>
        ) : (
          <RepositoryWorkspace
            repository={selectedRepository}
            worktrees={selectedRepositoryWorktrees}
            selectedWorktreeId={selectedWorktreeId}
            chatSummary={worktreeChatSummary}
            onCreateWorktree={openCreateDialog}
            onSelectWorktree={setSelectedWorktreeId}
            onOpenCodingAgent={(worktree) =>
              navigate(
                worktree.activeRunId
                  ? `/coding-agent/${worktree.id}/${worktree.activeRunId}`
                  : `/coding-agent?worktreeId=${encodeURIComponent(worktree.id)}&new=1`,
              )
            }
          />
        )}
      </div>

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
    </>
  );
};
