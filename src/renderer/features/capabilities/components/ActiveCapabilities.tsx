import { X } from "lucide-react";

interface ActiveCapability { id: string; name: string; state: string }
export function ActiveCapabilities({ capabilities, onRemove }: { capabilities: ActiveCapability[]; onRemove(id: string): void }) {
  const active = capabilities.filter((item) => item.state === "active");
  if (!active.length) return null;
  return <div className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{active.length} {active.length === 1 ? "Capability" : "Capabilities"}</span>{active.map((capability) => <button key={capability.id} type="button" aria-label={`Remove ${capability.name}`} title={`Remove ${capability.name}`} onClick={() => onRemove(capability.id)} className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/20 bg-primary/[0.06] px-2 text-[10px] font-medium text-primary hover:bg-primary/10">{capability.name}<X className="size-3" /></button>)}</div>;
}
