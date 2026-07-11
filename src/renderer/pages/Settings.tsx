import { useCallback, useEffect, useState } from 'react';
import type { CodingAgentStatusDto } from '../../shared/ipc/schemas';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';

export const Settings = () => {
  const [status, setStatus] = useState<CodingAgentStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await window.api.codingAgent.getStatus());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectExecutable = async () => {
    setSelecting(true);
    setError(undefined);
    try {
      const next = await window.api.codingAgent.selectExecutable();
      if (next) setStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Local integrations
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure executables used by Agentic Worktrees. Provider credentials
          remain managed by each coding agent.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>OpenCode</CardTitle>
              <CardDescription className="mt-1">
                Local headless coding agent for worktree-scoped sessions.
              </CardDescription>
            </div>
            <Badge
              variant={status?.configured ? 'secondary' : 'outline'}
              className="gap-1.5"
            >
              <span
                className={`size-1.5 rounded-full ${
                  status?.running
                    ? 'bg-chart-3'
                    : status?.configured
                      ? 'bg-chart-4'
                      : 'bg-muted-foreground'
                }`}
              />
              {status?.running
                ? 'Running'
                : status?.configured
                  ? 'Configured'
                  : 'Not configured'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Executable path
              </div>
              <div className="min-h-10 break-all rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs leading-5">
                {loading
                  ? 'Loading…'
                  : status?.executablePath ?? 'No executable selected'}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void selectExecutable()}
              disabled={selecting}
            >
              {selecting ? 'Validating…' : status?.configured ? 'Change path' : 'Select OpenCode'}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">Detected version</div>
              <div className="mt-1 font-mono text-sm font-medium">
                {status?.version ?? '—'}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">Server lifecycle</div>
              <div className="mt-1 text-sm font-medium">Managed by the app</div>
            </div>
          </div>

          {error || status?.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error ?? status?.error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
