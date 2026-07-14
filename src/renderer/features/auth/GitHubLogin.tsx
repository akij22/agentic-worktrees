import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  GitFork,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '../../components/ui/card';
import { getUserFacingAuthActionError } from './auth-state';
import { useGitHubAuth } from './useGitHubAuth';

const useRemainingSeconds = (expiresAt?: number): number | null => {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000)));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  return remaining;
};

export const GitHubLogin = () => {
  const auth = useGitHubAuth();
  const { challenge, error, busy, status } = auth.state;
  const remainingSeconds = useRemainingSeconds(challenge?.expiresAt);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copyCode = async () => {
    if (!challenge) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(challenge.userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
      setCopyError(getUserFacingAuthActionError('clipboard'));
    }
  };

  const isExpired = remainingSeconds === 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-5 py-10">
      <Card className="w-full max-w-md overflow-hidden shadow-md">
        <CardHeader className="border-b border-border bg-card pb-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex size-10 items-center justify-center rounded-md border border-border bg-foreground text-background">
              <GitFork className="size-5" />
            </div>
            <Badge variant="outline" className="font-mono uppercase tracking-wider">
              GitHub connection
            </Badge>
          </div>
          <h1 className="text-xl font-semibold leading-none tracking-tight">
            Agentic Worktrees
          </h1>
          <CardDescription className="mt-1 leading-5">
            Sign in to load repositories, branches, and pull request context.
            Access is handled by GitHub and credentials stay in the main process.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          {auth.view === 'loading' ? (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Checking GitHub connection…
            </div>
          ) : null}

          {auth.view === 'sign-in' || auth.view === 'error' ? (
            <>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm leading-5 text-muted-foreground">
                    You’ll authorize this app in your browser, then choose which
                    repositories its GitHub App installation can access.
                  </p>
                </div>
              </div>
              {error || status.message ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error ?? status.message}
                </p>
              ) : null}
              <Button
                className="w-full"
                onClick={status.recoverable ? auth.retrySession : auth.startLogin}
                disabled={busy}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <GitFork />}
                {status.recoverable ? 'Retry existing session' : error ? 'Retry GitHub sign-in' : 'Sign in with GitHub'}
              </Button>
              {status.errorCode === 'saml_required' ? (
                <Button variant="outline" className="w-full" onClick={auth.openAuthorizationSettings}>
                  <ExternalLink /> Manage SSO authorization
                </Button>
              ) : null}
              {status.errorCode === 'organization_approval_required' ||
              status.errorCode === 'insufficient_permissions' ? (
                <Button variant="outline" className="w-full" onClick={auth.openInstallation}>
                  <ExternalLink /> Manage GitHub App access
                </Button>
              ) : null}
              {status.errorCode === 'session_expired' ? (
                <Button variant="ghost" className="w-full" onClick={auth.openAuthorizationSettings}>
                  Manage GitHub authorization
                </Button>
              ) : null}
            </>
          ) : null}

          {auth.view === 'authorization' ? (
            challenge ? (
              <>
                <div>
                  <p className="text-sm font-medium">Enter this one-time code</p>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="mt-2 flex w-full items-center justify-between rounded-md border border-foreground/20 bg-foreground px-4 py-3 text-left text-background transition-opacity hover:opacity-90"
                  >
                    <span className="font-mono text-xl font-semibold tracking-[0.22em]">
                      {challenge.userCode}
                    </span>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </button>
                  <p
                    role="timer"
                    className="mt-2 text-xs text-muted-foreground"
                  >
                    {isExpired
                      ? 'This code has expired. Start again for a new code.'
                      : remainingSeconds === null
                        ? 'Waiting for expiry information…'
                        : `Expires in ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`}
                  </p>
                  <span role="status" aria-live="polite" className="sr-only">
                    {isExpired ? 'The GitHub device code has expired.' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={copyCode} disabled={isExpired}>
                    <Copy /> {copied ? 'Copied' : 'Copy code'}
                  </Button>
                  <Button onClick={auth.openDeviceVerification} disabled={isExpired}>
                    <ExternalLink /> Open GitHub
                  </Button>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-4">
                  <span
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    {!isExpired ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    {isExpired ? 'Authorization stopped' : 'Waiting for authorization'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={isExpired ? auth.startLogin : auth.cancelLogin}
                    disabled={busy}
                  >
                    {isExpired ? 'Get new code' : 'Cancel'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The previous authorization cannot be resumed in this window.
                </p>
                <Button className="w-full" onClick={auth.startLogin}>
                  Start again
                </Button>
              </div>
            )
          ) : null}

          {auth.view === 'installation' ? (
            <>
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-3">
                {status.profile ? (
                  <img
                    src={status.profile.avatarUrl}
                    alt=""
                    className="size-10 rounded-md border border-border"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    @{status.profile?.login ?? 'GitHub user'} connected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Repository access still needs to be installed.
                  </p>
                </div>
              </div>
              <Button className="w-full" onClick={auth.openInstallation}>
                <ExternalLink /> Install GitHub App
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={auth.refreshInstallations}
                disabled={busy}
              >
                {busy && <LoaderCircle className="animate-spin" />}
                Check installation
              </Button>
              <Button variant="ghost" className="w-full" onClick={auth.logout}>
                Sign out
              </Button>
            </>
          ) : null}

          {copyError ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {copyError}
            </p>
          ) : null}
          {auth.actionError ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {auth.actionError}
            </p>
          ) : null}
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? 'Device code copied.' : ''}
          </span>
        </CardContent>
      </Card>
    </main>
  );
};
