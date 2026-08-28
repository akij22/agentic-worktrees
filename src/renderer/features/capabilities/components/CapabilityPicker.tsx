import { Blocks } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { CapabilityDetailDto, CapabilitySummaryDto } from "../../../../shared/ipc/schemas";
import { PickerMenu } from "../../coding-agent/components/PickerMenu";
import { CapabilitySetupDialog } from "./CapabilitySetupDialog";

const label = (state: string) => state.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export function CapabilityPicker({ runId, capabilities, disabled, onActivate, onDeactivate }: { runId: string; capabilities: CapabilitySummaryDto[]; disabled?: boolean; onActivate(id: string): Promise<unknown>; onDeactivate(id: string): Promise<unknown> }) {
  const [open, setOpen] = useState(false); const [setup, setSetup] = useState<CapabilityDetailDto>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const choose = async (id: string) => { const capability = capabilities.find((item) => item.id === id); if (!capability) return; setError(undefined); if (capability.state === "needs_setup" || capability.state === "available") { try { setSetup(await window.api.capabilities.get({ capabilityId: id, runId })); } catch { setError("Could not open capability setup."); } return; } setBusy(true); try { if (capability.state === "active") { if (window.confirm(`Deactivate ${capability.name}?`)) await onDeactivate(id); } else if (["ready", "inactive", "activation_failed"].includes(capability.state)) await onActivate(id); } catch { setError(`Could not apply ${capability.name}.`); } finally { setBusy(false); } };
  return <div className="relative flex items-center gap-1.5"><Blocks className="size-3.5 text-muted-foreground" /><PickerMenu ariaLabel="Capabilities" open={open} onOpenChange={setOpen} options={capabilities.map((item) => ({ id: item.id, label: item.name, hint: label(item.state), disabled: item.state === "unavailable" || item.state === "reloading" }))} value="" onChange={(id) => void choose(id)} display="Capabilities" disabled={disabled || busy} searchable searchPlaceholder="Search capabilities…" />
    <Link to="/capabilities" state={{ runId }} className="text-[10px] font-medium text-muted-foreground hover:text-foreground">Browse Capability Library</Link>{error ? <span role="alert" className="text-[10px] text-destructive">{error}</span> : null}
    {setup ? <CapabilitySetupDialog capability={setup} open onOpenChange={(next) => { if (!next) setSetup(undefined); }} onConfigure={async (request) => { await window.api.capabilities.configure(request); await onActivate(setup.id); }} /> : null}
  </div>;
}
