import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorktreeCapabilityStateDto } from "../../../../shared/ipc/schemas";

export type CapabilityRow = {
  capabilityId: string;
  name: string;
  description: string;
  /** The Assignment's state, or undefined when the worktree has none. */
  assignment: WorktreeCapabilityStateDto | undefined;
  installationState: string;
  available: boolean;
  busy: boolean;
};

const ASSIGNED_STATES = new Set(["active", "pending_activation"]);

export const useWorktreeCapabilities = (worktreeId: string | undefined) => {
  const [assignments, setAssignments] = useState<WorktreeCapabilityStateDto[]>(
    [],
  );
  const [library, setLibrary] = useState<
    { id: string; name: string; description: string; installationState: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const worktreeIdRef = useRef(worktreeId);
  worktreeIdRef.current = worktreeId;

  const refresh = useCallback(async () => {
    if (!worktreeId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    const requested = worktreeId;
    try {
      const [nextAssignments, nextLibrary] = await Promise.all([
        window.api.capabilities.listWorktree({ worktreeId: requested }),
        window.api.capabilities.list(),
      ]);
      if (worktreeIdRef.current !== requested) return;
      setAssignments(nextAssignments);
      setLibrary(
        nextLibrary.map((entry) => ({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          installationState: entry.installationState,
        })),
      );
      setError(undefined);
    } catch (cause) {
      if (worktreeIdRef.current !== requested) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the capabilities for this worktree.",
      );
    } finally {
      if (worktreeIdRef.current === requested) setLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => {
    setLoading(true);
    setPendingIds(new Set());
    void refresh();
    const unsubscribe = window.api.capabilities.onChanged((event) => {
      if (event.scope === "worktree" && event.worktreeId === worktreeIdRef.current) {
        void refresh();
      }
    });
    return () => unsubscribe();
  }, [refresh]);

  const rows = useMemo<CapabilityRow[]>(() => {
    const byId = new Map(assignments.map((item) => [item.capabilityId, item]));
    const merged = library.map((entry) => {
      const assignment = byId.get(entry.id);
      return {
        capabilityId: entry.id,
        name: assignment?.name ?? entry.name,
        description: entry.description,
        assignment,
        installationState: entry.installationState,
        available: entry.installationState === "installed",
        busy: pendingIds.has(entry.id),
      } satisfies CapabilityRow;
    });
    // An Assignment whose capability was uninstalled stays visible: the
    // decision exists even when the thing it points at does not.
    for (const assignment of assignments) {
      if (library.some((entry) => entry.id === assignment.capabilityId)) continue;
      merged.push({
        capabilityId: assignment.capabilityId,
        name: assignment.name,
        description: "",
        assignment,
        installationState: "unavailable",
        available: false,
        busy: pendingIds.has(assignment.capabilityId),
      });
    }
    return merged;
  }, [assignments, library, pendingIds]);

  const activeCount = useMemo(
    () => rows.filter((row) => row.assignment?.state === "active").length,
    [rows],
  );

  const toggle = useCallback(
    async (capabilityId: string) => {
      if (!worktreeId) return;
      setPendingIds((current) => new Set(current).add(capabilityId));
      setError(undefined);
      try {
        const assigned = ASSIGNED_STATES.has(
          assignments.find((item) => item.capabilityId === capabilityId)?.state ??
            "",
        );
        if (assigned) {
          await window.api.capabilities.revokeWorktree({
            worktreeId,
            capabilityId,
          });
        } else {
          await window.api.capabilities.assignWorktree({
            worktreeId,
            capabilityId,
          });
        }
        await refresh();
      } catch (cause) {
        // Refresh first: a successful refresh clears the error, and the
        // reason the change was rejected has to survive that.
        await refresh();
        setError(
          cause instanceof Error
            ? cause.message
            : "The capability could not be changed for this worktree.",
        );
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(capabilityId);
          return next;
        });
      }
    },
    [assignments, refresh, worktreeId],
  );

  return { rows, activeCount, loading, error, toggle, refresh };
};
