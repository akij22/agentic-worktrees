import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CodingAgentSessionHeader } from "../components/CodingAgentSessionHeader";
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
import type { SkillSummaryDto } from "../../../../shared/skills/schemas";

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
  const [selectedSkill, setSelectedSkill] = useState<SkillSummaryDto>();
  useEffect(() => {
    setSelectedSkill(undefined);
    setDraft("");
  }, [runId]);
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
    if (!content && !selectedSkill) return;
    const turn = selectedSkill
      ? {
          skillInvocation: {
            skillId: selectedSkill.id,
            version: selectedSkill.version,
            ...(content ? { arguments: content } : {}),
          },
        }
      : content;
    void sessionState.send(turn).then((sent) => {
      if (sent) {
        setDraft("");
        setSelectedSkill(undefined);
      }
    });
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
      <CodingAgentSessionHeader
        key={runId}
        context={context}
        title={headerTitle}
        layoutActions={headerActions}
        editorError={editorError?.message}
        capabilities={sessionState.capabilities}
        onRemoveCapability={sessionState.deactivateCapability}
        editorAction={
          <DropdownMenu
            label="Open in editor"
            className="shrink-0"
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
        }
      />
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
            capabilities={sessionState.capabilities}
            skillInvocations={sessionState.snapshot?.skillInvocations}
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
            {sessionState.capabilityReloading ? (
              <div className="px-5 py-2 font-mono text-[11px] text-primary">
                Applying{" "}
                {sessionState.capabilities.find(
                  (capability) => capability.state === "reloading",
                )?.name ?? "capabilities"}
                …
              </div>
            ) : null}
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
              locked={
                composerLocked ||
                sessionState.compacting ||
                sessionState.capabilityReloading
              }
              capabilityLibrary={sessionState.capabilityLibrary}
              skills={sessionState.skillLibrary}
              selectedSkill={selectedSkill}
              onSkillSelect={setSelectedSkill}
              onSkillClear={() => setSelectedSkill(undefined)}
              capabilityReloading={sessionState.capabilityReloading}
              onActivateCapability={sessionState.activateCapability}
              onDeactivateCapability={sessionState.deactivateCapability}
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
