import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { AIMessage } from "./AIMessage";
import { SessionThought } from "./SessionThought";
import { ToolCallGroup } from "./ToolCallGroup";
import { CommandApprovalCard } from "./CommandApprovalCard";
import { buildSessionMessageEntries } from "../lib/session-messages";
import type { PendingPermission } from "../types";

type Props = {
  agentName: string;
  messages: CodingAgentMessageDto[];
  busy: boolean;
  activity: string | undefined;
  transientThought?: string;
  permission: PendingPermission | undefined;
  error: string | undefined;
  onRespondPermission: (response: "once" | "always" | "reject") => void;
  onOpenFile?: (href: string) => boolean;
  children?: ReactNode;
};

export const SessionMessages = ({
  agentName,
  messages,
  busy,
  activity,
  transientThought,
  permission,
  error,
  onRespondPermission,
  onOpenFile,
  children,
}: Props) => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const entries = useMemo(() => buildSessionMessageEntries(messages), [messages]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;

    const lastMessage = messages.at(-1);
    const lastMessageChanged =
      lastMessage?.id !== undefined &&
      lastMessage.id !== lastMessageIdRef.current;
    const shouldShowNewUserMessage =
      lastMessageChanged && lastMessage?.role === "user";
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom <= 48;

    if (!hasMountedRef.current || isNearBottom || shouldShowNewUserMessage) {
      container.scrollTop = container.scrollHeight;
    }

    hasMountedRef.current = true;
    lastMessageIdRef.current = lastMessage?.id;
  }, [activity, error, messages, permission]);

  return (
    <div
      ref={messagesRef}
      className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain bg-background px-5 py-6"
    >
    {messages.length === 0 ? (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Ask {agentName} to make a change in this worktree.
      </div>
    ) : null}
    {entries.map((entry, index) => {
      if (entry.kind === "thought") {
        return (
          <SessionThought
            agentName={agentName}
            key={entry.key}
            text={entry.text}
            streaming={busy && index === entries.length - 1}
          />
        );
      }
      if (entry.kind === "tools") {
        return <ToolCallGroup key={entry.key} tools={entry.tools} />;
      }
      const { message } = entry;
      return (
        <article
          key={message.id}
          className={
            message.role === "user" ? "ml-auto max-w-[46rem]" : "max-w-[48rem]"
          }
        >
          <div
            className={
              message.role === "user"
                ? "mb-1.5 text-right text-xs font-semibold"
                : "mb-1.5 text-xs font-semibold"
            }
          >
            {message.role === "user" ? "You" : agentName}
          </div>
          {message.content.trim() && message.role === "user" ? (
            <div className="ml-auto w-fit max-w-full whitespace-pre-wrap rounded-xl rounded-tr-sm border border-primary/10 bg-message-surface px-4 py-3 text-sm leading-6 text-message-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              {message.content}
            </div>
          ) : null}
          {message.content.trim() && message.role === "assistant" ? (
            <AIMessage
              agentName={agentName}
              content={message.content}
              isStreaming={message.completedAt === null}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </article>
      );
    })}
    {transientThought ? (
      <SessionThought
        agentName={agentName}
        text={transientThought}
        streaming={busy}
      />
    ) : null}
    {activity && busy ? (
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        {activity}
      </div>
    ) : null}
    {permission?.type === "command" || permission?.type === "bash" ? (
      <CommandApprovalCard
        agentName={agentName}
        permission={permission}
        onRespond={onRespondPermission}
      />
    ) : permission ? (
      <div className="rounded-xl border border-chart-4/10 bg-chart-4/10 p-4 shadow-[inset_2px_0_0_var(--chart-4)]">
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
    {children}
    </div>
  );
};
