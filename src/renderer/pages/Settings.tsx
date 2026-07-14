import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, GitFork, LoaderCircle, LogOut } from 'lucide-react';
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
import { useGitHubAuth } from '../features/auth/useGitHubAuth';

export const Settings = () => {
  const githubAuth = useGitHubAuth();
  const githubStatus = githubAuth.state.status;
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
          Manage your GitHub connection and local coding-agent executable.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/20">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {githubStatus.profile ? (
                <img
                  src={githubStatus.profile.avatarUrl}
                  alt=""
                  className="size-10 rounded-md border border-border bg-background"
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
                  <GitFork className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <CardTitle>GitHub</CardTitle>
                <CardDescription className="mt-1 truncate">
                  {githubStatus.profile?.name
                    ? `${githubStatus.profile.name} · @${githubStatus.profile.login}`
                    : `@${githubStatus.profile?.login ?? 'unknown'}`}
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <span className="size-1.5 rounded-full bg-chart-3" />
              Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div>
              <p className="text-xs text-muted-foreground">Repository installations</p>
              <p className="mt-0.5 text-sm font-medium">
                {githubStatus.installationCount}{' '}
                {githubStatus.installationCount === 1 ? 'installation' : 'installations'}
              </p>
            </div>
            <GitFork className="size-4 text-muted-foreground" />
          </div>

          {!githubStatus.persistent ? (
            <p className="rounded-md border border-chart-4/50 bg-chart-4/10 px-3 py-2 text-xs leading-5 text-foreground">
              Secure credential storage is unavailable. This GitHub session may
              not persist after the app closes.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={githubAuth.openInstallation}
            >
              <ExternalLink /> Manage repositories
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={githubAuth.openAuthorizationSettings}
            >
              <ExternalLink /> Manage authorization
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:ml-auto"
              onClick={githubAuth.logout}
              disabled={githubAuth.state.busy}
            >
              {githubAuth.state.busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <LogOut />
              )}
              Sign out
            </Button>
          </div>
          {githubAuth.actionError ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {githubAuth.actionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

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
