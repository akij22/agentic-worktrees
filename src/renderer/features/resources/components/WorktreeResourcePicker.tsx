import { Popover } from "@base-ui/react/popover";
import { Blocks, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ResourceAssignmentItemDto } from "../../../../shared/assignments/schemas";
import { ResourceAssignmentRow } from "./ResourceAssignmentRow";
import { Button } from "../../../components/ui/button";
import type { useWorktreeResourceAssignment } from "../hooks/useWorktreeResourceAssignment";

export type WorktreeAssignmentState = ReturnType<
  typeof useWorktreeResourceAssignment
>;
const itemKey = (item: ResourceAssignmentItemDto) => `${item.kind}:${item.id}`;
const statusLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
export type MarketplaceResourceTarget = Pick<
  ResourceAssignmentItemDto,
  "kind" | "id"
>;

export function WorktreeResourcePicker({
  assignment,
  onStopSession,
  onOpenMarketplace,
  announceStatus = true,
}: {
  assignment: WorktreeAssignmentState;
  announceStatus?: boolean;
  onStopSession?: (runId: string) => Promise<void> | void;
  onOpenMarketplace?: (resource?: MarketplaceResourceTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [conflict, setConflict] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLInputElement>());
  const groupRef = useRef<HTMLHeadingElement>(null);
  const focusAfterMutation = useRef<{ key: string; version: string } | null>(
    null,
  );
  const id = useId();
  const projection = assignment.projection;
  const enabled =
    projection?.resources.filter(
      (item) => item.desired && item.verified && item.status === "enabled",
    ).length ?? 0;
  const state = !projection
    ? assignment.error
      ? "Unavailable"
      : "Loading…"
    : projection.phase === "stable"
      ? `${enabled} enabled`
      : projection.phase === "waiting_for_idle"
        ? "Waiting…"
        : projection.phase === "failed_rolled_back"
          ? "Failed"
          : statusLabel(projection.phase);
  const locked =
    assignment.stale ||
    projection?.phase === "recovery_required" ||
    projection?.phase === "removing" ||
    projection?.phase === "reconciling";
  const status =
    projection?.phase === "waiting_for_idle"
      ? "Waiting for active sessions before applying resource changes."
      : projection?.progress
        ? `${statusLabel(projection.progress.step)}${projection.progress.total ? ` · ${projection.progress.completed} of ${projection.progress.total}` : ""}`
        : projection && projection.phase !== "stable"
          ? state
          : "";
  const [actionError, setActionError] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (pendingRow || !focusAfterMutation.current) return;
    const target = focusAfterMutation.current;
    const unchanged = projection?.resources.some(
      (item) => itemKey(item) === target.key && item.version === target.version,
    );
    const row = unchanged ? rowRefs.current.get(target.key) : undefined;
    (row ?? groupRef.current)?.focus();
    if (!row)
      setActionError("The resource changed. Review the latest selection.");
    focusAfterMutation.current = null;
  }, [pendingRow, projection]);
  const toggle = async (item: ResourceAssignmentItemDto) => {
    if (assignment.pending || assignment.stale) return;
    setPendingRow(itemKey(item));
    setConflict(false);
    if (document.activeElement === rowRefs.current.get(itemKey(item)))
      focusAfterMutation.current = {
        key: itemKey(item),
        version: item.version,
      };
    try {
      const selected =
        projection?.resources.filter(
          (resource) => resource.desired && itemKey(resource) !== itemKey(item),
        ) ?? [];
      if (!item.desired) selected.push(item);
      const result = await assignment.setDesired(
        selected.map(({ kind, id, version }) => ({ kind, id, version })),
      );
      setConflict(!result.ok && result.error.code === "assignment_conflict");
    } finally {
      setPendingRow(null);
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="session-composer__picker"
          />
        }
        aria-label={`Resources, ${state}`}
      >
        <Blocks className="size-3.5" aria-hidden="true" /> Resources{" "}
        <span className="text-muted-foreground">{state}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50"
        >
          <Popover.Popup
            className="w-[min(26rem,calc(100vw-2rem))] max-h-[min(36rem,80vh)] overflow-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-busy={assignment.loading && !assignment.error}
          >
            <div className="flex items-center justify-between gap-2">
              <Popover.Title className="text-sm font-semibold">
                Resources for this worktree
              </Popover.Title>
              <Popover.Close
                render={
                  <Button variant="ghost" size="icon" className="size-7" />
                }
                aria-label="Close resources"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Popover.Close>
            </div>
            <Popover.Description className="mb-3 text-xs text-muted-foreground">
              Changes apply to every session in this worktree.
            </Popover.Description>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Removing an assignment preserves past activity.
            </p>
            {projection && projection.resources.length > 8 ? (
              <label className="mb-2 block text-xs">
                Search resources
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            ) : null}
            {conflict ? (
              <p
                role="alert"
                className="mt-2 text-xs text-destructive-foreground"
              >
                Resources changed in another window. Review the latest selection
                and try again.
              </p>
            ) : null}
            <p
              role={announceStatus ? "status" : undefined}
              aria-live={announceStatus ? "polite" : "off"}
              className="text-xs text-muted-foreground"
            >
              {status}
            </p>
            {projection?.phase === "failed_rolled_back" ? (
              <p
                key={`failure-${projection.revision}`}
                role={announceStatus ? "alert" : undefined}
                className="mt-2 text-xs text-destructive-foreground"
              >
                Resource changes failed. Your previous verified setup is still
                active.
              </p>
            ) : null}
            {projection?.phase === "recovery_required" ? (
              <p
                key={`recovery-${projection.revision}`}
                role={announceStatus ? "alert" : undefined}
                className="mt-2 text-xs text-destructive-foreground"
              >
                Resource state could not be verified. Agent actions are paused
                for this worktree. Conversation and history are preserved.
              </p>
            ) : null}
            {projection?.phase === "removing" ? (
              <p className="text-xs">This worktree is being removed.</p>
            ) : null}
            {projection?.phase === "applying" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Queued after current change.
              </p>
            ) : null}
            {actionError ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {actionError}
              </p>
            ) : null}
            {assignment.error && !conflict ? (
              <p
                role="alert"
                className="mt-2 text-xs text-destructive-foreground"
              >
                {assignment.error}
              </p>
            ) : null}
            {assignment.stale && !assignment.loading ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Resource information is stale. Refresh before sending or making
                changes.
              </p>
            ) : null}
            {assignment.stale && assignment.error ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void assignment.refresh()}
              >
                Retry loading resources
              </Button>
            ) : null}
            {!projection ? (
              <p className="text-xs">
                {assignment.error
                  ? "Resources unavailable."
                  : "Loading worktree resources…"}
              </p>
            ) : (
              <>
                {!projection.resources.length ? (
                  <div className="py-3 text-xs">
                    <p>
                      No resources installed. Install resources in Marketplace.
                    </p>
                    {onOpenMarketplace ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => onOpenMarketplace()}
                      >
                        Open Marketplace
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {([true, false] as const).map((assigned) => (
                  <section
                    key={String(assigned)}
                    className="mt-3"
                    aria-labelledby={`${id}-${assigned}`}
                  >
                    <h3
                      ref={assigned ? groupRef : undefined}
                      id={`${id}-${assigned}`}
                      tabIndex={-1}
                      className="border-b border-border pb-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {assigned ? "Assigned" : "Available"}
                    </h3>
                    {projection.resources
                      .filter(
                        (item) =>
                          item.desired === assigned &&
                          `${item.name} ${item.id} ${item.kind}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((item) => (
                        <ResourceAssignmentRow
                          key={itemKey(item)}
                          item={item}
                          id={id}
                          pending={pendingRow === itemKey(item)}
                          disabled={locked}
                          codex={projection.currentAgentKind === "codex"}
                          setRowRef={(node) => {
                            if (node) rowRefs.current.set(itemKey(item), node);
                            else rowRefs.current.delete(itemKey(item));
                          }}
                          onToggle={() => void toggle(item)}
                          openMarketplace={
                            onOpenMarketplace
                              ? (resource) => {
                                  try {
                                    onOpenMarketplace(resource);
                                  } catch {
                                    setActionError(
                                      "Marketplace could not be opened. Try again.",
                                    );
                                  }
                                }
                              : undefined
                          }
                        />
                      ))}
                  </section>
                ))}
                {projection.phase === "waiting_for_idle" ? (
                  <ul className="mt-3 space-y-2 text-xs">
                    <li>
                      {projection.blockers.length} blocking{" "}
                      {projection.blockers.length === 1
                        ? "session"
                        : "sessions"}
                    </li>
                    {projection.blockers.map((blocker, index) => (
                      <li
                        key={`${blocker.sessionRunId}-${index}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>
                          {blocker.sessionTitle ?? statusLabel(blocker.kind)}
                        </span>
                        {blocker.canStop &&
                        blocker.sessionRunId &&
                        onStopSession ? (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Stop agent: ${blocker.sessionTitle ?? blocker.sessionRunId}`}
                            onClick={() => {
                              setActionError(null);
                              void Promise.resolve()
                                .then(() =>
                                  blocker.sessionRunId
                                    ? onStopSession(blocker.sessionRunId)
                                    : undefined,
                                )
                                .catch(() =>
                                  setActionError(
                                    "Could not stop the agent. Try again.",
                                  ),
                                );
                            }}
                          >
                            Stop agent
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {projection.phase === "waiting_for_idle" &&
                projection.allowedActions.includes("cancel_pending") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={assignment.pending || assignment.stale}
                    onClick={() => void assignment.cancelPending()}
                  >
                    Cancel change
                  </Button>
                ) : null}
                {projection.phase === "failed_rolled_back" ? (
                  <div className="mt-3 flex gap-2">
                    {projection.allowedActions.includes("retry") ? (
                      <Button
                        size="sm"
                        disabled={assignment.pending || locked}
                        onClick={() => void assignment.retry()}
                      >
                        Retry changes
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={assignment.pending || locked}
                      onClick={() =>
                        void assignment.setDesired(
                          projection.resources
                            .filter((item) => item.verified)
                            .map(({ kind, id, version }) => ({
                              kind,
                              id,
                              version,
                            })),
                        )
                      }
                    >
                      Discard changes
                    </Button>
                  </div>
                ) : null}
                {projection.phase === "recovery_required" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {projection.allowedActions
                      .filter(
                        (action) =>
                          action !== "retry" && action !== "cancel_pending",
                      )
                      .map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="outline"
                          disabled={assignment.pending || assignment.stale}
                          onClick={() => void assignment.recover(action)}
                        >
                          {action === "retry_recovery"
                            ? "Retry recovery"
                            : action === "recreate_affected_runtimes"
                              ? "Recreate affected runtime"
                              : "Revert desired changes"}
                        </Button>
                      ))}
                  </div>
                ) : null}
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
