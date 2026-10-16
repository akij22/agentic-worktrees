import { Bot, ChevronRight, Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  CodingAgentKindDto,
  CodingAgentStatusDto,
} from "../../shared/ipc/schemas";
import githubLogo from "../assets/github-logo.png";
import { AppNavigation, AppNavigationFooter } from "../components/AppNavigation";
import { Button } from "../components/ui/button";
import SettingsIntegrations, {
  type Integration,
} from "../components/ui/settings-integrations";
import { useGitHubAuth } from "../features/auth/useGitHubAuth";
import { AgentLogo } from "../features/coding-agent/components/AgentLogo";
import "./Settings.css";

const CodexLogo = ({ className }: { className?: string }) => (
  <AgentLogo agentKind="codex" alt="" className={`invert dark:invert-0 ${className ?? ""}`} invertOnDark={false} />
);
const OpenCodeLogo = ({ className }: { className?: string }) => (
  <AgentLogo agentKind="opencode" alt="" className={className} />
);
const GitHubLogo = ({ className }: { className?: string }) => (
  <img src={githubLogo} alt="" className={`dark:invert ${className ?? ""}`} />
);

// Add future settings categories here; navigation and page headings share this definition.
const settingsSections = [
  {
    id: "connections",
    label: "Connections",
    icon: Link2,
    description: "Connect the accounts you use to work with repositories and pull requests.",
    groupTitle: "GitHub account",
    groupDescription: "Your GitHub connection is shared across this workspace.",
  },
  {
    id: "agents",
    label: "Coding agents",
    icon: Bot,
    description: "Choose the local coding agents available to your threads.",
    groupTitle: "Local executables",
    groupDescription: "Select an installed executable for each coding agent.",
  },
] as const;
type SettingsSectionId = (typeof settingsSections)[number]["id"];

export const Settings = () => {
  const githubAuth = useGitHubAuth();
  const githubStatus = githubAuth.state.status;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("connections");
  const [status, setStatus] = useState<CodingAgentStatusDto | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const section = settingsSections.find(({ id }) => id === activeSection) ?? settingsSections[0];

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

  useEffect(() => { void refresh(); }, [refresh]);

  const selectExecutable = async (agentKind: CodingAgentKindDto) => {
    const next = await window.api.codingAgent.selectExecutable({ agentKind });
    if (next) setStatus(next);
  };

  const connections: Integration[] = [{
    id: "github",
    name: "GitHub",
    description: githubStatus.profile?.name
      ? `${githubStatus.profile.name} · @${githubStatus.profile.login}`
      : githubStatus.profile ? `@${githubStatus.profile.login}` : "Connect your GitHub account.",
    icon: GitHubLogo,
    iconBare: true,
    status: githubStatus.profile ? "connected" : "disconnected",
  }];
  const agents: Integration[] = (status?.installations ?? []).map((installation) => ({
    id: installation.kind,
    name: installation.name,
    description: installation.configured
      ? installation.version ? `Version ${installation.version}` : "Version unavailable"
      : `Select the local ${installation.name} executable.`,
    detail: installation.executablePath ?? undefined,
    error: installation.error ?? undefined,
    icon: installation.kind === "codex" ? CodexLogo : OpenCodeLogo,
    iconBare: true,
    status: installation.error ? "error" : installation.configured ? "connected" : "disconnected",
    statusLabel: installation.error ? "Needs attention" : installation.running ? "Running" : installation.configured ? "Configured" : "Not configured",
    configurationAction: {
      connectedLabel: "Change path",
      disconnectedLabel: "Select executable",
    },
  }));

  const handleConnect = async (integrationId: string) => {
    if (integrationId === "github") {
      await githubAuth.startLogin();
      return;
    }
    const installation = status?.installations.find(({ kind }) => kind === integrationId);
    if (installation) await selectExecutable(installation.kind);
  };
  const handleDisconnect = async (integrationId: string) => {
    if (integrationId === "github") {
      await githubAuth.logout();
      return;
    }
    await handleConnect(integrationId);
  };

  return (
    <div className="settings-workspace">
      <aside className="settings-sidebar" aria-label="Settings sidebar">
        <AppNavigation />
        <div className="settings-sidebar-body">
          <h1 className="settings-sidebar-title">Settings</h1>
          <nav aria-label="Settings categories" className="settings-category-nav">
            {settingsSections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={activeSection === id ? "page" : undefined}
                aria-controls="settings-content"
                onClick={() => setActiveSection(id)}
                className="settings-category"
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
        <AppNavigationFooter />
      </aside>
      <div className="settings-main">
        <div className="settings-breadcrumb" aria-hidden="true">
          <span>Settings</span><ChevronRight className="size-3" /><span>{section.label}</span>
        </div>
        <div className="settings-scroll">
          <section id="settings-content" aria-labelledby="settings-section-title" className="settings-content">
            <header className="settings-page-heading">
              <h2 id="settings-section-title">{section.label}</h2>
              <p>{section.description}</p>
            </header>
            <SettingsIntegrations
              key={activeSection}
              title={section.groupTitle}
              description={section.groupDescription}
              integrations={activeSection === "connections" ? connections : agents}
              loading={activeSection === "agents" && loading}
              emptyMessage={error ? "Coding agents could not be loaded." : "No coding agents are available."}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
            {activeSection === "agents" && error ? (
              <div role="alert" className="settings-load-error">
                <p>{error}</p>
                <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>Retry</Button>
              </div>
            ) : null}
            {activeSection === "connections" && githubAuth.actionError ? (
              <p role="alert" className="settings-load-error">{githubAuth.actionError}</p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
};
