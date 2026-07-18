import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Badge } from "../../../components/ui/badge";
import { DropdownMenu } from "../../../components/ui/dropdown-menu";
import { Skeleton } from "../../../components/ui/skeleton";
import type {
  AvailableEditorDto,
  EditorId,
} from "../../../../shared/ipc/schemas";
import { InspectionPanel } from "../components/InspectionPanel";
import { SessionComposer } from "../components/SessionComposer";
import { SessionMessages } from "../components/SessionMessages";
import { useCodingAgentSession } from "../hooks/useCodingAgentSession";
import { getSessionWorkspaceColumns } from "../lib/dual-chat-layout";

type EditorError = {
  source: "discovery" | "open";
  message: string;
};

const editorIconSources: Record<EditorId, string> = {
  vscode: new URL("../../../assets/editors/vscode.svg", import.meta.url).href,
  cursor: new URL("../../../assets/editors/cursor.svg", import.meta.url).href,
  zed: new URL("../../../assets/editors/zed.svg", import.meta.url).href,
  webstorm: new URL("../../../assets/editors/webstorm.svg", import.meta.url)
    .href,
  "intellij-idea": new URL(
    "../../../assets/editors/intellij-idea.svg",
    import.meta.url,
  ).href,
  "sublime-text": new URL(
    "../../../assets/editors/sublime-text.svg",
    import.meta.url,
  ).href,
  "android-studio": new URL(
    "../../../assets/editors/android-studio.svg",
    import.meta.url,
  ).href,
};

export const CodingAgentSession = ({
  runId,
  showInspection = true,
}: {
  runId: string;
  showInspection?: boolean;
}) => {
  const sessionState = useCodingAgentSession(runId);
  const [draft, setDraft] = useState("");
  const splitRef = useRef<HTMLDivElement>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(368);
  const [isResizing, setIsResizing] = useState(false);
  const [editors, setEditors] = useState<AvailableEditorDto[]>([]);
  const [editorError, setEditorError] = useState<EditorError>();
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
  useEffect(() => {
    if (!sessionState.snapshot) return;
    let cancelled = false;
    void window.api.editors
      .listAvailable()
      .then((availableEditors) => {
        if (cancelled) return;
        setEditors(availableEditors);
        setEditorError((current) =>
          current?.source === "discovery" ? undefined : current,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setEditors([]);
        setEditorError((current) =>
          current?.source === "open"
            ? current
            : {
                source: "discovery",
                message: "Could not load available editors. Please try again.",
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionState.snapshot?.context.worktree.id]);
  if (sessionState.loading) return <Skeleton className="h-full w-full" />;
  if (!sessionState.snapshot)
    return (
      <p className="text-sm text-destructive">
        {sessionState.error ?? "Session unavailable."}
      </p>
    );
  const { session, context, messages, diff } = sessionState.snapshot;
  const busy = ["busy", "creating", "aborting"].includes(session.status);
  const lastFinalAssistantMessageIndex = messages.length - 1;
  const lastMessage = messages[lastFinalAssistantMessageIndex];
  const agentFinished =
    lastMessage?.role === "assistant" && lastMessage.completedAt !== null;
  const agentRunning = busy && !agentFinished;
  const visibleMessages = messages.map((message, index) =>
    agentFinished && index === lastFinalAssistantMessageIndex
      ? { ...message, reasoning: "" }
      : message,
  );
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
  const openInEditor = async (editor: AvailableEditorDto) => {
    setEditorError(undefined);
    try {
      await window.api.editors.open({
        editorId: editor.id,
        worktreeId: context.worktree.id,
      });
    } catch {
      setEditorError({
        source: "open",
        message: `Could not open ${editor.name}. Please try again.`,
      });
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <section className="shrink-0 border-b border-border bg-gradient-to-r from-card via-card to-muted/30 px-6 py-4">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div className="min-w-0">
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
              <DropdownMenu
                label="Open in editor"
                items={editors.map((editor) => ({
                  id: editor.id,
                  label: editor.name,
                  iconSrc: editorIconSources[editor.id],
                }))}
                onSelect={(editorId) => {
                  const editor = editors.find(
                    (candidate) => candidate.id === editorId,
                  );
                  if (editor) void openInEditor(editor);
                }}
              />
            </div>
            {editorError && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {editorError.message}
              </p>
            )}
          </div>
        </div>
      </section>
      <div
        ref={splitRef}
        style={
          {
            "--session-workspace-columns": getSessionWorkspaceColumns(
              showInspection,
              diffPanelWidth,
            ),
          } as CSSProperties
        }
        className="grid min-h-0 flex-1 grid-cols-1 xl:[grid-template-columns:var(--session-workspace-columns)]"
      >
        <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="truncate text-xs font-medium">
              {session.title}
            </span>
          </div>
          <SessionMessages
            messages={visibleMessages}
            busy={agentRunning}
            activity={busy && !agentFinished ? sessionState.activity : undefined}
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
            busy={agentRunning}
            locked={composerLocked}
            onDraftChange={setDraft}
            onModelChange={(key) => void sessionState.changeModel(key)}
            onReasoningChange={sessionState.setReasoningVariant}
            onSend={send}
            onStop={() => void window.api.codingAgent.abortSession({ runId })}
          />
        </section>
        {showInspection ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  );
};
