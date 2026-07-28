import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

type PullRequestDialogProps = {
  open: boolean;
  busy: boolean;
  error?: string;
  initialTitle: string;
  baseBranch: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { title: string; body: string }) => void;
};

export const PullRequestDialog = ({
  open,
  busy,
  error,
  initialTitle,
  baseBranch,
  onOpenChange,
  onCreate,
}: PullRequestDialogProps) => {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setTitle(initialTitle);
      setBody('');
    }
    wasOpen.current = open;
  }, [initialTitle, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedTitle = title.trim();
          if (normalizedTitle && !busy) {
            onCreate({ title: normalizedTitle, body });
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Apri pull request</DialogTitle>
          <DialogDescription>
            Crea una PR non draft verso{' '}
            <span className="font-mono text-foreground">{baseBranch}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-pr-title">Titolo</Label>
            <Input
              id="workspace-pr-title"
              autoFocus
              value={title}
              maxLength={256}
              disabled={busy}
              aria-invalid={Boolean(error)}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-pr-body">Descrizione</Label>
            <textarea
              id="workspace-pr-body"
              value={body}
              maxLength={65_536}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Descrivi contesto, modifiche e validazione"
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Annulla
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Creazione PR…' : 'Crea PR'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
