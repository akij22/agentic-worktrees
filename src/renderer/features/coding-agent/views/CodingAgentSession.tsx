import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Badge } from "../../../components/ui/badge";
import { DropdownMenu } from "../../../components/ui/dropdown-menu";
import { Skeleton } from "../../../components/ui/skeleton";
import type {
  AvailableEditorDto,
  CodingAgentAccountUsageDto,
  CodingAgentSessionUsageDto,
  EditorId,
} from "../../../../shared/ipc/schemas";
import { AccountUsagePopup } from "../components/AccountUsagePopup";
import { WorkspacePanel } from "../components/WorkspacePanel";
import { SessionChangesSummary } from "../components/SessionChangesSummary";
import { SessionComposer } from "../components/SessionComposer";
import { SessionMessages } from "../components/SessionMessages";
import { SessionStatusPopup } from "../components/SessionStatusPopup";
import { useCodingAgentSession } from "../hooks/useCodingAgentSession";
import { getSessionWorkspaceColumns } from "../lib/dual-chat-layout";
import { getLinkedDiffFile } from "../lib/file-links";
import type { SlashCommandId } from "../lib/slash-commands";

type EditorError = {
  source: "discovery" | "open";
  message: string;
};

type StatusPopupState = {
  loading: boolean;
  usage?: CodingAgentSessionUsageDto;
  error?: string;
};

type AccountUsagePopupState = {
  loading: boolean;
  accountUsage?: CodingAgentAccountUsageDto;
  sessionUsage?: CodingAgentSessionUsageDto;
  error?: string;
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
  headerTitle,
  headerActions,
  workspaceOpen: workspaceOpenProp,
  onWorkspaceOpenChange,
}: {
  runId: string;
  showInspection?: boolean;
  headerTitle?: string;
  headerActions?: ReactNode;
  workspaceOpen?: boolean;
  onWorkspaceOpenChange?: (open: boolean) => void;
}) => {
  const sessionState = useCodingAgentSession(runId);
  const [draft, setDraft] = useState("");
  const splitRef = useRef<HTMLDivElement>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(368);
  const [isResizing, setIsResizing] = useState(false);
  const [fallbackWorkspaceOpen, setFallbackWorkspaceOpen] = useState(true);
  const workspaceOpen = workspaceOpenProp ?? fallbackWorkspaceOpen;
  const setWorkspaceOpen = onWorkspaceOpenChange ?? setFallbackWorkspaceOpen;
  const [editors, setEditors] = useState<AvailableEditorDto[]>([]);
  const [editorError, setEditorError] = useState<EditorError>();
  const [statusPopup, setStatusPopup] = useState<StatusPopupState>();
  const [accountUsagePopup, setAccountUsagePopup] =
    useState<AccountUsagePopupState>();
  const [composerUsage, setComposerUsage] =
    useState<CodingAgentSessionUsageDto>();
  const clearFocusedDiffFile = useCallback(
    () => sessionState.selectSummaryFile(undefined),
    [sessionState.selectSummaryFile],
  );
  const selectDiffFile = useCallback(
    (file?: string) => {
      if (file !== undefined) setWorkspaceOpen(true);
      sessionState.selectSummaryFile(file);
    },
    [sessionState.selectSummaryFile],
  );
  const openLinkedDiffFile = useCallback(
    (href: string): boolean => {
      const file = getLinkedDiffFile(
        href,
        sessionState.snapshot?.diff.map((diff) => diff.file) ?? [],
        sessionState.snapshot?.context.worktree.path ?? "",
      );
      if (!file) return false;
      selectDiffFile(file);
      return true;
    },
    [selectDiffFile, sessionState.snapshot],
  );
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
  useEffect(() => {
    setStatusPopup(undefined);
    setAccountUsagePopup(undefined);
    setComposerUsage(undefined);
  }, [runId]);
  useEffect(() => {
    if (!sessionState.snapshot) return;
    let cancelled = false;
    const refreshUsage = async () => {
      try {
        const usage = await window.api.codingAgent.getSessionUsage({ runId });
        if (!cancelled) setComposerUsage(usage);
      } catch {
        // Usage is supplementary UI; the status command still exposes errors.
      }
    };
    void refreshUsage();
    const timer = window.setInterval(() => void refreshUsage(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    runId,
    sessionState.snapshot?.session.modelId,
    sessionState.snapshot?.session.providerId,
  ]);
  useEffect(() => {
    if (!statusPopup || statusPopup.loading) return;
    const timeout = window.setTimeout(() => setStatusPopup(undefined), 10_000);
    return () => window.clearTimeout(timeout);
  }, [statusPopup]);
  if (sessionState.loading) return <Skeleton className="h-full w-full" />;
  if (!sessionState.snapshot)
    return (
      <p className="text-sm text-destructive">
        {sessionState.error ?? "Session unavailable."}
      </p>
    );
  const { session, context, messages, diff } = sessionState.snapshot;
  const inspectionVisible = showInspection && workspaceOpen;
  const busy = ["busy", "creating", "aborting"].includes(session.status);
  const lastMessage = messages.at(-1);
  const agentFinished =
    lastMessage?.role === "assistant" && lastMessage.completedAt !== null;
  const agentRunning = [
    "busy",
    "creating",
    "waiting_permission",
    "aborting",
  ].includes(session.status);
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
  const showStatus = async () => {
    setStatusPopup({ loading: true });
    try {
      const usage = await window.api.codingAgent.getSessionUsage({ runId });
      setStatusPopup({ loading: false, usage });
    } catch (cause) {
      setStatusPopup({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
  const showAccountUsage = async () => {
    setStatusPopup(undefined);
    setAccountUsagePopup({ loading: true });
    try {
      const [accountUsage, sessionUsage] = await Promise.all([
        window.api.codingAgent.getAccountUsage({ runId }),
        window.api.codingAgent
          .getSessionUsage({ runId })
          .catch(() => undefined),
      ]);
      setAccountUsagePopup({ loading: false, accountUsage, sessionUsage });
    } catch {
      setAccountUsagePopup({
        loading: false,
        error: "Could not retrieve account usage. Please try again.",
      });
    }
  };
  const executeSlashCommand = (command: SlashCommandId) => {
    if (command === "status") {
      void showStatus();
      return;
    }
    if (command === "usage") {
      void showAccountUsage();
      return;
    }
    if (command === "compact") {
      if (!agentRunning && !sessionState.compacting)
        void sessionState.compact();
      return;
    }
    if (command === "stop") {
      if (agentRunning) void window.api.codingAgent.abortSession({ runId });
    }
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <section className="flex min-h-16 shrink-0 items-center border-b border-border/60 bg-background/95 px-6 py-2 backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 items-center gap-6">
          {headerTitle ? (
            <h1 className="shrink-0 text-base font-semibold tracking-[-0.018em]">
              {headerTitle}
            </h1>
          ) : null}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-3">
              <h2
                className="min-w-0 truncate font-mono text-base font-semibold"
                title={context.worktree.name}
              >
                {context.worktree.name}
              </h2>
              <span
                className="min-w-0 shrink-[2] truncate font-mono text-sm text-muted-foreground"
                title={context.worktree.branchName}
              >
                {context.worktree.branchName}
              </span>
              <Badge
                variant="outline"
                className="min-w-0 max-w-full shrink-[3] truncate font-mono text-[11px]"
                title={context.repository.fullName}
              >
                {context.repository.fullName}
              </Badge>
              <DropdownMenu
                label="Open in editor"
                className="ml-auto shrink-0"
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
            {editorError ? (
              <p
                className="mt-1 truncate text-xs text-destructive"
                role="alert"
              >
                {editorError.message}
              </p>
            ) : null}
          </div>
          {headerActions ? (
            <div className="shrink-0">{headerActions}</div>
          ) : null}
        </div>
      </section>
      <div
        ref={splitRef}
        style={
          {
            "--session-workspace-columns": getSessionWorkspaceColumns(
              inspectionVisible,
              diffPanelWidth,
            ),
          } as CSSProperties
        }
        className={`grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:[grid-template-columns:var(--session-workspace-columns)] ${
          inspectionVisible
            ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-rows-1"
            : "grid-rows-1"
        }`}
      >
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background xl:border-b-0">
          <div className="flex items-center justify-between bg-background px-5 py-3">
            <span className="truncate text-xs font-medium">
              {session.title}
            </span>
          </div>
          <SessionMessages
            agentName={session.agentName}
            messages={messages}
            busy={agentRunning}
            activity={
              busy && !agentFinished ? sessionState.activity : undefined
            }
            transientThought={
              sessionState.compacting ? "Compacting context..." : undefined
            }
            permission={sessionState.permission}
            error={sessionState.error}
            onRespondPermission={(response) =>
              void sessionState.respondPermission(response)
            }
            onOpenFile={openLinkedDiffFile}
          >
            {sessionState.changesSummary ? (
              <SessionChangesSummary
                diff={sessionState.changesSummary}
                onSelectFile={(file) => selectDiffFile(file)}
                onDismiss={sessionState.dismissChangesSummary}
              />
            ) : null}
          </SessionMessages>
          <div className="relative shrink-0">
            {accountUsagePopup ? (
              <AccountUsagePopup
                session={session}
                accountUsage={accountUsagePopup.accountUsage}
                sessionUsage={accountUsagePopup.sessionUsage}
                loading={accountUsagePopup.loading}
                error={accountUsagePopup.error}
                onClose={() => setAccountUsagePopup(undefined)}
              />
            ) : null}
            {statusPopup ? (
              <SessionStatusPopup
                session={session}
                usage={statusPopup.usage}
                loading={statusPopup.loading}
                error={statusPopup.error}
                onClose={() => setStatusPopup(undefined)}
              />
            ) : null}
            <SessionComposer
              session={session}
              branchName={context.worktree.branchName}
              usage={composerUsage}
              draft={draft}
              models={sessionState.models}
              modelKey={sessionState.modelKey}
              reasoningVariant={sessionState.reasoningVariant}
              reasoningVariants={reasoningVariants}
              loadingModels={sessionState.loadingModels}
              changingModel={sessionState.changingModel}
              busy={agentRunning || sessionState.compacting}
              locked={composerLocked || sessionState.compacting}
              onDraftChange={setDraft}
              onModelChange={(key) => void sessionState.changeModel(key)}
              onReasoningChange={sessionState.setReasoningVariant}
              onSend={send}
              onStop={() => void window.api.codingAgent.abortSession({ runId })}
              onSlashCommand={executeSlashCommand}
            />
          </div>
        </section>
        {inspectionVisible ? (
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
              className={`group relative hidden touch-none cursor-col-resize items-center justify-center bg-transparent transition-colors xl:flex ${isResizing ? "bg-primary/10" : "hover:bg-primary/5"}`}
            >
              <span
                className={`h-8 w-px rounded-full transition-all ${isResizing ? "h-12 bg-primary" : "bg-border group-hover:h-12 group-hover:bg-primary/70"}`}
              />
            </div>
            <WorkspacePanel
              key={runId}
              runId={runId}
              worktreeId={context.worktree.id}
              worktreePath={context.worktree.path}
              diff={diff}
              focusedFile={sessionState.selectedSummaryFile}
              onFocusedFileConsumed={clearFocusedDiffFile}
            />
          </>
        ) : null}
      </div>
    </div>
  );
};
