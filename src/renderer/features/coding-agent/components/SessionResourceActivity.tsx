import type { SessionResourceActivityItem } from "../../../../shared/resource-activity/schemas";
import { Button } from "../../../components/ui/button";
import { useSessionResourceActivity } from "../hooks/useSessionResourceActivity";

function activityLabel(item: SessionResourceActivityItem) {
  const kind = item.resourceKind === "skill" ? "Skill" : "Capability";
  if (item.coverage === "legacy_unverified")
    return "Legacy request · Use not verified";
  if (
    item.useState === "confirmed" &&
    ["qualified", "evidence_gap"].includes(item.coverage)
  ) {
    const suffix =
      item.outcome === "reported_error" || item.outcome === "thrown"
        ? " · Failed"
        : item.outcome === "timeout"
          ? " · Timed out"
          : item.outcome === "cancelled"
            ? " · Cancelled"
            : item.lifecycle === "terminal" && item.outcome === "not_observed"
              ? " · Outcome not verified"
              : "";
    const automatic =
      item.resourceKind === "skill" &&
      item.mode === "automatic" &&
      item.coverage === "qualified";
    return `${kind} used${automatic ? " automatically" : ""}${suffix}`;
  }
  if (item.outcome === "permission_denied" || item.outcome === "rejected")
    return item.resourceKind === "skill"
      ? "Skill not loaded"
      : "Capability request denied";
  if (item.lifecycle === "terminal" && item.outcome !== "not_observed")
    return item.resourceKind === "skill"
      ? "Skill not loaded"
      : "Capability request failed";
  return `${kind} requested${item.coverage !== "qualified" ? " · Use not verified" : ""}`;
}
export function SessionResourceActivity({ runId }: { runId: string }) {
  const activity = useSessionResourceActivity(runId);
  const items = [...(activity.snapshot?.items ?? [])].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  return (
    <section
      aria-label="Resource activity"
      aria-busy={activity.loading}
      className="space-y-2"
    >
      {!activity.snapshot && !activity.error ? (
        <p className="text-xs text-muted-foreground">
          Loading resource activity…
        </p>
      ) : null}
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs"
        >
          <p className="font-medium">{activityLabel(item)}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {item.resourceId} · {item.resourceVersion}
          </p>
          <time dateTime={item.occurredAt} className="sr-only">
            {item.occurredAt}
          </time>
        </div>
      ))}
      {activity.stale && activity.snapshot ? (
        <p className="text-xs text-muted-foreground">
          Resource activity may be out of date.
        </p>
      ) : null}
      {activity.error ? (
        <div>
          <p role="alert" className="text-xs text-destructive-foreground">
            {activity.error}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void activity.refresh()}
          >
            Retry resource activity
          </Button>
        </div>
      ) : null}
    </section>
  );
}
