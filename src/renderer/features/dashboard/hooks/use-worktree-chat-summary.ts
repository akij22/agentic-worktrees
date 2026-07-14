import { useCallback, useEffect, useState } from 'react';
import type { Worktree } from '../../../../shared/db/schema';
import type { CodingAgentSessionSnapshotDto } from '../../../../shared/ipc/schemas';

export type WorktreeChatSummaryState =
  | { status: 'idle' | 'loading' | 'empty' }
  | { status: 'ready'; snapshot: CodingAgentSessionSnapshotDto }
  | { status: 'error'; message: string };

export const useWorktreeChatSummary = (
  worktree: Worktree | undefined,
): WorktreeChatSummaryState => {
  const [summary, setSummary] = useState<WorktreeChatSummaryState>({
    status: 'idle',
  });

  const load = useCallback(async () => {
    if (!worktree) {
      setSummary({ status: 'idle' });
      return;
    }

    setSummary({ status: 'loading' });
    try {
      const sessions = await window.api.codingAgent.listSessions({
        worktreeId: worktree.id,
      });
      const session =
        sessions.find((candidate) => candidate.id === worktree.activeRunId) ??
        sessions[0];

      if (!session) {
        setSummary({ status: 'empty' });
        return;
      }

      const snapshot = await window.api.codingAgent.getSession({
        runId: session.id,
      });
      setSummary({ status: 'ready', snapshot });
    } catch (error) {
      setSummary({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [worktree]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!worktree?.activeRunId) return;

    return window.api.codingAgent.onEvent((event) => {
      if (
        event.runId === worktree.activeRunId &&
        (event.type === 'messages.updated' || event.type === 'diff.updated')
      ) {
        void load();
      }
    });
  }, [load, worktree?.activeRunId]);

  return summary;
};
