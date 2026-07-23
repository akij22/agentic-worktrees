import { Check, ShieldAlert, Terminal, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { PendingPermission } from "../types";

type Props = {
  agentName: string;
  permission: PendingPermission;
  onRespond: (response: "once" | "always" | "reject") => void;
};

const readString = (
  metadata: Record<string, unknown>,
  key: string,
): string | null =>
  typeof metadata[key] === "string" && metadata[key].trim()
    ? metadata[key]
    : null;

export const CommandApprovalCard = ({
  agentName,
  permission,
  onRespond,
}: Props) => {
  const command = readString(permission.metadata, "command");
  const cwd = readString(permission.metadata, "cwd");

  return (
    <section
      aria-label="Command approval required"
      className="overflow-hidden rounded-xl border border-amber-500/45 bg-amber-500/[0.07] shadow-sm"
    >
      <div className="flex items-start gap-3 border-b border-amber-500/25 bg-amber-500/[0.08] px-4 py-3">
        <div className="mt-0.5 rounded-md bg-amber-500/15 p-1.5 text-amber-700 dark:text-amber-300">
          <ShieldAlert aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Command approval required</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {agentName} is waiting for your decision before continuing.
          </p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <p className="text-sm font-medium">{permission.title}</p>
        {command ? (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Command to run
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 font-mono text-xs leading-5">
              <Terminal aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <code className="min-w-0 break-all text-foreground">{command}</code>
            </div>
          </div>
        ) : null}
        {cwd ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={cwd}>
            in {cwd}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/20 bg-background/35 px-4 py-3">
        <Button size="sm" onClick={() => onRespond("once")}>
          <Check aria-hidden="true" />
          Allow once
        </Button>
        <Button size="sm" variant="outline" onClick={() => onRespond("always")}>
          Always allow
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onRespond("reject")}>
          <X aria-hidden="true" />
          Deny
        </Button>
      </div>
    </section>
  );
};
