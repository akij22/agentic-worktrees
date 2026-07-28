import { AlertCircle, Eye, FileWarning, LoaderCircle } from 'lucide-react';
import type { WorkspaceFilePreviewDto } from '../../../../shared/ipc/schemas';
import { Badge } from '../../../components/ui/badge';

type FilePreviewProps = {
  preview?: WorkspaceFilePreviewDto;
  selectedFile?: string;
  loading: boolean;
  error?: string;
};

const formatBytes = (size: number): string => {
  if (size < 1_024) return `${size} B`;
  return `${(size / 1_024).toFixed(size < 10_240 ? 1 : 0)} KiB`;
};

export const FilePreview = ({
  preview,
  selectedFile,
  loading,
  error,
}: FilePreviewProps) => (
  <section className="flex min-h-0 flex-1 flex-col bg-background/40" aria-label="Anteprima file">
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <Eye aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium"
        title={selectedFile}
      >
        {selectedFile ?? 'Seleziona un file'}
      </span>
      {preview ? (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatBytes(preview.size)}
        </span>
      ) : null}
      <Badge variant="outline" className="shrink-0 text-[9px] uppercase tracking-wide">
        Sola lettura
      </Badge>
    </header>

    <div className="min-h-0 flex-1 overflow-auto">
      {loading ? (
        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          Caricamento anteprima…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="m-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : preview?.kind === 'text' ? (
        <pre className="min-h-full whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-foreground">
          {preview.content}
        </pre>
      ) : preview ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
          <FileWarning aria-hidden="true" className="size-5 opacity-70" />
          <p>
            {preview.kind === 'empty'
              ? 'Il file è vuoto.'
              : preview.kind === 'binary'
                ? 'Anteprima non disponibile per i file binari.'
                : 'Il file supera il limite di anteprima di 1 MiB.'}
          </p>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
          Seleziona un file dall’albero per visualizzarne il contenuto.
        </div>
      )}
    </div>
  </section>
);
