import { useEffect, useRef, useState } from 'react';
import type { ActiveFileMention } from '../lib/file-mentions';

type FileMentionSuggestionState = {
  paths: string[];
  loading: boolean;
  error?: string;
};

const emptyState: FileMentionSuggestionState = {
  paths: [],
  loading: false,
};

export const useFileMentionSuggestions = ({
  worktreeId,
  mention,
}: {
  worktreeId: string;
  mention?: ActiveFileMention;
}): FileMentionSuggestionState => {
  const [state, setState] = useState<FileMentionSuggestionState>(emptyState);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!mention) {
      setState(emptyState);
      return;
    }

    setState({ paths: [], loading: true });
    const timer = window.setTimeout(() => {
      void window.api.workspace.files
        .search({
          worktreeId,
          query: mention.query,
          limit: 20,
        })
        .then((paths) => {
          if (requestId === requestIdRef.current) {
            setState({ paths, loading: false });
          }
        })
        .catch((cause: unknown) => {
          if (requestId === requestIdRef.current) {
            setState({
              paths: [],
              loading: false,
              error: cause instanceof Error ? cause.message : String(cause),
            });
          }
        });
    }, 100);

    return () => {
      window.clearTimeout(timer);
      if (requestId === requestIdRef.current) requestIdRef.current += 1;
    };
  }, [mention?.end, mention?.query, mention?.start, worktreeId]);

  return state;
};
