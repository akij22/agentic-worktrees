import { useEffect, useState } from 'react';
import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  GitFork,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '../../components/ui/card';
import loginBackground from '../../assets/auth/red-black-waves-visax.webp';
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

  const primaryLabel = status.recoverable
    ? 'Retry existing session'
    : error
      ? 'Retry GitHub sign-in'
      : 'Sign in with GitHub';

  const authErrorMessage = error ?? status.message;

  return (
    <main className="relative isolate h-screen overflow-y-auto bg-[#160607] animate-in fade-in duration-300 ease-out">
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        className="fixed inset-0 -z-30 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-[linear-gradient(115deg,rgba(23,5,7,0.22)_0%,rgba(18,5,6,0.36)_48%,rgba(8,3,4,0.64)_100%)] dark:bg-[linear-gradient(115deg,rgba(8,2,3,0.44)_0%,rgba(8,2,3,0.58)_50%,rgba(3,1,2,0.78)_100%)]"
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_67%_34%,rgba(255,255,255,0.14),transparent_30%)] opacity-70 dark:opacity-40"
      />

      <div className="mx-auto flex min-h-full w-full max-w-6xl items-center justify-center px-5 py-10 sm:px-8 lg:pl-24 lg:pr-0">
        <Card className="w-full max-w-md overflow-hidden border-white/35 bg-card/90 shadow-[0_32px_100px_-28px_rgba(0,0,0,0.85)] backdrop-blur-2xl supports-[backdrop-filter]:bg-card/80 dark:border-white/15 dark:bg-card/90 dark:supports-[backdrop-filter]:bg-card/75">
          <CardHeader className="border-b border-border/70 bg-card/35 pb-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex size-10 items-center justify-center rounded-md border border-border/80 bg-foreground text-background shadow-sm">
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
                className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground"
              >
                <LoaderCircle className="size-5 animate-spin text-primary" />
                Checking GitHub connection…
              </div>
            ) : null}

            {auth.view === 'sign-in' || auth.view === 'error' ? (
              <>
                {authErrorMessage ? (
                  <Alert variant="destructive">
                    <CircleAlert />
                    <AlertTitle>Couldn’t sign in to GitHub</AlertTitle>
                    <AlertDescription>{authErrorMessage}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  size="lg"
                  className="w-full"
                  onClick={status.recoverable ? auth.retrySession : auth.startLogin}
                  disabled={busy}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <GitFork />}
                  {primaryLabel}
                </Button>
                {status.errorCode === 'saml_required' ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={auth.openAuthorizationSettings}
                  >
                    <ExternalLink /> Manage SSO authorization
                  </Button>
                ) : null}
                {status.errorCode === 'organization_approval_required' ||
                status.errorCode === 'insufficient_permissions' ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={auth.openInstallation}
                  >
                    <ExternalLink /> Manage GitHub App access
                  </Button>
                ) : null}
                {status.errorCode === 'session_expired' ? (
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={auth.openAuthorizationSettings}
                  >
                    Manage GitHub authorization
                  </Button>
                ) : null}
                <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-xs leading-5 text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  Authorization happens in your browser. Credentials stay in the
                  main process.
                </p>
              </>
            ) : null}

            {auth.view === 'authorization' ? (
              challenge ? (
                <div className="space-y-5">
                  <div className="space-y-1 text-center">
                    <p className="text-sm font-medium">Enter this one-time code</p>
                    <p className="text-xs text-muted-foreground">
                      Paste it on GitHub to confirm the sign-in.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="flex w-full items-center justify-between rounded-lg border border-foreground/15 bg-foreground px-5 py-3.5 text-left text-background transition-opacity hover:opacity-90"
                  >
                    <span className="font-mono text-2xl font-semibold tracking-[0.24em]">
                      {challenge.userCode}
                    </span>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </button>
                  <p role="timer" className="text-center text-xs text-muted-foreground">
                    {isExpired
                      ? 'This code has expired. Start again for a new code.'
                      : remainingSeconds === null
                        ? 'Waiting for expiry information…'
                        : `Expires in ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`}
                  </p>
                  <span role="status" aria-live="polite" className="sr-only">
                    {isExpired ? 'The GitHub device code has expired.' : ''}
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
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
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-center text-sm text-muted-foreground">
                    The previous authorization cannot be resumed in this window.
                  </p>
                  <Button className="w-full" onClick={auth.startLogin}>
                    Start again
                  </Button>
                </div>
              )
            ) : null}

            {auth.view === 'installation' ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {status.profile ? (
                    <img
                      src={status.profile.avatarUrl}
                      alt=""
                      className="size-12 rounded-full border border-border"
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
              </div>
            ) : null}

            {copyError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Clipboard error</AlertTitle>
                <AlertDescription>{copyError}</AlertDescription>
              </Alert>
            ) : null}
            {auth.actionError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>{auth.actionError}</AlertDescription>
              </Alert>
            ) : null}
            <span role="status" aria-live="polite" className="sr-only">
              {copied ? 'Device code copied.' : ''}
            </span>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};