export const DUAL_CHAT_DIVIDER_WIDTH = 8;
export const DUAL_CHAT_MIN_PANEL_WIDTH = 320;

export const clampPrimaryPanelWidth = (
  containerWidth: number,
  requestedWidth: number,
): number => {
  const availableWidth = Math.max(
    0,
    containerWidth - DUAL_CHAT_DIVIDER_WIDTH,
  );
  const effectiveMinimum = Math.min(
    DUAL_CHAT_MIN_PANEL_WIDTH,
    availableWidth / 2,
  );

  return Math.min(
    availableWidth - effectiveMinimum,
    Math.max(effectiveMinimum, requestedWidth),
  );
};

export const resolveSecondaryRunId = (
  primaryRunId: string,
  requestedRunId: string | null | undefined,
  availableRunIds: readonly string[],
): string | undefined =>
  requestedRunId &&
  requestedRunId !== primaryRunId &&
  availableRunIds.includes(requestedRunId)
    ? requestedRunId
    : undefined;

export const getSessionWorkspaceColumns = (
  showInspection: boolean,
  inspectionWidth: number,
): string =>
  showInspection
    ? `minmax(0,1fr) 0.5rem ${inspectionWidth}px`
    : "minmax(0,1fr)";

export const setSecondaryRunId = (
  current: URLSearchParams,
  runId: string | undefined,
): URLSearchParams => {
  const next = new URLSearchParams(current);

  if (runId) next.set("secondaryRunId", runId);
  else next.delete("secondaryRunId");

  return next;
};
