import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CodingAgentLayoutControls } from "../components/CodingAgentLayoutControls";
import type { CodingAgentLayoutMode } from "../components/CodingAgentLayoutControls";
import { SecondarySessionSelector } from "../components/SecondarySessionSelector";
import { useCodingAgentSessions } from "../hooks/useCodingAgentSessions";
import {
  DUAL_CHAT_TRANSITION_DURATION_MS,
  useDualChatTransition,
} from "../hooks/useDualChatTransition";
import {
  clampPrimaryPanelWidth,
  DUAL_CHAT_DIVIDER_WIDTH,
  getDualChatGridTemplate,
  resolveSecondaryRunId,
  setSecondaryRunId,
} from "../lib/dual-chat-layout";
import { usePrefersReducedMotion } from "../../../lib/use-prefers-reduced-motion";
import { CodingAgentSession } from "./CodingAgentSession";

const SecondaryChatPanel = ({ primaryRunId }: { primaryRunId: string }) => {
  const { contexts, sessions, sessionDetails, loading, error } =
    useCodingAgentSessions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [unavailableMessage, setUnavailableMessage] = useState<string>();
  const requestedRunId = searchParams.get("secondaryRunId");
  const availableRunIds = useMemo(
    () => sessions.map((session) => session.id),
    [sessions],
  );
  const secondaryRunId = resolveSecondaryRunId(
    primaryRunId,
    requestedRunId,
    availableRunIds,
  );

  useEffect(() => {
    if (loading || error || !requestedRunId || secondaryRunId) return;

    setUnavailableMessage("The previously selected chat is no longer available.");
    setSearchParams(setSecondaryRunId(searchParams, undefined), {
      replace: true,
    });
  }, [
    error,
    loading,
    requestedRunId,
    searchParams,
    secondaryRunId,
    setSearchParams,
  ]);

  if (secondaryRunId) {
    return (
      <CodingAgentSession
        key={secondaryRunId}
        runId={secondaryRunId}
        showInspection={false}
      />
    );
  }

  return (
    <SecondarySessionSelector
      primaryRunId={primaryRunId}
      sessions={sessions}
      contexts={contexts}
      sessionDetails={sessionDetails}
      loading={loading}
      error={error}
      unavailableMessage={unavailableMessage}
      onSelect={(runId) => {
        setUnavailableMessage(undefined);
        setSearchParams(setSecondaryRunId(searchParams, runId));
      }}
    />
  );
};

export const CodingAgentWorkspace = ({
  primaryRunId,
}: {
  primaryRunId: string;
}) => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const secondaryPanelRef = useRef<HTMLDivElement>(null);
  const dualLayoutButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<CodingAgentLayoutMode>("single");
  const [primaryPanelWidth, setPrimaryPanelWidth] = useState<number>();
  const [primaryPanelPercent, setPrimaryPanelPercent] = useState(50);
  const [isResizing, setIsResizing] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const { isSecondaryMounted, isSecondaryVisible } = useDualChatTransition(
    mode,
    prefersReducedMotion,
  );

  const updatePrimaryPanelWidth = (requestedWidth: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const nextWidth = clampPrimaryPanelWidth(bounds.width, requestedWidth);
    const availableWidth = Math.max(
      1,
      bounds.width - DUAL_CHAT_DIVIDER_WIDTH,
    );
    setPrimaryPanelWidth(nextWidth);
    setPrimaryPanelPercent((nextWidth / availableWidth) * 100);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return;
      updatePrimaryPanelWidth(event.clientX - bounds.left);
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
    if (mode !== "dual" || primaryPanelWidth === undefined) return;

    const clampCurrentWidth = () =>
      updatePrimaryPanelWidth(primaryPanelWidth);
    window.addEventListener("resize", clampCurrentWidth);
    return () => window.removeEventListener("resize", clampCurrentWidth);
  }, [mode, primaryPanelWidth]);

  const handleModeChange = (nextMode: CodingAgentLayoutMode) => {
    if (
      nextMode === "single" &&
      secondaryPanelRef.current?.contains(document.activeElement)
    ) {
      dualLayoutButtonRef.current?.focus();
    }
    setMode(nextMode);
  };

  const workspaceStyle = isSecondaryMounted
    ? ({
        gridTemplateColumns: getDualChatGridTemplate(
          primaryPanelPercent,
          isSecondaryVisible,
        ),
        "--dual-chat-transition-duration": `${DUAL_CHAT_TRANSITION_DURATION_MS}ms`,
      } as CSSProperties)
    : undefined;
  const roundedPrimaryPanelPercent = Math.round(primaryPanelPercent);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div
        ref={workspaceRef}
        style={workspaceStyle}
        data-secondary-visible={isSecondaryVisible}
        data-resizing={isResizing}
        className={
          isSecondaryMounted
            ? "dual-chat-workspace grid min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-hidden"
        }
      >
        <div className="min-w-0 overflow-hidden">
          <CodingAgentSession
            key={primaryRunId}
            runId={primaryRunId}
            showInspection={!isSecondaryMounted}
            headerTitle="Coding Agent"
            headerActions={
              <CodingAgentLayoutControls
                mode={mode}
                onModeChange={handleModeChange}
                dualButtonRef={dualLayoutButtonRef}
              />
            }
          />
        </div>
        {isSecondaryMounted ? (
          <>
            <div
              role="separator"
              aria-label="Resize coding agent chat panels"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={roundedPrimaryPanelPercent}
              aria-valuetext={`${roundedPrimaryPanelPercent}% for the primary chat`}
              aria-hidden={!isSecondaryVisible}
              tabIndex={isSecondaryVisible ? 0 : -1}
              onKeyDown={(event) => {
                if (!isSecondaryVisible) return;
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;

                event.preventDefault();
                const bounds = workspaceRef.current?.getBoundingClientRect();
                if (!bounds) return;
                const currentWidth =
                  primaryPanelWidth ??
                  (bounds.width - DUAL_CHAT_DIVIDER_WIDTH) / 2;
                const direction = event.key === "ArrowLeft" ? -24 : 24;
                updatePrimaryPanelWidth(currentWidth + direction);
              }}
              onPointerDown={(event) => {
                if (!isSecondaryVisible) return;
                event.preventDefault();
                setIsResizing(true);
              }}
              className={`dual-chat-divider group relative z-10 flex touch-none cursor-col-resize items-center justify-center border-x border-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                isResizing ? "bg-primary/10" : "bg-transparent hover:bg-primary/5"
              }`}
            >
              <span
                aria-hidden="true"
                className={`w-px rounded-full transition-all ${
                  isResizing
                    ? "h-14 bg-primary"
                    : "h-10 bg-border group-hover:h-14 group-hover:bg-primary/70"
                }`}
              />
            </div>
            <div
              ref={secondaryPanelRef}
              aria-hidden={!isSecondaryVisible}
              inert={!isSecondaryVisible}
              className="dual-chat-secondary min-w-0 overflow-hidden"
            >
              <SecondaryChatPanel primaryRunId={primaryRunId} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};
