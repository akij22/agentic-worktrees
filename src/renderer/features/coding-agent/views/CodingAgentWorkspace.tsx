import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CodingAgentLayoutControls } from "../components/CodingAgentLayoutControls";
import type { CodingAgentLayoutMode } from "../components/CodingAgentLayoutControls";
import { SecondarySessionSelector } from "../components/SecondarySessionSelector";
import { useCodingAgentSessions } from "../hooks/useCodingAgentSessions";
import {
  clampPrimaryPanelWidth,
  DUAL_CHAT_DIVIDER_WIDTH,
  resolveSecondaryRunId,
  setSecondaryRunId,
} from "../lib/dual-chat-layout";
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
      <CodingAgentSession runId={secondaryRunId} showInspection={false} />
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
  const [mode, setMode] = useState<CodingAgentLayoutMode>("single");
  const [primaryPanelWidth, setPrimaryPanelWidth] = useState<number>();
  const [primaryPanelPercent, setPrimaryPanelPercent] = useState(50);
  const [isResizing, setIsResizing] = useState(false);

  const updatePrimaryPanelWidth = (requestedWidth: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const nextWidth = clampPrimaryPanelWidth(bounds.width, requestedWidth);
    const availableWidth = Math.max(
      1,
      bounds.width - DUAL_CHAT_DIVIDER_WIDTH,
    );
    setPrimaryPanelWidth(nextWidth);
    setPrimaryPanelPercent(Math.round((nextWidth / availableWidth) * 100));
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

  const gridTemplateColumns = primaryPanelWidth
    ? `${primaryPanelWidth}px ${DUAL_CHAT_DIVIDER_WIDTH}px minmax(0,1fr)`
    : `minmax(0,1fr) ${DUAL_CHAT_DIVIDER_WIDTH}px minmax(0,1fr)`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 justify-end border-b border-border bg-card px-4 py-2">
        <CodingAgentLayoutControls mode={mode} onModeChange={setMode} />
      </div>
      <div
        ref={workspaceRef}
        style={
          mode === "dual"
            ? ({ gridTemplateColumns } as CSSProperties)
            : undefined
        }
        className={
          mode === "dual"
            ? "grid min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-hidden"
        }
      >
        <CodingAgentSession
          runId={primaryRunId}
          showInspection={mode === "single"}
        />
        {mode === "dual" ? (
          <>
            <div
              role="separator"
              aria-label="Resize coding agent chat panels"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={primaryPanelPercent}
              aria-valuetext={`${primaryPanelPercent}% for the primary chat`}
              tabIndex={0}
              onKeyDown={(event) => {
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
                event.preventDefault();
                setIsResizing(true);
              }}
              className={`group relative z-10 flex touch-none cursor-col-resize items-center justify-center border-x border-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
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
            <SecondaryChatPanel primaryRunId={primaryRunId} />
          </>
        ) : null}
      </div>
    </div>
  );
};
