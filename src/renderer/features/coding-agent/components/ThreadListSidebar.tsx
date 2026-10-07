import { GitBranch, LoaderCircle, Plus, Search } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { formatListTimestamp } from "../lib/formatters";
import {
  buildRepositoryFilters,
  buildThreadEntries,
  filterThreadEntries,
  getSessionStatusPresentation,
  groupThreadEntries,
  type ThreadListEntry,
} from "../lib/thread-list";
import { AgentLogo } from "./AgentLogo";
import {
  clampThreadDossierTop,
  ThreadSessionDossier,
} from "./ThreadSessionDossier";
import "./ThreadListSidebar.css";

type Props = {
  navigation?: ReactNode;
  footer?: ReactNode;
  contexts: CodingAgentWorktreeContextDto[];
  sessions: CodingAgentSessionDto[];
  sessionDetails: Map<string, SessionGridDetail>;
  activeRunId?: string;
  width: number;
  loading: boolean;
  error?: string;
  hasConfiguredHarness: boolean;
  onNewSession: () => void;
  onOpenSession: (session: CodingAgentSessionDto) => void;
};

const agentBadgeFor = (session: CodingAgentSessionDto): string =>
  session.agentKind === "codex" ? "Codex" : "OpenCode";

const ThreadRow = ({
  entry,
  active,
  onOpenSession,
}: {
  entry: ThreadListEntry;
  active: boolean;
  onOpenSession: (session: CodingAgentSessionDto) => void;
}) => {
  const { session } = entry;
  const status = getSessionStatusPresentation(session);
  const agentLabel = agentBadgeFor(session);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [dossierTop, setDossierTop] = useState(12);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismissOnWindowBlur = () => setDossierOpen(false);
    window.addEventListener("blur", dismissOnWindowBlur);
    return () => window.removeEventListener("blur", dismissOnWindowBlur);
  }, []);

  useEffect(() => {
    if (!dossierOpen) return;

    const dismissWhenPointerLeavesRow = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !rowRef.current?.contains(event.target)
      ) {
        setDossierOpen(false);
      }
    };

    window.addEventListener("pointermove", dismissWhenPointerLeavesRow);
    return () =>
      window.removeEventListener("pointermove", dismissWhenPointerLeavesRow);
  }, [dossierOpen]);

  const reveal = (target: HTMLElement) => {
    const bounds = target.getBoundingClientRect();
    setDossierTop(clampThreadDossierTop(bounds.top, window.innerHeight));
    setDossierOpen(true);
  };

  const dismiss = () => setDossierOpen(false);

  return (
    <div
      ref={rowRef}
      className="thread-nav-item"
      onMouseEnter={(event) => reveal(event.currentTarget)}
      onMouseLeave={dismiss}
      onFocus={(event) => reveal(event.currentTarget)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={`${session.title || "Untitled thread"}, ${agentLabel}. Hover or focus for thread details.`}
        aria-describedby={`thread-dossier-${session.id}`}
        onClick={() => onOpenSession(session)}
        className={cn(
          "relative mb-1 flex w-full gap-2.5 overflow-hidden rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          active
            ? "bg-sidebar-row-selected text-foreground shadow-[inset_2px_0_0_var(--primary),inset_0_1px_0_rgba(255,255,255,0.045)]"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover/70",
        )}
      >
        {active ? (
          <span
            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary"
            aria-hidden="true"
          />
        ) : null}

        <AgentLogo
          agentKind={session.agentKind}
          alt=""
          invertOnDark={session.agentKind !== "codex"}
          className="mt-0.5 size-4 shrink-0 object-contain"
        />
        <span className="sr-only">{agentLabel}</span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", status.className)}
              title={status.label}
              aria-label={status.label}
            />
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-5">
              {session.title || "Untitled thread"}
            </span>
            <span className="shrink-0 font-mono text-[10px] leading-5 text-muted-foreground">
              {formatListTimestamp(
                entry.detail?.lastMessageAt != null
                  ? new Date(entry.detail.lastMessageAt)
                  : session.updatedAt,
              )}
            </span>
          </span>

          {/* The project and the branch get their own lines. Run together on one
              line they competed for width and the branch was the loser, which
              is the part a developer most needs to see. */}
          <span
            className="mt-1 block truncate text-[11px] leading-4 text-foreground/75"
            title={entry.repositoryName}
          >
            {entry.repositoryName}
          </span>
          {entry.branchName ? (
            <span
              className="mt-0.5 flex min-w-0 items-start gap-1.5 text-[11px] leading-4"
              title={entry.branchName}
            >
              <GitBranch
                aria-hidden="true"
                className="mt-[3px] size-3 shrink-0 text-muted-foreground/70"
              />
              <span className="min-w-0 break-all font-mono text-muted-foreground">
                {entry.branchName}
              </span>
            </span>
          ) : null}
        </span>
      </button>
      <ThreadSessionDossier
        session={session}
        context={entry.context}
        detail={entry.detail}
        open={dossierOpen}
        top={dossierTop}
      />
    </div>
  );
};

export const ThreadListSidebar = ({
  navigation,
  footer,
  contexts,
  sessions,
  sessionDetails,
  activeRunId,
  width,
  loading,
  error,
  hasConfiguredHarness,
  onNewSession,
  onOpenSession,
}: Props) => {
  const [query, setQuery] = useState("");
  const [repositoryFilter, setRepositoryFilter] = useState<string>();

  const entries = useMemo(
    () => buildThreadEntries(contexts, sessions, sessionDetails),
    [contexts, sessions, sessionDetails],
  );
  const filters = useMemo(() => buildRepositoryFilters(entries), [entries]);
  const visibleEntries = useMemo(() => {
    const byRepository = filterThreadEntries(entries, repositoryFilter);
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return byRepository;
    return byRepository.filter((entry) =>
      `${entry.session.title} ${entry.repositoryName} ${entry.branchName ?? ""}`
        .toLowerCase()
        .includes(trimmed),
    );
  }, [entries, query, repositoryFilter]);
  const groups = useMemo(
    () => groupThreadEntries(visibleEntries),
    [visibleEntries],
  );

  return (
    <aside
      style={
        {
          width,
          "--thread-sidebar-width": `${width}px`,
        } as CSSProperties
      }
      className="relative z-10 flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-secondary text-sidebar-foreground shadow-[12px_0_32px_-28px_rgba(0,0,0,0.95)]"
    >
      {navigation}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border/70 px-4">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Threads
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {sessions.length} chat{sessions.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          size="icon"
          variant="outline"
          aria-label="New coding agent chat"
          title={
            hasConfiguredHarness
              ? "New coding agent chat"
              : "Configure a coding agent in Settings first"
          }
          onClick={onNewSession}
          disabled={contexts.length === 0 || !hasConfiguredHarness}
          className="size-8 bg-background/65"
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-2.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-sidebar-ring/40">
          <Search
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-placeholder"
          />
        </div>
      </div>

      {filters.length > 1 ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 pt-2.5">
          <button
            type="button"
            aria-pressed={repositoryFilter === undefined}
            onClick={() => setRepositoryFilter(undefined)}
            className={cn(
              "h-6 shrink-0 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
              repositoryFilter === undefined
                ? "border-primary/35 bg-sidebar-row-selected text-foreground"
                : "border-sidebar-border text-muted-foreground hover:bg-sidebar-row-hover",
            )}
          >
            All {entries.length}
          </button>
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={repositoryFilter === filter.id}
              onClick={() =>
                setRepositoryFilter((current) =>
                  current === filter.id ? undefined : filter.id,
                )
              }
              className={cn(
                "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                repositoryFilter === filter.id
                  ? "border-primary/35 bg-sidebar-row-selected text-foreground"
                  : "border-sidebar-border text-muted-foreground hover:bg-sidebar-row-hover",
              )}
            >
              {filter.name}
              <span className="font-mono text-[9px] text-muted-foreground">
                {filter.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <nav
        aria-label="Coding agent threads"
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
            Loading threads…
          </div>
        ) : null}

        {!loading && entries.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
            No threads yet. Start one from the composer.
          </p>
        ) : null}

        {!loading && entries.length > 0 && visibleEntries.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
            No threads match this filter.
          </p>
        ) : null}

        {groups.map((group) => (
          <section key={`${group.kind}-${group.label}`}>
            {group.entries.map((entry) => (
              <ThreadRow
                key={entry.session.id}
                entry={entry}
                active={entry.session.id === activeRunId}
                onOpenSession={onOpenSession}
              />
            ))}
          </section>
        ))}
      </nav>

      {error ? (
        <p
          className="m-2 rounded-xl bg-error-surface px-4 py-3 text-xs leading-5 text-error-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {footer}
    </aside>
  );
};
