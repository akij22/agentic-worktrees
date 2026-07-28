import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
} from 'lucide-react';
import type { WorkspaceEntryDto } from '../../../../shared/ipc/schemas';

type FileTreeProps = {
  entriesByDirectory: ReadonlyMap<string, WorkspaceEntryDto[]>;
  expandedDirectories: ReadonlySet<string>;
  loadingDirectories: ReadonlySet<string>;
  selectedFile?: string;
  onToggleDirectory: (relativePath: string) => void;
  onSelectFile: (relativePath: string) => void;
};

type TreeLevelProps = FileTreeProps & {
  directoryPath: string;
  depth: number;
};

const TreeLevel = ({
  directoryPath,
  depth,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFile,
  onToggleDirectory,
  onSelectFile,
}: TreeLevelProps) => {
  const entries = entriesByDirectory.get(directoryPath) ?? [];
  return (
    <ul
      role={depth === 0 ? 'tree' : 'group'}
      aria-label={depth === 0 ? 'File del worktree' : undefined}
      className={depth === 0 ? 'space-y-0.5' : 'space-y-0.5'}
    >
      {entries.map((entry) => {
        const isDirectory = entry.kind === 'directory';
        const expanded =
          isDirectory && expandedDirectories.has(entry.relativePath);
        const loading =
          isDirectory && loadingDirectories.has(entry.relativePath);
        const selected =
          !isDirectory && selectedFile === entry.relativePath;
        const FolderIcon = expanded ? FolderOpen : Folder;

        return (
          <li key={entry.relativePath} role="treeitem" aria-expanded={isDirectory ? expanded : undefined}>
            <button
              type="button"
              onClick={() =>
                isDirectory
                  ? onToggleDirectory(entry.relativePath)
                  : onSelectFile(entry.relativePath)
              }
              aria-label={
                isDirectory
                  ? `${expanded ? 'Chiudi' : 'Apri'} cartella ${entry.name}`
                  : `Visualizza file ${entry.name}`
              }
              className={`group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                selected
                  ? 'bg-primary/12 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {isDirectory ? (
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${
                    expanded ? 'rotate-90' : ''
                  }`}
                />
              ) : (
                <span aria-hidden="true" className="w-3 shrink-0" />
              )}
              {loading ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                />
              ) : isDirectory ? (
                <FolderIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-primary/75"
                />
              ) : (
                <FileText
                  aria-hidden="true"
                  className="size-3.5 shrink-0 opacity-75"
                />
              )}
              <span
                className={`min-w-0 flex-1 truncate ${
                  entry.hidden ? 'opacity-75' : ''
                }`}
                title={entry.relativePath}
              >
                {entry.name}
              </span>
            </button>
            {isDirectory && expanded ? (
              <TreeLevel
                directoryPath={entry.relativePath}
                depth={depth + 1}
                entriesByDirectory={entriesByDirectory}
                expandedDirectories={expandedDirectories}
                loadingDirectories={loadingDirectories}
                selectedFile={selectedFile}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

export const FileTree = (props: FileTreeProps) => (
  <TreeLevel {...props} directoryPath="" depth={0} />
);
