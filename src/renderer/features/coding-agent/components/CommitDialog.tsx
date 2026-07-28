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

type CommitDialogProps = {
  open: boolean;
  busy: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onCommit: (message: string) => void;
};

export const CommitDialog = ({
  open,
  busy,
  error,
  onOpenChange,
  onCommit,
}: CommitDialogProps) => {
  const [message, setMessage] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) setMessage('');
    wasOpen.current = open;
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = message.trim();
          if (normalized && !busy) onCommit(normalized);
        }}
      >
        <DialogHeader>
          <DialogTitle>Crea commit</DialogTitle>
          <DialogDescription>
            Tutte le modifiche, incluse aggiunte ed eliminazioni, verranno
            incluse con <span className="font-mono">git add -A</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-2">
          <Label htmlFor="workspace-commit-message">
            Messaggio di commit
          </Label>
          <Input
            id="workspace-commit-message"
            autoFocus
            value={message}
            maxLength={10_000}
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? 'workspace-commit-error' : undefined
            }
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Descrivi le modifiche"
          />
          {error ? (
            <p
              id="workspace-commit-error"
              role="alert"
              className="text-xs text-destructive"
            >
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
          <Button type="submit" disabled={busy || !message.trim()}>
            {busy ? 'Commit in corso…' : 'Crea commit'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
};
