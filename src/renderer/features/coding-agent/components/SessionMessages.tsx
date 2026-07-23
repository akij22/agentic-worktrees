import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { AIMessage } from "./AIMessage";
import { SessionThought } from "./SessionThought";
import { CommandApprovalCard } from "./CommandApprovalCard";
import { buildSessionMessageEntries } from "../lib/session-messages";
import type { ThoughtEntry } from "../lib/session-messages";
import type { PendingPermission } from "../types";

type Props = {
  agentName: string;
  messages: CodingAgentMessageDto[];
  busy: boolean;
  activity: string | undefined;
  permission: PendingPermission | undefined;
  error: string | undefined;
  onRespondPermission: (response: "once" | "always" | "reject") => void;
  children?: ReactNode;
};

type ThoughtState = { entry: ThoughtEntry; exiting: boolean } | null;

const THOUGHT_EXIT_DURATION_MS = 300;

export const SessionMessages = ({
  agentName,
  messages,
  busy,
  activity,
  permission,
  error,
  onRespondPermission,
  children,
}: Props) => {
  const messagesRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const entries = useMemo(() => buildSessionMessageEntries(messages), [messages]);
  const thoughtEntry = entries.find(
    (entry): entry is ThoughtEntry => entry.kind === "thought",
  );
  const [thought, setThought] = useState<ThoughtState>(null);

  // An open thought is always the last entry; once it closes, it is kept
  // mounted right before the persistent message that replaced it, so it can
  // animate out instead of disappearing abruptly.
  const displayEntries = [...entries];
  if (thought && !thoughtEntry) {
    displayEntries.splice(Math.max(displayEntries.length - 1, 0), 0, thought.entry);
  }

  // Keeps the chain of thoughts mounted while it leaves, so it can animate
  // out instead of disappearing abruptly when a persistent message arrives.
  useEffect(() => {
    if (thoughtEntry) {
      setThought({ entry: thoughtEntry, exiting: false });
      return;
    }
    setThought((current) =>
      current ? { ...current, exiting: true } : null,
    );
  }, [thoughtEntry]);

  useEffect(() => {
    if (!thought?.exiting) return;
    const timeout = setTimeout(
      () => setThought(null),
      THOUGHT_EXIT_DURATION_MS,
    );
    return () => clearTimeout(timeout);
  }, [thought?.exiting]);

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
    className="flex-1 space-y-6 overflow-y-auto px-5 py-6"
  >
    {messages.length === 0 ? (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Ask {agentName} to make a change in this worktree.
      </div>
    ) : null}
    {displayEntries.map((entry) => {
      if (entry.kind === "thought") {
        return (
          <SessionThought
            agentName={agentName}
            key={entry.key}
            text={entry.text}
            exiting={thought?.exiting === true && thought.entry.key === entry.key}
          />
        );
      }
      const { message } = entry;
      return (
        <article
          key={message.id}
          className={
            message.role === "user" ? "ml-auto max-w-[46rem]" : "max-w-[48rem]"
          }
        >
          <div className="mb-1.5 text-xs font-semibold">
            {message.role === "user" ? "You" : agentName}
          </div>
          {message.content.trim() && message.role === "user" ? (
            <div className="whitespace-pre-wrap rounded-xl rounded-tr-sm border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6">
              {message.content}
            </div>
          ) : null}
          {message.content.trim() && message.role === "assistant" ? (
            <AIMessage
              agentName={agentName}
              content={message.content}
              isStreaming={message.completedAt === null}
            />
          ) : null}
        </article>
      );
    })}
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
    {children}
  </div>
  );
};
