import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { InspectionPanel } from "../components/InspectionPanel";
import { SessionComposer } from "../components/SessionComposer";
import { SessionMessages } from "../components/SessionMessages";
import { useCodingAgentSession } from "../hooks/useCodingAgentSession";

export const CodingAgentSession = ({ runId }: { runId: string }) => {
  const sessionState = useCodingAgentSession(runId);
  const [draft, setDraft] = useState("");
  const splitRef = useRef<HTMLDivElement>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(368);
  const [isResizing, setIsResizing] = useState(false);
  useEffect(() => {
    if (!isResizing) return;
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = splitRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const maxWidth = Math.max(280, Math.min(720, bounds.width - 420));
      setDiffPanelWidth(
        Math.min(maxWidth, Math.max(280, bounds.right - event.clientX)),
      );
    };
    const stopResizing = () => setIsResizing(false);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizing]);
  if (sessionState.loading) return <Skeleton className="h-full w-full" />;
  if (!sessionState.snapshot)
    return (
      <p className="text-sm text-destructive">
        {sessionState.error ?? "Session unavailable."}
      </p>
    );
  const { session, context, messages, diff } = sessionState.snapshot;
  const busy = ["busy", "creating", "aborting"].includes(session.status);
  const composerLocked =
    sessionState.sending ||
    session.status === "creating" ||
    session.status === "aborting" ||
    session.status === "waiting_permission" ||
    Boolean(sessionState.permission);
  const selectedModel = sessionState.models.find(
    (model) =>
      `${model.providerId}::${model.modelId}` === sessionState.modelKey,
  );
  const reasoningVariants = selectedModel?.reasoningVariants ?? [];
  const send = () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    void sessionState.send(content);
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <section className="shrink-0 border-b border-border bg-gradient-to-r from-card via-card to-muted/30 px-6 py-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <span
                className={`size-2 rounded-full ${busy ? "animate-pulse bg-chart-4" : "bg-chart-3"}`}
              />
              {session.status.replace("_", " ")}
            </div>
            {session.status === "unavailable" ? (
              <p className="mb-3 max-w-3xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs leading-5 text-destructive">
                <span className="font-semibold">debug error: </span>
                {session.errorMessage ?? "No error message was stored."}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="font-mono text-base font-semibold">
                {context.worktree.name}
              </h2>
              <span className="font-mono text-sm text-muted-foreground">
                {context.worktree.branchName}
              </span>
              <Badge variant="outline" className="font-mono text-[11px]">
                {context.repository.fullName}
              </Badge>
            </div>
          </div>
        </div>
      </section>
      <div
        ref={splitRef}
        style={
          { "--inspection-panel-width": `${diffPanelWidth}px` } as CSSProperties
        }
        className="grid min-h-0 flex-1 grid-cols-1 xl:[grid-template-columns:minmax(0,1fr)_0.5rem_var(--inspection-panel-width)]"
      >
        <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="truncate text-xs font-medium">
              {session.title}
            </span>
            {busy ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void window.api.codingAgent.abortSession({ runId })
                }
              >
                Stop
              </Button>
            ) : null}
          </div>
          <SessionMessages
            messages={messages}
            busy={busy}
            activity={sessionState.activity}
            permission={sessionState.permission}
            error={sessionState.error}
            onRespondPermission={(response) =>
              void sessionState.respondPermission(response)
            }
          />
          <SessionComposer
            session={session}
            draft={draft}
            models={sessionState.models}
            modelKey={sessionState.modelKey}
            reasoningVariant={sessionState.reasoningVariant}
            reasoningVariants={reasoningVariants}
            loadingModels={sessionState.loadingModels}
            changingModel={sessionState.changingModel}
            busy={busy}
            locked={composerLocked}
            onDraftChange={setDraft}
            onModelChange={(key) => void sessionState.changeModel(key)}
            onReasoningChange={sessionState.setReasoningVariant}
            onSend={send}
          />
        </section>
        <div
          role="separator"
          aria-label="Resize chat and diff panels"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={720}
          aria-valuenow={diffPanelWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setDiffPanelWidth((width) => Math.min(720, width + 24));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setDiffPanelWidth((width) => Math.max(280, width - 24));
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizing(true);
          }}
          className={`group relative hidden touch-none cursor-col-resize items-center justify-center border-x border-border/60 bg-transparent transition-colors xl:flex ${isResizing ? "bg-primary/10" : "hover:bg-primary/5"}`}
        >
          <span
            className={`h-8 w-px rounded-full transition-all ${isResizing ? "h-12 bg-primary" : "bg-border group-hover:h-12 group-hover:bg-primary/70"}`}
          />
        </div>
        <InspectionPanel
          diff={diff}
          selectedFile={sessionState.selectedFile}
          onSelectFile={sessionState.setSelectedFile}
        />
      </div>
    </div>
  );
};
