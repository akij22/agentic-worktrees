import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";

export const isBusyLikeStatus = (status: string): boolean =>
  ["busy", "creating", "aborting"].includes(status);

export type ChangesSummarySnapshot = {
  status: string;
  diff: CodingAgentDiffDto[];
  /**
   * True when the last session message is a completed assistant message.
   * This is the reliable completion signal: the run status depends on SSE
   * events that can be delayed or missed, leaving a session stuck on "busy"
   * even after the agent has finished.
   */
  agentFinished: boolean;
};

export type ChangesSummaryUpdate =
  | { kind: "working" }
  | { kind: "completed"; diff: CodingAgentDiffDto[] }
  | { kind: "unchanged" };

/**
 * Decides how the changes summary panel reacts to a new session snapshot.
 *
 * The panel appears only when the agent finishes while the session is being
 * viewed: a busy-like status arms the panel, and a later snapshot with a
 * completed final assistant message and a non-empty diff shows it. Two races
 * are handled explicitly:
 *
 * - the diff can lag behind completion (OpenCode serves it through a
 *   separate endpoint), so a finished snapshot without changes leaves the
 *   panel armed instead of dismissing it;
 * - the run status can stay busy-like forever when the idle SSE event is
 *   missed, so completion takes precedence over the busy-like status.
 */
export const nextChangesSummaryUpdate = (
  armed: boolean,
  snapshot: ChangesSummarySnapshot,
): ChangesSummaryUpdate => {
  if (snapshot.agentFinished) {
    if (armed && snapshot.diff.length > 0)
      return { kind: "completed", diff: snapshot.diff };
    return { kind: "unchanged" };
  }
  if (isBusyLikeStatus(snapshot.status)) return { kind: "working" };
  return { kind: "unchanged" };
};
