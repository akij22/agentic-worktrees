import { useCallback, useEffect, useState } from "react";
import type {
  CodingAgentKindDto,
  CodingAgentStatusDto,
} from "../../shared/ipc/schemas";
import githubLogo from "../assets/github-logo.png";
import SettingsIntegrations, {
  type Integration,
} from "../components/ui/settings-integrations";
import { useGitHubAuth } from "../features/auth/useGitHubAuth";
import { AgentLogo } from "../features/coding-agent/components/AgentLogo";

const CodexLogo = ({ className }: { className?: string }) => (
  <AgentLogo
    agentKind="codex"
    alt="OpenAI logo"
    className={className}
    invertOnDark={false}
  />
);

const OpenCodeLogo = ({ className }: { className?: string }) => (
  <AgentLogo agentKind="opencode" alt="OpenCode logo" className={className} />
);

const GitHubLogo = ({ className }: { className?: string }) => (
  <img src={githubLogo} alt="GitHub logo" className={className} />
);

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

  const selectExecutable = async (agentKind: CodingAgentKindDto) => {
    try {
      const next = await window.api.codingAgent.selectExecutable({ agentKind });
      if (next) setStatus(next);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const integrations: Integration[] = [
    {
      id: "github",
      name: "GitHub",
      description: githubStatus.profile?.name
        ? `${githubStatus.profile.name} · @${githubStatus.profile.login}`
        : `@${githubStatus.profile?.login ?? "unknown"}`,
      icon: GitHubLogo,
      iconBare: true,
      status: "connected",
    },
    ...(status?.installations ?? []).map((installation) => ({
      id: installation.kind,
      name: installation.name,
      description: installation.configured
        ? `Version ${installation.version ?? "unknown"} · ${installation.running ? "running" : "configured"}`
        : `Select the local ${installation.name} executable.`,
      icon: installation.kind === "codex" ? CodexLogo : OpenCodeLogo,
      iconBare: true,
      status: installation.configured
        ? ("connected" as const)
        : ("disconnected" as const),
      configurationAction: {
        connectedLabel: "Change path",
        disconnectedLabel: `Select ${installation.name}`,
      },
    })),
  ];

  const handleConnect = async (integrationId: string) => {
    const installation = status?.installations.find(
      ({ kind }) => kind === integrationId,
    );
    if (installation) await selectExecutable(installation.kind);
  };

  const handleDisconnect = async (integrationId: string) => {
    if (integrationId === "github") {
      await githubAuth.logout();
      return;
    }

    const installation = status?.installations.find(
      ({ kind }) => kind === integrationId,
    );
    if (installation) await selectExecutable(installation.kind);
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
      {error || status?.installations.find(({ error }) => error)?.error ? (
        <p className="rounded-xl bg-error-surface px-3 py-2 text-sm text-error-foreground">
          {error ?? status?.installations.find(({ error }) => error)?.error}
        </p>
      ) : null}
    </div>
  );
};
