import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "./alert-dialog";
import { Badge } from "./badge";
import { Button } from "./button";

export interface Integration {
  id: string;
  name: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconBare?: boolean;
  status: "connected" | "disconnected" | "error" | "expired";
  detail?: string;
  error?: string;
  statusLabel?: string;
  lastSynced?: Date;
  scopes?: string[];
  needsReconnection?: boolean;
  configurationAction?: {
    connectedLabel: string;
    disconnectedLabel: string;
  };
}

export interface SettingsIntegrationsProps {
  integrations?: Integration[];
  title?: string;
  description?: string;
  loading?: boolean;
  emptyMessage?: string;
  onConnect?: (integrationId: string) => Promise<void>;
  onDisconnect?: (integrationId: string) => Promise<void>;
  onReauthorize?: (integrationId: string) => Promise<void>;
  className?: string;
}

function formatLastSynced(date?: Date): string {
  if (!date) return "Never";
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function SettingsIntegrations({
  integrations = [],
  title = "Integrations",
  description = "Connect and manage third-party integrations.",
  loading = false,
  emptyMessage = "No integrations are available.",
  onConnect,
  onDisconnect,
  onReauthorize,
  className,
}: SettingsIntegrationsProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  const runAction = async (id: string, action?: (id: string) => Promise<void>) => {
    setPending(id);
    setActionError(null);
    try {
      await action?.(id);
    } catch (cause) {
      setActionError({ id, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={cn("settings-group", className)} aria-busy={loading}>
      <header className="settings-group-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {loading ? (
        <div role="status" className="settings-loading">Loading coding agents…</div>
      ) : integrations.length === 0 ? (
        <p className="settings-empty">{emptyMessage}</p>
      ) : (
        <ul className="settings-rows">
          {integrations.map((integration) => {
            const isPending = pending === integration.id;
            const isConnected = integration.status === "connected";
            const needsReconnect = integration.status === "expired" || integration.needsReconnection;
            const error = actionError?.id === integration.id ? actionError.message : integration.error;
            const statusLabel = integration.statusLabel ?? {
              connected: "Connected", disconnected: "Not connected", error: "Needs attention", expired: "Expired",
            }[integration.status];
            const actionClass = "settings-row-action";
            const pendingLabel = <><Loader2 aria-hidden="true" className="settings-spinner size-3.5" />Updating…</>;

            return (
              <li className="settings-row" key={integration.id}>
                <div className="settings-row-identity">
                  {integration.icon ? (
                    <div className={cn("settings-logo", !integration.iconBare && "settings-logo-filled")}>
                      <integration.icon className="size-7 object-contain" />
                    </div>
                  ) : null}
                  <div className="settings-row-copy">
                    <h4>{integration.name}</h4>
                    <p>{integration.description}</p>
                  </div>
                </div>
                <span className="settings-status" data-status={integration.status}>
                  {isConnected ? <Check aria-hidden="true" className="size-3" /> :
                    integration.status === "error" || needsReconnect ? <AlertCircle aria-hidden="true" className="size-3" /> : null}
                  {statusLabel}
                </span>
                {integration.configurationAction ? (
                  <Button
                    className={actionClass} variant="outline" size="sm"
                    aria-label={`${isConnected ? integration.configurationAction.connectedLabel : integration.configurationAction.disconnectedLabel} for ${integration.name}`}
                    aria-busy={isPending} disabled={pending !== null}
                    onClick={() => void runAction(integration.id, isConnected ? onDisconnect : onConnect)}
                  >
                    {isPending ? pendingLabel : isConnected ? integration.configurationAction.connectedLabel : integration.configurationAction.disconnectedLabel}
                  </Button>
                ) : isConnected ? (
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button className={actionClass} variant="outline" size="sm" disabled={pending !== null} aria-busy={isPending} />}>
                      {isPending ? pendingLabel : "Disconnect"}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {integration.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Disconnect your {integration.name} account from this app. You can reconnect anytime.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void runAction(integration.id, onDisconnect)}>Disconnect</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button className={actionClass} variant="outline" size="sm" disabled={pending !== null} aria-busy={isPending}
                    onClick={() => void runAction(integration.id, needsReconnect ? onReauthorize : onConnect)}>
                    {isPending ? pendingLabel : needsReconnect ? <><RefreshCw aria-hidden="true" className="size-3.5" />Reconnect</> : "Connect"}
                  </Button>
                )}
                {integration.detail ? <code className="settings-executable" title={integration.detail}>{integration.detail}</code> : null}
                {integration.lastSynced ? <p className="settings-row-metadata">Last synced: {formatLastSynced(integration.lastSynced)}</p> : null}
                {integration.scopes?.length ? (
                  <div className="settings-row-metadata">Permissions: {integration.scopes.map((scope) => <Badge key={scope} variant="outline">{scope}</Badge>)}</div>
                ) : null}
                {error ? <p role="alert" className="settings-row-error"><AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />{error}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
