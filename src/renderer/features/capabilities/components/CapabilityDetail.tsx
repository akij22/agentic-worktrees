import { ExternalLink, ShieldCheck } from "lucide-react";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";

export function CapabilityDetail({ capability, onConfigure }: { capability: CapabilityDetailDto; onConfigure(): void }) {
  return <section aria-label={`${capability.name} details`} className="h-full overflow-auto p-6">
    <div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><Badge>{capability.category}</Badge><Badge variant="outline">v{capability.version}</Badge></div><h2 className="text-xl font-semibold tracking-tight">{capability.name}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{capability.description}</p></div><Button onClick={onConfigure}>Configure {capability.name}</Button></div>
    <div className="mt-8 grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-border/70 bg-card/45 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" />Reviewed permissions</h3><dl className="mt-4 space-y-3 text-xs"><div><dt className="text-muted-foreground">Network</dt><dd className="mt-1 font-mono">{capability.permissions.network.join(" · ")}</dd></div><div><dt className="text-muted-foreground">Optional secrets</dt><dd className="mt-1 font-mono">{capability.permissions.secrets.join(" · ") || "None"}</dd></div><div><dt className="text-muted-foreground">Tools</dt><dd className="mt-1 font-mono">{capability.providedTools.join(" · ")}</dd></div></dl></div>
      <div className="rounded-xl border border-border/70 bg-card/45 p-4"><h3 className="text-sm font-semibold">Provenance</h3><dl className="mt-4 space-y-3 text-xs"><div><dt className="text-muted-foreground">Publisher</dt><dd>{capability.author.name}</dd></div><div><dt className="text-muted-foreground">Source</dt><dd>{capability.provenance?.package} {capability.provenance?.sourceVersion}</dd></div><div><dt className="text-muted-foreground">License / review</dt><dd>{capability.license} · {capability.reviewStatus}</dd></div></dl>{capability.provenance ? <a className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={capability.provenance.repository} target="_blank" rel="noreferrer">Source repository <ExternalLink className="size-3" /></a> : null}</div>
    </div>
  </section>;
}
