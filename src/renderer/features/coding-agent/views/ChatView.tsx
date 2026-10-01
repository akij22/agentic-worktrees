import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppNavigation, AppNavigationFooter } from "../../../components/AppNavigation";
import { WORKSPACE_SIDEBAR_DEFAULT_WIDTH, WORKSPACE_SIDEBAR_MIN_WIDTH } from "../../../components/app-shell-layout";
import { ThreadListSidebar } from "../components/ThreadListSidebar";
import { useCodingAgentSessions } from "../hooks/useCodingAgentSessions";
import { CodingAgentWorkspace } from "./CodingAgentWorkspace";
import { NewThreadView } from "./NewThreadView";

const THREAD_SIDEBAR_MIN_WIDTH = WORKSPACE_SIDEBAR_MIN_WIDTH;
const THREAD_SIDEBAR_MAX_WIDTH = 420;
const THREAD_SIDEBAR_DEFAULT_WIDTH = WORKSPACE_SIDEBAR_DEFAULT_WIDTH;
const THREAD_SIDEBAR_KEYBOARD_STEP = 16;

const clampThreadSidebarWidth = (width: number) =>
  Math.min(
    THREAD_SIDEBAR_MAX_WIDTH,
    Math.max(THREAD_SIDEBAR_MIN_WIDTH, width),
  );

/**
 * Serves both halves of the chat surface.
 *
 * `/chat` with no run id is the landing: the composer writes into a workspace
 * that has not been turned into a session yet. `/chat/:worktreeId/:runId`
 * mounts the workspace for an existing session. The sidebar is mounted in both
 * cases so the thread list does not unmount when crossing between them.
 */
export const ChatView = ({ activeRunId }: { activeRunId?: string }) => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [threadSidebarWidth, setThreadSidebarWidth] = useState(
    THREAD_SIDEBAR_DEFAULT_WIDTH,
  );
  const [isResizingThreadSidebar, setIsResizingThreadSidebar] = useState(false);
  const { status, contexts, sessions, sessionDetails, loading, error } =
    useCodingAgentSessions();
  const configuredInstallations =
    status?.installations.filter((installation) => installation.configured) ??
    [];

  const requestedWorktreeId = searchParams.get("worktreeId") ?? undefined;

  useEffect(() => {
    if (!isResizingThreadSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = layoutRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setThreadSidebarWidth(
        clampThreadSidebarWidth(event.clientX - bounds.left),
      );
    };
    const stopResizing = () => setIsResizingThreadSidebar(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizingThreadSidebar]);

  const openSession = useCallback(
    (session: { worktreeId: string; id: string }) =>
      navigate(
        `/chat/${encodeURIComponent(session.worktreeId)}/${encodeURIComponent(session.id)}`,
      ),
    [navigate],
  );

  return (
    <div
      ref={layoutRef}
      className="flex h-full min-h-0 overflow-hidden bg-background"
    >
      <ThreadListSidebar
        navigation={<AppNavigation />}
        footer={<AppNavigationFooter />}
        contexts={contexts}
        sessions={sessions}
        sessionDetails={sessionDetails}
        activeRunId={activeRunId}
        width={threadSidebarWidth}
        loading={loading}
        error={error}
        hasConfiguredHarness={configuredInstallations.length > 0}
        onNewSession={() => navigate("/chat")}
        onOpenSession={openSession}
      />

      <div
        role="separator"
        aria-label="Resize thread sidebar"
        aria-orientation="vertical"
        aria-valuemin={THREAD_SIDEBAR_MIN_WIDTH}
        aria-valuemax={THREAD_SIDEBAR_MAX_WIDTH}
        aria-valuenow={threadSidebarWidth}
        aria-valuetext={`${threadSidebarWidth} pixels`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          setThreadSidebarWidth((width) =>
            clampThreadSidebarWidth(
              width + direction * THREAD_SIDEBAR_KEYBOARD_STEP,
            ),
          );
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizingThreadSidebar(true);
        }}
        className={`group relative z-10 -ml-px flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          isResizingThreadSidebar
            ? "bg-primary/15"
            : "bg-transparent hover:bg-primary/5"
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-px rounded-full transition-all ${
            isResizingThreadSidebar
              ? "h-14 bg-primary"
              : "h-10 bg-border group-hover:h-14 group-hover:bg-primary/70"
          }`}
        />
      </div>

      <section
        aria-label="Chat workspace"
        className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      >
        {activeRunId ? (
          <CodingAgentWorkspace primaryRunId={activeRunId} />
        ) : (
          <NewThreadView
            contexts={contexts}
            installations={status?.installations ?? []}
            initialWorktreeId={requestedWorktreeId}
            sessions={sessions.map((session) => ({
              id: session.id,
              worktreeId: session.worktreeId,
              updatedAt: session.updatedAt,
              isDraft: session.status === "idle" && !session.title.trim(),
            }))}
          />
        )}
      </section>
    </div>
  );
};
