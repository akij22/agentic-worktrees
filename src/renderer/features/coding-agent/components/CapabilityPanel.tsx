import { Wrench, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import {
  useWorktreeCapabilities,
  type CapabilityRow,
} from "../hooks/useWorktreeCapabilities";

type Props = {
  context: CodingAgentWorktreeContextDto | undefined;
  onClose: () => void;
};

const STATE_PRESENTATION: Record<
  string,
  { label: string; className: string }
> = {
  active: { label: "Enabled", className: "text-emerald-400" },
  pending_activation: { label: "Applying", className: "text-amber-400" },
  pending_deactivation: { label: "Removing", className: "text-amber-400" },
  activation_failed: { label: "Failed", className: "text-destructive" },
  deactivated: { label: "Not assigned", className: "text-muted-foreground" },
};

const ASSIGNMENT_PRESENTATION: Record<string, string> = {
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  pending_activation: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  pending_deactivation: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  activation_failed: "border-destructive/30 bg-destructive/10 text-error-foreground",
  deactivated: "border-border bg-muted/40 text-muted-foreground",
};

const assignedStates = new Set(["active", "pending_activation"]);

const CapabilityRowView = ({
  row,
  onToggle,
}: {
  row: CapabilityRow;
  onToggle: (capabilityId: string) => void;
}) => {
  const state = row.assignment?.state;
  const presentation = state
    ? (STATE_PRESENTATION[state] ?? STATE_PRESENTATION.deactivated)
    : undefined;
  const assigned = state ? assignedStates.has(state) : false;

  return (
    <li className="flex items-start gap-3 border-b border-border/50 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {row.name}
        </p>
        {row.description ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {row.description}
          </p>
        ) : null}
        {!row.available && !assigned ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Not configured for this installation.
          </p>
        ) : null}
      </div>
      {presentation && state ? (
        <span
          className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] ${
            ASSIGNMENT_PRESENTATION[state] ??
            ASSIGNMENT_PRESENTATION.deactivated
          }`}
        >
          {presentation.label}
        </span>
      ) : (
        <span
          className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] ${
            row.available
              ? "border-border bg-muted/40 text-muted-foreground"
              : "border-border bg-muted/20 text-muted-foreground/60"
          }`}
        >
          {row.available ? "Installed" : "Not configured"}
        </span>
      )}
      <button
        type="button"
        onClick={() => onToggle(row.capabilityId)}
        disabled={row.busy || (!assigned && !row.available)}
        className="shrink-0 rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {row.busy ? "Working…" : assigned ? "Remove" : "Assign"}
      </button>
    </li>
  );
};

/**
 * The Assignment for the selected worktree. Rises under the composer rather
 * than navigating away, so the draft the user is writing survives.
 *
 * The vocabulary is the one in CONTEXT.md: an Assignment is made for a
 * Worktree, and only a verified one reads as Enabled.
 */
export const CapabilityPanel = ({ context, onClose }: Props) => {
  const { rows, loading, error, toggle } = useWorktreeCapabilities(
    context?.worktree.id,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Capabilities for this worktree"
      className="mt-2 w-full max-w-[40rem] overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Wrench aria-hidden="true" className="size-3.5 text-primary" />
        <h2 className="text-[13px] font-semibold text-foreground">Capabilities</h2>
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
          {context
            ? `${context.repository.name} · ${context.worktree.name}`
            : "No worktree selected"}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close capabilities"
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <p className="px-3 pt-2.5 text-[11px] leading-5 text-muted-foreground">
        An assignment applies to this worktree. Every new thread here starts
        with it.
      </p>

      {error ? (
        <p role="alert" className="mx-3 mt-2 rounded-lg bg-error-surface px-3 py-2 text-[11px] text-error-foreground">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="px-3 py-4 text-[12px] text-muted-foreground">
          Loading capabilities…
        </p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-muted-foreground">
          No capabilities are installed for this installation.
        </p>
      ) : (
        <ul className="mt-1 px-3 pb-2">
          {rows.map((row) => (
            <CapabilityRowView
              key={row.capabilityId}
              row={row}
              onToggle={(id) => void toggle(id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
