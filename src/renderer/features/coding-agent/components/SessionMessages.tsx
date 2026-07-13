import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import type { PendingPermission } from "../types";

type Props = {
  messages: CodingAgentMessageDto[];
  busy: boolean;
  activity: string | undefined;
  permission: PendingPermission | undefined;
  error: string | undefined;
  onRespondPermission: (response: "once" | "always" | "reject") => void;
};

export const SessionMessages = ({
  messages,
  busy,
  activity,
  permission,
  error,
  onRespondPermission,
}: Props) => (
  <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
    {messages.length === 0 ? (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Ask OpenCode to make a change in this worktree.
      </div>
    ) : null}
    {messages.map((message) => (
      <article
        key={message.id}
        className={
          message.role === "user" ? "ml-auto max-w-[46rem]" : "max-w-[48rem]"
        }
      >
        <div className="mb-1.5 text-xs font-semibold">
          {message.role === "user" ? "You" : "OpenCode"}
        </div>
        {message.content.trim() ? (
          <div
            className={
              message.role === "user"
                ? "whitespace-pre-wrap rounded-xl rounded-tr-sm border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6"
                : "whitespace-pre-wrap border-l-2 border-primary/70 bg-muted/35 px-4 py-3 text-sm leading-6"
            }
          >
            {message.content}
          </div>
        ) : null}
        {message.role === "assistant" && message.reasoning ? (
          <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs italic leading-5 text-muted-foreground/75">
            {message.reasoning}
          </div>
        ) : null}
      </article>
    ))}
    {activity && busy ? (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        {activity}
      </div>
    ) : null}
    {permission ? (
      <div className="rounded-xl border border-chart-4/50 bg-chart-4/10 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Permission required · {permission.type}
        </div>
        <p className="mt-2 text-sm font-medium">{permission.title}</p>
        {Object.keys(permission.metadata).length > 0 ? (
          <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-background/70 p-2 text-[11px] text-muted-foreground">
            {JSON.stringify(permission.metadata, null, 2)}
          </pre>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onRespondPermission("once")}>
            Allow once
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRespondPermission("always")}
          >
            Always allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespondPermission("reject")}
          >
            Deny
          </Button>
        </div>
      </div>
    ) : null}
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div>
);
