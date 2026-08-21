import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  WorkspaceEntryDto,
  WorkspaceFilePreviewDto,
} from '../../../../shared/ipc/schemas';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';

type DirectoryState = {
  entries: WorkspaceEntryDto[];
  loaded: boolean;
  loading: boolean;
  error?: string;
};

const initialDirectoryState: DirectoryState = {
  entries: [],
  loaded: false,
  loading: false,
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const FileBrowserPanel = ({
  worktreeId,
}: {
  worktreeId: string;
}) => {
  const [directories, setDirectories] = useState<
    Map<string, DirectoryState>
  >(() => new Map([['', initialDirectoryState]]));
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedFile, setSelectedFile] = useState<string>();
  const [preview, setPreview] = useState<WorkspaceFilePreviewDto>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();

  const loadDirectory = useCallback(
    async (relativePath: string) => {
      setDirectories((current) => {
        const next = new Map(current);
        next.set(relativePath, {
          ...(next.get(relativePath) ?? initialDirectoryState),
          loading: true,
          error: undefined,
        });
        return next;
      });
      try {
        const entries = await window.api.workspace.files.listDirectory({
          worktreeId,
          relativePath,
        });
        setDirectories((current) => {
          const next = new Map(current);
          next.set(relativePath, {
            entries,
            loaded: true,
            loading: false,
          });
          return next;
        });
      } catch (cause) {
        setDirectories((current) => {
          const next = new Map(current);
          next.set(relativePath, {
            entries: [],
            loaded: false,
            loading: false,
            error: errorMessage(cause),
          });
          return next;
        });
      }
    },
    [worktreeId],
  );

  useEffect(() => {
    void loadDirectory('');
  }, [loadDirectory]);

  const toggleDirectory = useCallback(
    (relativePath: string) => {
      const nextExpanded = new Set(expandedDirectories);
      if (nextExpanded.has(relativePath)) {
        nextExpanded.delete(relativePath);
      } else {
        nextExpanded.add(relativePath);
        if (!directories.get(relativePath)?.loaded) {
          void loadDirectory(relativePath);
        }
      }
      setExpandedDirectories(nextExpanded);
    },
    [directories, expandedDirectories, loadDirectory],
  );

  const selectFile = useCallback(
    async (relativePath: string) => {
      setSelectedFile(relativePath);
      setPreview(undefined);
      setPreviewError(undefined);
      setPreviewLoading(true);
      try {
        setPreview(
          await window.api.workspace.files.readFile({
            worktreeId,
            relativePath,
          }),
        );
      } catch (cause) {
        setPreviewError(errorMessage(cause));
      } finally {
        setPreviewLoading(false);
      }
    },
    [worktreeId],
  );

  const entriesByDirectory = useMemo(
    () =>
      new Map(
        [...directories].map(([relativePath, state]) => [
          relativePath,
          state.entries,
        ]),
      ),
    [directories],
  );
  const loadingDirectories = useMemo(
    () =>
      new Set(
        [...directories]
          .filter(([, state]) => state.loading)
          .map(([relativePath]) => relativePath),
      ),
    [directories],
  );
  const rootState = directories.get('') ?? initialDirectoryState;

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,42%)_minmax(0,1fr)]">
      <section className="min-h-0 overflow-auto bg-muted/10 p-2" aria-label="Albero file">
        {rootState.loading && !rootState.loaded ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Caricamento file…
          </div>
        ) : rootState.error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-error-surface p-3 text-xs text-error-foreground"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {rootState.error}
          </div>
        ) : (
          <FileTree
            entriesByDirectory={entriesByDirectory}
            expandedDirectories={expandedDirectories}
            loadingDirectories={loadingDirectories}
            selectedFile={selectedFile}
            onToggleDirectory={toggleDirectory}
            onSelectFile={(relativePath) => void selectFile(relativePath)}
          />
        )}
      </section>
      <FilePreview
        preview={preview}
        selectedFile={selectedFile}
        loading={previewLoading}
        error={previewError}
      />
    </div>
  );
};
