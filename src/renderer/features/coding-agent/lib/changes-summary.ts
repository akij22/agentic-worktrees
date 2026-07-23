import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";

export const isBusyLikeStatus = (status: string): boolean =>
  ["busy", "creating", "aborting"].includes(status);

export type ChangesSummarySnapshot = {
  status: string;
  diff: CodingAgentDiffDto[];
};

export type ChangesSummaryUpdate =
  | { kind: "working" }
  | { kind: "completed"; diff: CodingAgentDiffDto[] }
  | { kind: "unchanged" };

/**
 * Decides how the changes summary panel reacts to a new session snapshot.
 *
 * The panel appears only when the agent finishes while the session is being
 * viewed: a busy-like status arms the panel, and a later idle snapshot with a
 * non-empty diff shows it. The idle status is the completion signal for the
 * whole turn; completed assistant messages can also be emitted between tool
 * calls and must not open the panel early.
 *
 * - the diff can lag behind completion (OpenCode serves it through a
 *   separate endpoint), so a finished snapshot without changes leaves the
 *   panel armed instead of dismissing it;
 */
export const nextChangesSummaryUpdate = (
  armed: boolean,
  snapshot: ChangesSummarySnapshot,
): ChangesSummaryUpdate => {
  if (snapshot.status === "idle") {
    if (armed && snapshot.diff.length > 0)
      return { kind: "completed", diff: snapshot.diff };
    return { kind: "unchanged" };
  }
  if (isBusyLikeStatus(snapshot.status)) return { kind: "working" };
  return { kind: "unchanged" };
};
