import { useCallback, useEffect, useState } from 'react';
import { Bot, GitFork } from 'lucide-react';
import type { CodingAgentStatusDto } from '../../shared/ipc/schemas';
import SettingsIntegrations, {
  type Integration,
} from '../components/ui/settings-integrations';
import { useGitHubAuth } from '../features/auth/useGitHubAuth';

export const Settings = () => {
  const githubAuth = useGitHubAuth();
  const githubStatus = githubAuth.state.status;
  const [status, setStatus] = useState<CodingAgentStatusDto | null>(null);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.codingAgent.getStatus());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectExecutable = async () => {
    try {
      const next = await window.api.codingAgent.selectExecutable();
      if (next) setStatus(next);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const integrations: Integration[] = [
    {
      id: 'github',
      name: 'GitHub',
      description: githubStatus.profile?.name
        ? `${githubStatus.profile.name} · @${githubStatus.profile.login}`
        : `@${githubStatus.profile?.login ?? 'unknown'}`,
      icon: GitFork,
      status: 'connected',
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      description: status?.configured
        ? `Version ${status.version ?? 'unknown'} · ${status.running ? 'running' : 'configured'}`
        : 'Select the local headless coding-agent executable.',
      icon: Bot,
      status: status?.configured ? 'connected' : 'disconnected',
      configurationAction: {
        connectedLabel: 'Change path',
        disconnectedLabel: 'Select OpenCode',
      },
    },
  ];

  const handleConnect = async (integrationId: string) => {
    if (integrationId === 'opencode') await selectExecutable();
  };

  const handleDisconnect = async (integrationId: string) => {
    if (integrationId === 'github') {
      await githubAuth.logout();
      return;
    }

    await selectExecutable();
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

      <SettingsIntegrations
        integrations={integrations}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {error || status?.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? status?.error}
        </p>
      ) : null}
    </div>
  );
};
