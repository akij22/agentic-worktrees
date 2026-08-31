import {
  ArrowUpRight,
  Check,
  KeyRound,
  Network,
  PackageCheck,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { capabilityNetworkPermissionLabel } from "../lib/capability-form";

const format = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const stateTone: Record<CapabilityDetailDto["state"], string> = {
  active: "border-chart-3/30 bg-chart-3/10 text-chart-3",
  activation_failed: "border-error/30 bg-error-surface text-error-foreground",
  available: "border-border bg-muted text-muted-foreground",
  inactive: "border-warning/30 bg-warning-surface text-warning-foreground",
  needs_setup: "border-warning/30 bg-warning-surface text-warning-foreground",
  pending_activation:
    "border-warning/30 bg-warning-surface text-warning-foreground",
  pending_deactivation:
    "border-warning/30 bg-warning-surface text-warning-foreground",
  ready: "border-primary/30 bg-primary/10 text-primary",
  reloading: "border-primary/30 bg-primary/10 text-primary",
  unavailable: "border-error/30 bg-error-surface text-error-foreground",
};

function DataLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-xs leading-5 text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function CapabilityDetail({
  capability,
  runId,
  onConfigure,
  onActivate,
  onDeactivate,
}: {
  capability: CapabilityDetailDto;
  runId?: string;
  onConfigure(): void;
  onActivate?(): void;
  onDeactivate?(): void;
}) {
  const canActivate = ["ready", "inactive", "activation_failed"].includes(
    capability.state,
  );

  return (
    <section
      aria-label={`${capability.name} details`}
      className="h-full min-w-0 overflow-auto"
    >
      <div className="grid min-w-0 gap-6 border-b border-border px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{format(capability.category)}</Badge>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateTone[capability.state]}`}
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-current"
              />
              {format(capability.state)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              v{capability.version}
            </span>
          </div>
          <h3 className="mt-4 min-w-0 [overflow-wrap:anywhere] text-[clamp(1.75rem,3vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.045em] text-foreground">
            {capability.name}
          </h3>
          <p className="mt-3 max-w-[65ch] text-sm leading-6 text-muted-foreground">
            {capability.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <Button
            variant="outline"
            onClick={onConfigure}
            className="h-11 motion-reduce:transform-none motion-reduce:transition-none"
          >
            Configure
          </Button>
          {runId && capability.state === "active" && onDeactivate ? (
            <Button
              variant="destructive"
              onClick={onDeactivate}
              className="h-11 motion-reduce:transform-none motion-reduce:transition-none"
            >
              Remove from chat
            </Button>
          ) : null}
          {runId && canActivate && onActivate ? (
            <Button
              onClick={onActivate}
              className="h-11 motion-reduce:transform-none motion-reduce:transition-none"
            >
              {capability.state === "activation_failed"
                ? "Retry"
                : "Add to chat"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div className="min-w-0 border-b border-border px-4 py-6 sm:px-6 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between gap-4">
            <h4 className="flex items-center gap-2 text-sm font-bold tracking-[-0.015em]">
              <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
              Permission ledger
            </h4>
            <span className="inline-flex items-center gap-2 text-[10px] text-chart-3">
              <Check aria-hidden="true" className="size-3" />
              Reviewed
            </span>
          </div>
          <p className="mt-2 max-w-[58ch] text-xs leading-5 text-muted-foreground">
            Resources this capability can reach after configuration.
          </p>

          <dl className="mt-5 border-y border-border">
            <DataLine label="Network access">
              <span className="flex flex-wrap gap-2">
                {capability.permissions.network.length
                  ? capability.permissions.network.map((item) => (
                      <code
                        key={item}
                        className="rounded bg-code-background px-2 py-0.5 font-mono text-[11px] text-code-foreground"
                      >
                        {capabilityNetworkPermissionLabel(item)}
                      </code>
                    ))
                  : "None"}
              </span>
            </DataLine>
            <DataLine label="Optional secrets">
              <span className="flex flex-wrap gap-2">
                {capability.permissions.secrets.length
                  ? capability.permissions.secrets.map((item) => (
                      <code
                        key={item}
                        className="rounded bg-code-background px-2 py-0.5 font-mono text-[11px] text-code-foreground"
                      >
                        {item}
                      </code>
                    ))
                  : "None"}
              </span>
            </DataLine>
            <DataLine label="Provided tools">
              <span className="flex flex-wrap gap-2">
                {capability.providedTools.map((item) => (
                  <code
                    key={item}
                    className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
                  >
                    {item}
                  </code>
                ))}
              </span>
            </DataLine>
          </dl>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Network
                aria-hidden="true"
                className="size-3.5 text-foreground"
              />
              Scoped network
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <KeyRound
                aria-hidden="true"
                className="size-3.5 text-foreground"
              />
              Optional secrets
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TerminalSquare
                aria-hidden="true"
                className="size-3.5 text-foreground"
              />
              Named tools
            </div>
          </div>
        </div>

        <div className="min-w-0 bg-card/30 px-4 py-6 sm:px-6">
          <h4 className="flex items-center gap-2 text-sm font-bold tracking-[-0.015em]">
            <PackageCheck aria-hidden="true" className="size-4 text-primary" />
            Compatibility & source
          </h4>
          <dl className="mt-5 border-y border-border">
            <DataLine label="Codex">
              {format(capability.compatibility.codex)}
            </DataLine>
            <DataLine label="OpenCode">
              {format(capability.compatibility.opencode)}
            </DataLine>
            <DataLine label="Publisher">{capability.author.name}</DataLine>
            <DataLine label="Package">
              {capability.provenance
                ? `${capability.provenance.package} ${capability.provenance.sourceVersion}`
                : "Not provided"}
            </DataLine>
            <DataLine label="License">{capability.license}</DataLine>
            <DataLine label="Review">
              {format(capability.reviewStatus)}
            </DataLine>
          </dl>
          {capability.provenance ? (
            <a
              className="mt-5 inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px motion-reduce:transform-none"
              href={capability.provenance.repository}
              target="_blank"
              rel="noreferrer"
            >
              Open source repository
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
