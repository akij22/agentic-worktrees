import {
  AlertCircle,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceGitStatusDto } from '../../../../shared/ipc/schemas';
import { Button } from '../../../components/ui/button';
import { CommitDialog } from './CommitDialog';
import { PullRequestDialog } from './PullRequestDialog';
import {
  canCommit,
  canOpenPullRequest,
  canPush,
  shouldShowOpenPullRequest,
} from './workspace-panel-state';

type Operation = 'commit' | 'push' | 'pull-request';

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const WorkspaceGitActions = ({
  worktreeId,
}: {
  worktreeId: string;
}) => {
  const [status, setStatus] = useState<WorkspaceGitStatusDto>();
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<Operation>();
  const [error, setError] = useState<string>();
  const [commitOpen, setCommitOpen] = useState(false);
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  const busy = operation !== undefined;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setStatus(
        await window.api.workspace.git.getStatus({ worktreeId }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const commit = async (message: string) => {
    setOperation('commit');
    setError(undefined);
    try {
      setStatus(
        await window.api.workspace.git.commit({ worktreeId, message }),
      );
      setCommitOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(undefined);
    }
  };

  const push = async () => {
    setOperation('push');
    setError(undefined);
    try {
      setStatus(await window.api.workspace.git.push({ worktreeId }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(undefined);
    }
  };

  const createPullRequest = async ({
    title,
    body,
  }: {
    title: string;
    body: string;
  }) => {
    if (!status?.baseBranch) return;
    setOperation('pull-request');
    setError(undefined);
    try {
      await window.api.workspace.git.openPullRequest({
        worktreeId,
        title,
        body,
        baseBranch: status.baseBranch,
      });
      setPullRequestOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(undefined);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 shrink-0 bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!status || !canCommit(status, busy)}
            onClick={() => {
              setError(undefined);
              setCommitOpen(true);
            }}
            className="min-w-0 px-2"
          >
            {operation === 'commit' ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <GitCommitHorizontal aria-hidden="true" />
            )}
            <span className="truncate">Commit</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!status || !canPush(status, busy)}
            onClick={() => void push()}
            className="min-w-0 px-2"
          >
            {operation === 'push' ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Upload aria-hidden="true" />
            )}
            <span className="truncate">Push</span>
          </Button>
          {status && shouldShowOpenPullRequest(status) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canOpenPullRequest(status, busy)}
              onClick={() => {
                setError(undefined);
                setPullRequestOpen(true);
              }}
              className="min-w-0 px-2"
            >
              <GitPullRequest aria-hidden="true" />
              <span className="truncate">Open PR</span>
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
        {loading ? (
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground" aria-live="polite">
            <LoaderCircle
              aria-hidden="true"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
            Aggiornamento stato Git…
          </p>
        ) : error && !commitOpen && !pullRequestOpen ? (
          <p
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-[10px] text-destructive"
          >
            <AlertCircle aria-hidden="true" className="mt-px size-3 shrink-0" />
            {error}
          </p>
        ) : status ? (
          <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
            {status.currentBranch}
            {status.ahead > 0 ? ` · ${status.ahead} da pubblicare` : ''}
            {status.behind > 0 ? ` · ${status.behind} indietro` : ''}
          </p>
        ) : null}
      </div>

      <CommitDialog
        open={commitOpen}
        busy={operation === 'commit'}
        error={commitOpen ? error : undefined}
        onOpenChange={(open) => {
          if (!busy) {
            setCommitOpen(open);
            if (!open) setError(undefined);
          }
        }}
        onCommit={(message) => void commit(message)}
      />
      <PullRequestDialog
        open={pullRequestOpen}
        busy={operation === 'pull-request'}
        error={pullRequestOpen ? error : undefined}
        initialTitle={status?.suggestedPullRequestTitle ?? ''}
        baseBranch={status?.baseBranch ?? ''}
        onOpenChange={(open) => {
          if (!busy) {
            setPullRequestOpen(open);
            if (!open) setError(undefined);
          }
        }}
        onCreate={(input) => void createPullRequest(input)}
      />
    </>
  );
};
