import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import { CodingAgentProjectSidebar } from "../components/CodingAgentProjectSidebar";
import { NewSessionDialog } from "../components/NewSessionDialog";
import { useCodingAgentSessions } from "../hooks/useCodingAgentSessions";
import { CodingAgentWorkspace } from "./CodingAgentWorkspace";

const PROJECT_SIDEBAR_MIN_WIDTH = 240;
const PROJECT_SIDEBAR_MAX_WIDTH = 420;
const PROJECT_SIDEBAR_DEFAULT_WIDTH = PROJECT_SIDEBAR_MIN_WIDTH;
const PROJECT_SIDEBAR_KEYBOARD_STEP = 16;

const clampProjectSidebarWidth = (width: number) =>
  Math.min(
    PROJECT_SIDEBAR_MAX_WIDTH,
    Math.max(PROJECT_SIDEBAR_MIN_WIDTH, width),
  );

export const CodingAgentLanding = ({
  activeRunId,
}: {
  activeRunId?: string;
}) => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(
    searchParams.get("new") === "1",
  );
  const [projectSidebarWidth, setProjectSidebarWidth] = useState(
    PROJECT_SIDEBAR_DEFAULT_WIDTH,
  );
  const [isResizingProjectSidebar, setIsResizingProjectSidebar] =
    useState(false);
  const { status, contexts, sessions, loading, error } =
    useCodingAgentSessions();
  const requestedWorktreeId = searchParams.get("worktreeId") ?? undefined;
  const configuredInstallations =
    status?.installations.filter((installation) => installation.configured) ??
    [];

  const closeDialog = () => {
    setDialogOpen(false);
    setSearchParams({});
  };

  useEffect(() => {
    if (!isResizingProjectSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = layoutRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setProjectSidebarWidth(
        clampProjectSidebarWidth(event.clientX - bounds.left),
      );
    };
    const stopResizing = () => setIsResizingProjectSidebar(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizingProjectSidebar]);

  return (
    <div
      ref={layoutRef}
      className="flex h-full min-h-0 overflow-hidden bg-card"
    >
      <CodingAgentProjectSidebar
        contexts={contexts}
        sessions={sessions}
        activeRunId={activeRunId}
        width={projectSidebarWidth}
        loading={loading}
        error={error}
        onNewSession={() => setDialogOpen(true)}
        onOpenSession={(session) =>
          navigate(`/coding-agent/${session.worktreeId}/${session.id}`)
        }
      />

      <div
        role="separator"
        aria-label="Resize project sidebar"
        aria-orientation="vertical"
        aria-valuemin={PROJECT_SIDEBAR_MIN_WIDTH}
        aria-valuemax={PROJECT_SIDEBAR_MAX_WIDTH}
        aria-valuenow={projectSidebarWidth}
        aria-valuetext={`${projectSidebarWidth} pixels`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          setProjectSidebarWidth((width) =>
            clampProjectSidebarWidth(
              width + direction * PROJECT_SIDEBAR_KEYBOARD_STEP,
            ),
          );
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizingProjectSidebar(true);
        }}
        className={`group relative z-10 -ml-px flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          isResizingProjectSidebar
            ? "bg-primary/15"
            : "bg-transparent hover:bg-primary/10"
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-px rounded-full transition-all ${
            isResizingProjectSidebar
              ? "h-14 bg-primary"
              : "h-10 bg-border group-hover:h-14 group-hover:bg-primary/70"
          }`}
        />
      </div>

      <section
        aria-label="Coding agent workspace"
        className="min-h-0 min-w-0 flex-1 overflow-hidden bg-card"
      >
        {activeRunId ? (
          <CodingAgentWorkspace primaryRunId={activeRunId} />
        ) : (
          <div className="grid h-full min-h-[28rem] place-items-center px-8 text-center">
            <div className="max-w-md">
              <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl border border-border bg-muted/30 font-mono text-base text-muted-foreground">
                &gt;_
              </div>
              {configuredInstallations.length === 0 && !loading ? (
                <>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Configure a coding agent first
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Select a local coding-agent executable before starting a
                    chat.
                  </p>
                  <Button
                    className="mt-5"
                    onClick={() => navigate("/settings")}
                  >
                    Open Settings
                  </Button>
                </>
              ) : sessions.length === 0 && !loading ? (
                <>
                  <h2 className="text-lg font-semibold tracking-tight">
                    No coding sessions yet
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Start a chat from the project sidebar.
                  </p>
                  <Button
                    className="mt-5"
                    onClick={() => setDialogOpen(true)}
                  >
                    New chat
                  </Button>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold tracking-tight">
                    Select a coding session
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Choose a chat from a project in the sidebar to continue
                    working.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <NewSessionDialog
        open={dialogOpen}
        contexts={contexts}
        installations={status?.installations ?? []}
        initialWorktreeId={requestedWorktreeId}
        onClose={closeDialog}
      />
    </div>
  );
};
