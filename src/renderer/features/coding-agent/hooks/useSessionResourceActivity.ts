import { useCallback, useEffect, useRef, useState } from "react";
import {
  resourceActivityIpcResultSchema,
  sessionResourceActivityChangedEventSchema,
  sessionResourceActivitySnapshotSchema,
  type SessionResourceActivityChangedEvent,
  type SessionResourceActivitySnapshot,
} from "../../../../shared/resource-activity/schemas";
import {
  reduceSessionResourceActivityEvent,
  type SessionResourceActivityCursor,
} from "../../../../shared/resource-activity/projection";
export function useSessionResourceActivity(runId: string) {
  const [snapshot, setSnapshot] =
    useState<SessionResourceActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true),
    [stale, setStale] = useState(true),
    [error, setError] = useState<string | null>(null);
  const controls = useRef<{ runId: string; refresh(): Promise<void> } | null>(
    null,
  );
  useEffect(() => {
    let active = true,
      cursor: SessionResourceActivityCursor | null = null,
      flight: Promise<void> | null = null,
      again = false;
    let buffered: SessionResourceActivityChangedEvent[] = [];
    setSnapshot(null);
    setLoading(true);
    setStale(true);
    setError(null);
    const refresh = (): Promise<void> => {
      if (!active) return Promise.resolve();
      if (flight) {
        again = true;
        return flight;
      }
      flight = (async () => {
        try {
          const result = resourceActivityIpcResultSchema(
            sessionResourceActivitySnapshotSchema,
          ).parse(await window.api.resourceActivity.list({ runId }));
          if (!active) return;
          if (!result.ok) {
            setStale(true);
            setError(result.error.message);
            return;
          }
          const value = result.value;
          if (
            value.runId !== runId ||
            (cursor &&
              BigInt(value.sequence) < BigInt(cursor.snapshot.sequence))
          ) {
            setStale(true);
            setError(
              "Activity updates are inconsistent. Refresh to try again.",
            );
            return;
          }
          cursor = { snapshot: value };
          let gap = false;
          const remaining: SessionResourceActivityChangedEvent[] = [];
          for (const event of buffered) {
            if (BigInt(event.sequence) <= BigInt(value.sequence)) continue;
            const reduced = reduceSessionResourceActivityEvent(cursor, event);
            if (reduced.refetch) {
              gap = true;
              remaining.push(event);
            } else cursor = reduced.state;
          }
          buffered = remaining;
          if (cursor) setSnapshot(cursor.snapshot);
          setStale(gap);
          setError(
            gap
              ? "Activity updates are incomplete. Refresh to try again."
              : null,
          );
        } catch {
          if (active) {
            setStale(true);
            setError("Session activity could not be loaded. Try again.");
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
        setStale(true);
        void refresh();
      }
    };
    const buffer = (event: SessionResourceActivityChangedEvent) => {
      if (buffered.length >= 256) buffered = [];
      buffered.push(event);
    };
    const off = window.api.resourceActivity.onChanged((raw) => {
      if (!active) return;
      const parsed = sessionResourceActivityChangedEventSchema.safeParse(raw);
      if (!parsed.success) {
        invalidate();
        return;
      }
      const event = parsed.data;
      if (event.runId !== runId) return;
      if (!cursor) {
        buffer(event);
        invalidate();
        return;
      }
      try {
        const reduced = reduceSessionResourceActivityEvent(cursor, event);
        if (reduced.refetch) {
          buffer(event);
          if (reduced.disposition === "conflict") cursor = null;
          invalidate();
          return;
        }
        cursor = reduced.state;
        if (cursor) setSnapshot(cursor.snapshot);
      } catch {
        // Retention can replace a full snapshot while a new delta arrives.
        buffer(event);
        invalidate();
      }
    }, invalidate);
    window.addEventListener("focus", invalidate);
    window.addEventListener("online", invalidate);
    controls.current = { runId, refresh };
    void refresh();
    return () => {
      active = false;
      off();
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("online", invalidate);
      if (controls.current?.runId === runId) controls.current = null;
    };
  }, [runId]);
  const refresh = useCallback(
    () =>
      controls.current?.runId === runId
        ? controls.current.refresh()
        : Promise.resolve(),
    [runId],
  );
  const current = snapshot?.runId === runId ? snapshot : null;
  return {
    snapshot: current,
    loading: loading || !current,
    stale: stale || !current,
    error,
    refresh,
  };
}
