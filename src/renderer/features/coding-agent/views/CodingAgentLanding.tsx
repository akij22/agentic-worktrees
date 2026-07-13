import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { NewSessionDialog } from "../components/NewSessionDialog";
import { SessionCard } from "../components/SessionCard";
import { useCodingAgentSessions } from "../hooks/useCodingAgentSessions";

export const CodingAgentLanding = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");
  const { status, contexts, sessions, sessionDetails, loading, error } =
    useCodingAgentSessions();
  const requestedWorktreeId = searchParams.get("worktreeId") ?? undefined;
  const contextByWorktree = useMemo(
    () => new Map(contexts.map((context) => [context.worktree.id, context])),
    [contexts],
  );
  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!status?.configured)
    return (
      <div className="mx-auto grid min-h-[32rem] max-w-2xl place-items-center text-center">
        <div>
          <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-dashed border-border bg-muted/30 font-mono text-xl">
            &gt;_
          </div>
          <h2 className="text-xl font-semibold">Configure OpenCode first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Select your local OpenCode executable. Provider credentials remain
            in OpenCode and are never exposed to this renderer.
          </p>
          <Button className="mt-5" onClick={() => navigate("/settings")}>
            Open Settings
          </Button>
        </div>
      </div>
    );
  const activeSessionCount = sessions.filter((session) =>
    ["busy", "creating", "waiting_permission"].includes(session.status),
  ).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            OpenCode · {status.version}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            Coding sessions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sessions.length === 0
              ? "Persistent conversations, each isolated to one Git worktree."
              : `Monitoring ${sessions.length} session${sessions.length === 1 ? "" : "s"} across isolated worktrees${activeSessionCount > 0 ? ` · ${activeSessionCount} active` : ""}.`}
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={contexts.length === 0}
        >
          + New chat
        </Button>
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
          <h3 className="text-sm font-semibold">No coding sessions yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a chat and assign it to one of your worktrees.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              context={contextByWorktree.get(session.worktreeId)}
              detail={sessionDetails.get(session.id)}
              onOpen={() =>
                navigate(`/coding-agent/${session.worktreeId}/${session.id}`)
              }
            />
          ))}
        </div>
      )}
      <NewSessionDialog
        open={dialogOpen}
        contexts={contexts}
        initialWorktreeId={requestedWorktreeId}
        onClose={() => {
          setDialogOpen(false);
          setSearchParams({});
        }}
      />
    </div>
  );
};
