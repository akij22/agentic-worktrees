import type { ResourceAssignmentItemDto } from "../../../../shared/assignments/schemas";
import { Button } from "../../../components/ui/button";
const statusLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const reasons = {
  setup_required: "Setup required before assignment.",
  consent_required: "Consent required before assignment.",
  provider_incompatible: "Unavailable for this provider.",
  provider_unqualified: "Provider qualification unavailable.",
  installation_invalid: "Installation must be repaired in Marketplace.",
};

export function ResourceAssignmentRow({
  item,
  id,
  pending,
  disabled,
  codex,
  setRowRef,
  onToggle,
  openMarketplace,
}: {
  item: ResourceAssignmentItemDto;
  id: string;
  pending: boolean;
  disabled: boolean;
  codex: boolean;
  setRowRef: (node: HTMLInputElement | null) => void;
  onToggle: () => void;
  openMarketplace?: (
    resource: Pick<ResourceAssignmentItemDto, "kind" | "id">,
  ) => void;
}) {
  return (
    <div className="border-b border-border/50 py-2">
      <label className="flex items-start gap-2 text-xs">
        <input
          ref={(node) => {
            if (node) setRowRef(node);
            else setRowRef(null);
          }}
          type="checkbox"
          checked={item.desired}
          onChange={onToggle}
          disabled={pending || disabled || (!item.desired && !item.assignable)}
          aria-busy={pending}
          aria-describedby={`${id}-${item.kind}-${item.id}`}
          className="mt-0.5 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
        />
        <span className="font-medium">{item.name}</span>
      </label>
      <div id={`${id}-${item.kind}-${item.id}`}>
        <p className="ml-5 mt-1 text-[11px] text-muted-foreground">
          {statusLabel(item.kind)} · {item.version} ·{" "}
          <span>{statusLabel(item.status)}</span>
          {pending ? " · Saving…" : ""}
        </p>
        {item.unavailableReason ? (
          <p className="ml-5 mt-1 text-[11px] text-muted-foreground">
            {reasons[item.unavailableReason]}
          </p>
        ) : null}
        {item.kind === "skill" && codex ? (
          <div className="ml-5 mt-1 text-[11px] text-muted-foreground">
            <p>Isolation not enforced</p>
            <p>
              Codex may access other Skills outside this worktree Assignment.
            </p>
          </div>
        ) : null}
        {item.kind === "skill" && item.automaticUsageReporting === "unknown" ? (
          <p className="ml-5 mt-1 text-[11px] text-muted-foreground">
            Automatic use cannot be confirmed for this provider.
          </p>
        ) : null}
      </div>
      {item.unavailableReason &&
      ["setup_required", "consent_required", "installation_invalid"].includes(
        item.unavailableReason,
      ) &&
      openMarketplace ? (
        <Button
          size="sm"
          variant="ghost"
          className="ml-4 underline"
          aria-label={`${item.unavailableReason === "consent_required" ? "Review consent for" : "Configure"} ${item.name} in Marketplace`}
          onClick={() => {
            openMarketplace({ kind: item.kind, id: item.id });
          }}
        >
          {item.unavailableReason === "consent_required"
            ? "Review consent"
            : "Configure in Marketplace"}
        </Button>
      ) : null}
    </div>
  );
}
