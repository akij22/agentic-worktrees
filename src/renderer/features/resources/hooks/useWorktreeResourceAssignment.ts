import { useCallback, useEffect, useRef, useState } from "react";
import {
  assignmentChangedEventSchema,
  assignmentProjectionSchema,
  assignmentIpcResultSchema,
  type AssignmentProjectionDto,
  type AssignmentIpcResult,
  type AssignmentSetDesiredRequest,
  type AssignmentRecoverRequest,
} from "../../../../shared/assignments/schemas";
import {
  reduceAssignmentProjectionEvent,
  type AssignmentProjectionCursor,
} from "../../../../shared/assignments/projection";

const unavailable = (): AssignmentIpcResult<AssignmentProjectionDto> => ({
  ok: false,
  error: {
    code: "resource_unavailable",
    message: "Refresh worktree resources before making changes.",
    retryable: true,
  },
});
type Mutation = "setDesired" | "retry" | "cancelPending" | "recover";
type MutationInput =
  | AssignmentSetDesiredRequest["resources"]
  | AssignmentRecoverRequest["action"]
  | undefined;
export function useWorktreeResourceAssignment(
  worktreeId: string,
  agentKind: "codex" | "opencode",
) {
  const [projection, setProjection] = useState<AssignmentProjectionDto | null>(
    null,
  );
  const [loading, setLoading] = useState(true),
    [stale, setStale] = useState(true),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const controls = useRef<{
    key: string;
    refresh(): Promise<void>;
    mutate(
      name: Mutation,
      input?: MutationInput,
    ): Promise<AssignmentIpcResult<AssignmentProjectionDto>>;
  } | null>(null);
  const key = `${worktreeId}:${agentKind}`;
  useEffect(() => {
    let active = true,
      cursor: AssignmentProjectionCursor | null = null,
      flight: Promise<void> | null = null,
      again = false,
      isStale = true,
      mutating = false;
    setProjection(null);
    setLoading(true);
    setStale(true);
    setError(null);
    setPending(false);
    const markStale = () => {
      isStale = true;
      setStale(true);
    };
    const accept = (raw: unknown): boolean => {
      const parsed = assignmentProjectionSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.worktreeId !== worktreeId ||
        parsed.data.currentAgentKind !== agentKind
      )
        return false;
      const value = parsed.data;
      if (
        cursor &&
        (BigInt(value.projectionSequence) <
          BigInt(cursor.projection.projectionSequence) ||
          BigInt(value.revision) < BigInt(cursor.projection.revision))
      )
        return false;
      cursor = { eventId: "", projection: value };
      setProjection(value);
      return true;
    };
    const refresh = (): Promise<void> => {
      if (!active) return Promise.resolve();
      if (flight) {
        again = true;
        return flight;
      }
      flight = (async () => {
        try {
          const result = assignmentIpcResultSchema(
            assignmentProjectionSchema,
          ).parse(
            await window.api.resourceAssignment.get({ worktreeId, agentKind }),
          );
          if (!active) return;
          if (!result.ok || !accept(result.value)) {
            markStale();
            setError(
              result.ok
                ? "Resource updates are inconsistent. Refresh to try again."
                : result.error.message,
            );
            return;
          }
          isStale = false;
          setStale(false);
          setError(null);
        } catch {
          if (active) {
            markStale();
            setError("Worktree resources could not be loaded. Try again.");
          }
        } finally {
          if (active) setLoading(false);
        }
      })().finally(() => {
        flight = null;
        if (active && again) {
          again = false;
          void refresh();
        }
      });
      return flight;
    };
    const invalidate = () => {
      if (active) {
        markStale();
        void refresh();
      }
    };
    const off = window.api.resourceAssignment.onChanged((raw) => {
      if (!active) return;
      const parsed = assignmentChangedEventSchema.safeParse(raw);
      if (!parsed.success) {
        invalidate();
        return;
      }
      const event = parsed.data;
      if (event.worktreeId !== worktreeId) return;
      if (event.projection.currentAgentKind !== agentKind) {
        invalidate();
        return;
      }
      // A response/snapshot has no event ID; its identical subsequent event is idempotent.
      if (
        cursor?.eventId === "" &&
        cursor.projection.projectionSequence === event.projectionSequence &&
        JSON.stringify(cursor.projection) === JSON.stringify(event.projection)
      ) {
        cursor = { eventId: event.eventId, projection: event.projection };
        return;
      }
      const reduced = reduceAssignmentProjectionEvent(cursor, event);
      cursor = reduced.state;
      if (cursor) setProjection(cursor.projection);
      if (reduced.refetch) invalidate();
    }, invalidate);
    const catalogOff = window.api.marketplace?.onPackageChanged?.(invalidate);
    const skillOff = window.api.skills?.onChanged?.(invalidate);
    window.addEventListener("focus", invalidate);
    window.addEventListener("online", invalidate);
    controls.current = {
      key,
      refresh,
      async mutate(name, input) {
        if (!active || isStale || !cursor || mutating) return unavailable();
        const request = {
          worktreeId,
          expectedRevision: cursor.projection.revision,
        };
        mutating = true;
        setPending(true);
        try {
          const api = window.api.resourceAssignment;
          const raw =
            name === "setDesired"
              ? await api.setDesired({
                  ...request,
                  resources: input as AssignmentSetDesiredRequest["resources"],
                })
              : name === "recover"
                ? await api.recover({
                    ...request,
                    action: input as AssignmentRecoverRequest["action"],
                  })
                : await api[name](request);
          const result = assignmentIpcResultSchema(
            assignmentProjectionSchema,
          ).parse(raw);
          if (!active) return unavailable();
          if (result.ok) {
            if (!accept(result.value)) invalidate();
          } else {
            setError(result.error.message);
            if (result.error.current) {
              if (!accept(result.error.current)) invalidate();
            } else if (result.error.code === "assignment_conflict")
              invalidate();
          }
          return result;
        } catch {
          if (active) invalidate();
          return unavailable();
        } finally {
          mutating = false;
          if (active) setPending(false);
        }
      },
    };
    void refresh();
    return () => {
      active = false;
      off();
      catalogOff?.();
      skillOff?.();
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("online", invalidate);
      if (controls.current?.key === key) controls.current = null;
    };
  }, [worktreeId, agentKind, key]);
  const refresh = useCallback(
    () =>
      controls.current?.key === key
        ? controls.current.refresh()
        : Promise.resolve(),
    [key],
  );
  const mutate = useCallback(
    (name: Mutation, input?: MutationInput) =>
      controls.current?.key === key
        ? controls.current.mutate(name, input)
        : Promise.resolve(unavailable()),
    [key],
  );
  const current =
    projection?.worktreeId === worktreeId &&
    projection.currentAgentKind === agentKind
      ? projection
      : null;
  return {
    projection: current,
    loading: loading || !current,
    stale: stale || !current,
    error,
    pending,
    refresh,
    setDesired: (resources: AssignmentSetDesiredRequest["resources"]) =>
      mutate("setDesired", resources),
    retry: () => mutate("retry"),
    cancelPending: () => mutate("cancelPending"),
    recover: (action: AssignmentRecoverRequest["action"]) =>
      mutate("recover", action),
  };
}
