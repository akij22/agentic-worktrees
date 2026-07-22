import { X } from "lucide-react";
import type {
  CodingAgentSessionDto,
  CodingAgentSessionUsageDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";

type Props = {
  session: CodingAgentSessionDto;
  usage?: CodingAgentSessionUsageDto;
  loading: boolean;
  error?: string;
  onClose: () => void;
};

const tokenFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const costFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </dt>
    <dd className="mt-0.5 truncate font-mono text-xs text-foreground">
      {value}
    </dd>
  </div>
);

export const SessionStatusPopup = ({
  session,
  usage,
  loading,
  error,
  onClose,
}: Props) => (
  <aside
    role="status"
    aria-live="polite"
    aria-label="OpenCode session status"
    className="absolute bottom-full right-4 z-50 mb-3 w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
  >
    <div className="flex items-start justify-between border-b border-border bg-muted/35 px-4 py-3">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em]">
          OpenCode status
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {loading ? "Reading runtime details…" : "Current session snapshot"}
        </p>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Close session status"
        onClick={onClose}
        className="-mr-1 -mt-1 size-7"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-end justify-between gap-3">
        <Detail
          label="Context used"
          value={loading || !usage ? "Loading…" : `${usage.contextPercentage.toFixed(1)}%`}
        />
        {usage ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {tokenFormat.format(usage.contextTokens)} / {tokenFormat.format(usage.contextWindow)} tokens
          </span>
        ) : null}
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${usage?.contextPercentage ?? 0}%` }}
        />
      </div>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
      <Detail
        label="Spent"
        value={loading || !usage ? "Loading…" : costFormat.format(usage.totalCost)}
      />
      <Detail
        label="Current model"
        value={`${usage?.providerId ?? session.providerId}/${usage?.modelId ?? session.modelId}`}
      />
    </dl>
    {error ? (
      <p className="border-t border-destructive/25 bg-destructive/10 px-4 py-2 text-xs text-destructive">
        {error}
      </p>
    ) : null}
  </aside>
);
