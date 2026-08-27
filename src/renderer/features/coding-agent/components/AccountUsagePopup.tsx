import { Gauge, X } from "lucide-react";
import type {
  CodingAgentAccountUsageDto,
  CodingAgentSessionDto,
  CodingAgentSessionUsageDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";

type Props = {
  session: CodingAgentSessionDto;
  accountUsage?: CodingAgentAccountUsageDto;
  sessionUsage?: CodingAgentSessionUsageDto;
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

const formatWindow = (durationMinutes: number | null): string => {
  if (durationMinutes === null) return "Usage window";
  if (durationMinutes % 1_440 === 0)
    return `${durationMinutes / 1_440}d window`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60}h window`;
  return `${durationMinutes}m window`;
};

const formatReset = (resetsAt: number | null): string =>
  resetsAt === null
    ? "Reset time unavailable"
    : `Resets ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(resetsAt)}`;

export const AccountUsagePopup = ({
  session,
  accountUsage,
  sessionUsage,
  loading,
  error,
  onClose,
}: Props) => (
  <aside
    role="status"
    aria-live="polite"
    aria-label={`${session.agentName} account usage`}
    className="absolute bottom-full right-4 z-50 mb-3 w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border border-white/[0.075] bg-popover/95 shadow-2xl backdrop-blur-xl"
  >
    <div className="flex items-start justify-between bg-muted/35 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Gauge className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em]">
            Remaining account usage
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading
              ? "Reading account limits…"
              : `${session.agentName} account snapshot`}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Close account usage"
        onClick={onClose}
        className="-mr-1 -mt-1 size-7"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>

    {accountUsage?.availability === "available" ? (
      <div className="space-y-3 px-4 py-3">
        {accountUsage.planType ? (
          <p className="text-xs text-muted-foreground">
            {accountUsage.planType[0]?.toUpperCase()}
            {accountUsage.planType.slice(1)} plan
          </p>
        ) : null}
        {accountUsage.windows.map((window, index) => (
          <div key={`${window.durationMinutes ?? "unknown"}-${index}`}>
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {formatWindow(window.durationMinutes)}
              </span>
              <span className="font-mono text-xs font-semibold text-foreground">
                {window.remainingPercentage.toFixed(0)}% remaining
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${window.remainingPercentage}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatReset(window.resetsAt)}
            </p>
          </div>
        ))}
      </div>
    ) : (
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-foreground">
          Account quota unavailable
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {accountUsage?.message ?? "Account quota could not be read."}
        </p>
      </div>
    )}

    {sessionUsage ? (
      <div className="border-t border-white/[0.07] px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Session context
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="font-mono text-foreground">
            {sessionUsage.contextPercentage.toFixed(1)}%
          </span>
          <span className="font-mono text-muted-foreground">
            {tokenFormat.format(sessionUsage.contextTokens)} /{" "}
            {tokenFormat.format(sessionUsage.contextWindow)} tokens
            {sessionUsage.totalCost === undefined
              ? ""
              : ` · ${costFormat.format(sessionUsage.totalCost)}`}
          </span>
        </div>
      </div>
    ) : null}

    {error ? (
      <p className="m-2 rounded-xl bg-error-surface px-4 py-2 text-xs text-error-foreground">
        {error}
      </p>
    ) : null}
  </aside>
);
