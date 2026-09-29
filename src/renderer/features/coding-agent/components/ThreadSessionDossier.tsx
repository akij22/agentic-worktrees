import { Bot, Folder, GitBranch, MapPin, Wrench } from "lucide-react";
import { type CSSProperties } from "react";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";
import { AgentLogo } from "./AgentLogo";
import { getSessionStatusPresentation } from "../lib/thread-list";
import "./ThreadListSidebar.css";

type Props = {
  session: CodingAgentSessionDto;
  context: CodingAgentWorktreeContextDto | undefined;
  detail: SessionGridDetail | undefined;
  open: boolean;
  top: number;
};

export const THREAD_DOSSIER_MAX_HEIGHT = 380;

export const clampThreadDossierTop = (
  anchorTop: number,
  viewportHeight: number,
): number => {
  const maxTop = Math.max(12, viewportHeight - THREAD_DOSSIER_MAX_HEIGHT - 12);
  return Math.min(Math.max(12, anchorTop - 8), maxTop);
};

export const ThreadSessionDossier = ({
  session,
  context,
  detail,
  open,
  top,
}: Props) => (
  <div
    className="thread-dossier"
    id={`thread-dossier-${session.id}`}
    data-open={open}
    role="tooltip"
    aria-hidden={!open}
    style={{ top } satisfies CSSProperties}
  >
    <div className="thread-dossier-heading">
      <AgentLogo
        agentKind={session.agentKind}
        alt=""
        invertOnDark={session.agentKind !== "codex"}
        className="size-7 shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {session.title || "Untitled thread"}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {session.agentName} · {session.providerId}/{session.modelId}
        </p>
      </div>
    </div>

    <dl className="thread-dossier-details">
      <div>
        <dt>
          <Folder aria-hidden="true" />Repository
        </dt>
        <dd>{context?.repository.fullName ?? "Unavailable repository"}</dd>
      </div>
      <div>
        <dt>
          <MapPin aria-hidden="true" />Worktree
        </dt>
        <dd>{context?.worktree.name ?? "Unavailable worktree"}</dd>
      </div>
      <div>
        <dt>
          <GitBranch aria-hidden="true" />Branch
        </dt>
        <dd>{context?.worktree.branchName ?? "Unavailable branch"}</dd>
      </div>
      <div>
        <dt>
          <MapPin aria-hidden="true" />Path
        </dt>
        <dd>{context?.worktree.path ?? "Unavailable path"}</dd>
      </div>
    </dl>

    <div className="thread-dossier-footer">
      <span className="thread-dossier-stat">
        <Wrench aria-hidden="true" />
        {detail?.activeCapabilities?.length ?? 0} active capabilities
      </span>
      <span className="thread-dossier-stat">
        <Bot aria-hidden="true" />
        {getSessionStatusPresentation(session).label}
      </span>
    </div>
    {detail?.activeCapabilities?.length ? (
      <ul
        className="thread-dossier-capabilities"
        aria-label="Active capabilities"
      >
        {detail.activeCapabilities.map((capability) => (
          <li key={capability.id}>{capability.name}</li>
        ))}
      </ul>
    ) : null}
  </div>
);
