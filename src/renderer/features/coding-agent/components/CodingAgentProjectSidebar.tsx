import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Bot,
  LoaderCircle,
  MapPin,
  Plus,
  Wrench,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";
import { Button } from "../../../components/ui/button";
import { formatDate } from "../lib/formatters";
import { getWorkspaceShortLabel } from "../lib/workspace-labels";
import { AgentLogo } from "./AgentLogo";
import "./CodingAgentProjectSidebar.css";

type ProjectSession = {
  session: CodingAgentSessionDto;
  context: CodingAgentWorktreeContextDto | undefined;
};

type ProjectGroup = {
  id: string;
  name: string;
  sessions: ProjectSession[];
};

type Props = {
  contexts: CodingAgentWorktreeContextDto[];
  sessions: CodingAgentSessionDto[];
  sessionDetails: Map<string, SessionGridDetail>;
  activeRunId?: string;
  width: number;
  loading: boolean;
  error?: string;
  onNewSession: () => void;
  onOpenSession: (session: CodingAgentSessionDto) => void;
};

type HoverCardProps = {
  session: CodingAgentSessionDto;
  context: CodingAgentWorktreeContextDto | undefined;
  detail: SessionGridDetail | undefined;
  open: boolean;
  top: number;
};

const SessionDetailsHoverCard = ({
  session,
  context,
  detail,
  open,
  top,
}: HoverCardProps) => (
  <div
    className="session-hover-card"
    id={`session-details-${session.id}`}
    data-open={open}
    role="tooltip"
    aria-hidden={!open}
    style={{ top } satisfies CSSProperties}
  >
    <div className="session-hover-card-heading">
      <AgentLogo
        agentKind={session.agentKind}
        alt=""
        invertOnDark={session.agentKind !== "codex"}
        className="size-7 shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {session.title}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {session.agentName} · {session.providerId}/{session.modelId}
        </p>
      </div>
    </div>

    <dl className="session-hover-card-details">
      <div>
        <dt><Folder aria-hidden="true" />Repository</dt>
        <dd>{context?.repository.fullName ?? "Unavailable repository"}</dd>
      </div>
      <div>
        <dt><MapPin aria-hidden="true" />Worktree</dt>
        <dd>{context?.worktree.name ?? "Unavailable worktree"}</dd>
      </div>
      <div>
        <dt><GitBranch aria-hidden="true" />Branch</dt>
        <dd>{context?.worktree.branchName ?? "Unavailable branch"}</dd>
      </div>
      <div>
        <dt><MapPin aria-hidden="true" />Path</dt>
        <dd>{context?.worktree.path ?? "Unavailable path"}</dd>
      </div>
    </dl>

    <div className="session-hover-card-footer">
      <span className="session-hover-card-capabilities">
        <Wrench aria-hidden="true" />
        {detail?.activeCapabilities?.length ?? 0} active capabilities
      </span>
      <span className="session-hover-card-status">
        <Bot aria-hidden="true" />
        {sessionStatus(session).label}
      </span>
    </div>
    {detail?.activeCapabilities?.length ? (
      <ul className="session-hover-card-capability-list" aria-label="Active capabilities">
        {detail.activeCapabilities.map((capability) => (
          <li key={capability.id}>{capability.name}</li>
        ))}
      </ul>
    ) : null}
  </div>
);

const buildProjectGroups = (
  contexts: CodingAgentWorktreeContextDto[],
  sessions: CodingAgentSessionDto[],
): ProjectGroup[] => {
  const contextByWorktreeId = new Map(
    contexts.map((context) => [context.worktree.id, context]),
  );
  const groups = new Map<string, ProjectGroup>();

  contexts.forEach(({ repository }) => {
    if (groups.has(repository.id)) return;
    groups.set(repository.id, {
      id: repository.id,
      name:
        repository.name ||
        repository.fullName.split("/").at(-1) ||
        "Project",
      sessions: [],
    });
  });

  sessions.forEach((session) => {
    const context = contextByWorktreeId.get(session.worktreeId);
    const projectId = context?.repository.id ?? session.repositoryId;
    const existing = groups.get(projectId);
    const project =
      existing ??
      ({
        id: projectId,
        name: context?.repository.name ?? "Unavailable project",
        sessions: [],
      } satisfies ProjectGroup);

    project.sessions.push({ session, context });
    groups.set(projectId, project);
  });

  return Array.from(groups.values())
    .map((project) => ({
      ...project,
      sessions: project.sessions.toSorted(
        (left, right) =>
          new Date(right.session.updatedAt).getTime() -
          new Date(left.session.updatedAt).getTime(),
      ),
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
};

const sessionStatus = (session: CodingAgentSessionDto) => {
  if (["busy", "creating", "aborting"].includes(session.status)) {
    return { label: "Working", className: "bg-primary" };
  }
  if (session.status === "waiting_permission") {
    return { label: "Needs attention", className: "bg-amber-400" };
  }
  if (session.status === "error") {
    return { label: "Error", className: "bg-destructive" };
  }
  return { label: "Ready", className: "bg-emerald-400" };
};

export const CodingAgentProjectSidebar = ({
  contexts,
  sessions,
  sessionDetails,
  activeRunId,
  width,
  loading,
  error,
  onNewSession,
  onOpenSession,
}: Props) => {
  const projects = useMemo(
    () => buildProjectGroups(contexts, sessions),
    [contexts, sessions],
  );
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoveredSessionId, setHoveredSessionId] = useState<string>();
  const [hoveredSessionTop, setHoveredSessionTop] = useState(12);
  const revealSessionDetails = (target: HTMLElement) => {
    const bounds = target.getBoundingClientRect();
    const cardHeight = Math.min(380, window.innerHeight - 24);
    const top = Math.min(
      Math.max(12, bounds.top - 8),
      Math.max(12, window.innerHeight - cardHeight - 12),
    );
    setHoveredSessionTop(top);
  };

  return (
    <aside
      style={{
        width,
        "--session-sidebar-width": `${width}px`,
      } as CSSProperties}
      className="relative z-10 flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-secondary text-sidebar-foreground shadow-[12px_0_32px_-28px_rgba(0,0,0,0.95)]"
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border/70 px-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Projects
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {sessions.length} chat{sessions.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="New coding agent chat"
          title="New coding agent chat"
          onClick={onNewSession}
          disabled={contexts.length === 0}
          className="size-8 bg-background/65"
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <nav
        aria-label="Coding agent projects"
        className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
            Loading projects…
          </div>
        ) : null}

        {!loading && projects.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
            No local projects are available yet.
          </p>
        ) : null}

        {!loading
          ? projects.map((project) => {
              const expanded = expandedProjectIds.has(project.id);
              return (
                <section key={project.id} className="mb-1">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedProjectIds((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      })
                    }
                    className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
                  >
                    {expanded ? (
                      <ChevronDown
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <Folder
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                    <span className="rounded-full bg-sidebar-control-surface px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {project.sessions.length}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="ml-5 border-l border-sidebar-border/45 pl-2">
                      {project.sessions.length === 0 ? (
                        <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                          No chats yet
                        </p>
                      ) : null}
                      {project.sessions.map(({ session, context }) => {
                        const active = session.id === activeRunId;
                        const status = sessionStatus(session);
                        const detail = sessionDetails.get(session.id);
                        return (
                          <div
                            key={session.id}
                            className="session-nav-item"
                            onMouseEnter={(event) => {
                              revealSessionDetails(event.currentTarget);
                              setHoveredSessionId(session.id);
                            }}
                            onMouseLeave={() => setHoveredSessionId(undefined)}
                            onFocus={(event) => {
                              revealSessionDetails(event.currentTarget);
                              setHoveredSessionId(session.id);
                            }}
                            onBlur={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget)) {
                                setHoveredSessionId(undefined);
                              }
                            }}
                          >
                            <button
                              type="button"
                              aria-current={active ? "page" : undefined}
                              aria-label={`${session.title}. Hover or focus for session details.`}
                              aria-describedby={
                                hoveredSessionId === session.id
                                  ? `session-details-${session.id}`
                                  : undefined
                              }
                              onClick={() => onOpenSession(session)}
                              className={`relative mb-1 flex w-full items-start gap-2.5 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 ${
                                active
                                  ? "bg-sidebar-row-selected text-foreground shadow-[inset_2px_0_0_var(--primary),inset_0_1px_0_rgba(255,255,255,0.045)]"
                                  : "text-sidebar-foreground hover:bg-sidebar-row-hover/70"
                              }`}
                            >
                            {active ? (
                              <span
                                className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary"
                                aria-hidden="true"
                              />
                            ) : null}
                            <GitBranch
                              className={`mt-0.5 size-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                  {session.title}
                                </span>
                                <span
                                  className={`size-1.5 shrink-0 rounded-full ${status.className}`}
                                  title={status.label}
                                  aria-label={status.label}
                                />
                              </span>
                              <span className="mt-1 flex min-w-0 items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                                <span className="truncate">
                                  {context
                                    ? getWorkspaceShortLabel(context)
                                    : "Unavailable workspace"}
                                </span>
                                <span className="shrink-0">
                                  {formatDate(session.updatedAt)}
                                </span>
                              </span>
                              </span>
                            </button>
                            <SessionDetailsHoverCard
                              session={session}
                              context={context}
                              detail={detail}
                              open={hoveredSessionId === session.id}
                              top={hoveredSessionTop}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })
          : null}
      </nav>

      {error ? (
        <p
          className="m-2 rounded-xl bg-error-surface px-4 py-3 text-xs leading-5 text-error-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </aside>
  );
};
