/**
 * The Assignment lives on the Worktree; the materialisation lives on the
 * session. These are the rules that connect the two, kept free of database and
 * process concerns so they can be verified directly.
 */

/** Assignment states, mirroring the vocabulary in CONTEXT.md. */
export type WorktreeCapabilityStatus =
  | "pending_activation"
  | "active"
  | "pending_deactivation"
  | "activation_failed"
  | "deactivated";

export type WorktreeCapabilityRecord = {
  worktreeId: string;
  capabilityId: string;
  version: string;
  status: string;
  errorCode?: string;
};

export const INHERITABLE_ASSIGNMENT_STATUSES = new Set<string>([
  "active",
  "pending_activation",
]);

/**
 * Whether a new session on this worktree should materialise the capability.
 *
 * A pending Assignment is inherited too: the decision was made, it simply has
 * not been proven against a runtime yet, and the next session is the first
 * opportunity to prove it.
 */
export const isInheritableAssignment = (
  record: WorktreeCapabilityRecord,
): boolean => INHERITABLE_ASSIGNMENT_STATUSES.has(record.status);

/**
 * Whether the Assignment claims the capability is currently available.
 *
 * Only a proven `active` Assignment is reported as available. A pending one is
 * still `Applying`, because `Enabled` in CONTEXT.md requires the runtime state
 * to have been verified.
 */
export const isAvailableAssignment = (
  record: WorktreeCapabilityRecord | undefined,
): boolean => record?.status === "active";

/**
 * Whether a capability still needs materialising into `materialisedRunIds`.
 *
 * Used after a worktree-level change so the sessions that were actually
 * running are reconciled, without reporting success for work that never ran.
 */
export const needsMaterialisation = (
  record: WorktreeCapabilityRecord,
  materialisedRunIds: readonly string[],
): boolean => {
  if (!isInheritableAssignment(record)) return false;
  if (record.status !== "active") return true;
  return materialisedRunIds.length === 0;
};

export const nextAssignmentStatus = (
  current: WorktreeCapabilityRecord | undefined,
  action: "assign" | "revoke",
): WorktreeCapabilityStatus =>
  action === "assign"
    ? "pending_activation"
    : current
      ? "pending_deactivation"
      : "deactivated";

/**
 * The status an Assignment settles on once its materialisation is known.
 *
 * A failure while reconciling leaves the Assignment failed rather than
 * pretending it applied, which is what lets `Recovery required` be detected
 * later by comparing the Assignment against the sessions.
 */
export const settleAssignmentStatus = (
  action: "assign" | "revoke",
  succeeded: boolean,
): WorktreeCapabilityStatus => {
  if (!succeeded) return "activation_failed";
  return action === "assign" ? "active" : "deactivated";
};
