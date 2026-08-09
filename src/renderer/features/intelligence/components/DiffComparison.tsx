import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IntelligenceDiffComparisonDto } from '../../../../shared/ipc/schemas';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { cn } from '../../../lib/utils';

type Props = {
  overlapId: string | null;
  open: boolean;
  onClose: () => void;
  onOpenChat: (worktreeId: string, runId: string) => void;
};

const Patch = ({ patch, binary }: { patch: string | null; binary: boolean }) => {
  if (binary) return <p className="p-3 text-xs text-muted-foreground">Binary file changed</p>;
  if (!patch) return <p className="p-3 text-xs text-muted-foreground">No textual patch stored</p>;
  return (
    <pre className="overflow-x-auto p-3 font-mono text-[10px] leading-5">
      {patch.split('\n').map((line, index) => (
        <span key={index} className={cn('block', line.startsWith('+') && 'bg-emerald-500/10 text-emerald-300', line.startsWith('-') && 'bg-red-500/10 text-red-300')}>{line || ' '}</span>
      ))}
    </pre>
  );
};

export const DiffComparison = ({ overlapId, open, onClose, onOpenChat }: Props) => {
  const [comparison, setComparison] = useState<IntelligenceDiffComparisonDto>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open || !overlapId) return;
    let cancelled = false;
    setComparison(undefined);
    setError(undefined);
    void window.api.intelligence.compareDiffs({ overlapId })
      .then((value) => { if (!cancelled) setComparison(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [open, overlapId]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }} className="flex max-h-[88vh] max-w-6xl flex-col overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div><DialogTitle>Diff comparison</DialogTitle><DialogDescription className="mt-1">Two persisted worktree deltas against their merge base.</DialogDescription></div>
          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Close diff comparison" onClick={onClose}><X /></Button>
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !comparison ? <p className="text-sm text-muted-foreground">Loading patches…</p> : (
          <div className="grid min-w-[720px] grid-cols-2 gap-3">
            {[comparison.left, comparison.right].map((side) => (
              <section key={side.worktreeId} className="min-w-0 overflow-hidden rounded-lg border border-border bg-background/50">
                <header className="flex items-center justify-between border-b border-border px-3 py-2">
                  <code className="text-[10px]">{side.worktreeId}</code>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={!side.runId} aria-label={`Open chat for ${side.worktreeId}`} onClick={() => side.runId && onOpenChat(side.worktreeId, side.runId)}><ExternalLink /> Chat</Button>
                </header>
                {side.files.map((file) => (
                  <article key={file.path} className="border-b border-border last:border-b-0">
                    <div className="flex justify-between bg-muted/40 px-3 py-2 font-mono text-[10px]"><span>{file.path}</span><span><b className="text-emerald-400">+{file.additions}</b> <b className="text-red-400">−{file.deletions}</b></span></div>
                    <Patch patch={file.patch} binary={file.binary} />
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
};
