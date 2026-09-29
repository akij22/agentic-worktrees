import { type ReactNode } from "react";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import "./CodingAgentSessionHeader.css";

type Props = {
  context: {
    repository: Pick<CodingAgentWorktreeContextDto["repository"], "name" | "fullName">;
    worktree: Pick<CodingAgentWorktreeContextDto["worktree"], "name" | "branchName" | "path">;
  };
  title?: string;
  editorAction: ReactNode;
  layoutActions?: ReactNode;
  editorError?: string;
};

export const CodingAgentSessionHeader = ({
  context,
  title,
  editorAction,
  layoutActions,
  editorError,
}: Props) => {
  return (
    <header aria-label={title ?? "Session"} className="session-header border-b border-border/60 bg-background">
      {title ? <h1 className="sr-only">{title}</h1> : null}
      <div className="session-header-identity">
        <p className="truncate text-xs text-muted-foreground" title={context.repository.name}>
          {context.repository.name}
        </p>
        <h2 className="truncate text-sm font-semibold" title={context.worktree.name}>
          {context.worktree.name}
        </h2>
      </div>
      <div className="session-header-actions">
        {editorAction}
        {layoutActions ? <div className="shrink-0">{layoutActions}</div> : null}
      </div>
      {editorError ? <p className="session-header-error text-xs text-destructive" role="alert">{editorError}</p> : null}
    </header>
  );
};
