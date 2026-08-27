import { useEffect, useState } from "react";
import type { CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";

export function CapabilitySetupDialog({ capability, open, onOpenChange, onConfigure }: { capability: CapabilityDetailDto; open: boolean; onOpenChange(open: boolean): void; onConfigure(request: { capabilityId: string; acceptedPermissionDigest: string; settings: { providerMode: "auto"; resultLimit: number }; exaApiKey?: string }): Promise<unknown> }) {
  const [apiKey, setApiKey] = useState(""); const [resultLimit, setResultLimit] = useState(5); const [saving, setSaving] = useState(false); const [error, setError] = useState<string>();
  useEffect(() => { if (!open) { setApiKey(""); setError(undefined); } }, [open]);
  const save = async () => { setSaving(true); setError(undefined); try { await onConfigure({ capabilityId: capability.id, acceptedPermissionDigest: capability.permissionDigest, settings: { providerMode: "auto", resultLimit }, ...(apiKey.trim() ? { exaApiKey: apiKey.trim() } : {}) }); setApiKey(""); onOpenChange(false); } catch { setError("Could not save Web Search configuration."); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogHeader><DialogTitle>Configure {capability.name}</DialogTitle><DialogDescription>Queries and requested options are sent to Exa. Anonymous search is best-effort and rate-limited.</DialogDescription></DialogHeader>
    <div className="mt-5 space-y-4 text-sm">
      <div className="rounded-lg border border-primary/15 bg-primary/[0.045] p-3 text-muted-foreground"><p>No key is required. An optional key may increase limits.</p><p className="mt-1">No silent fallback provider is used.</p></div>
      <div className="space-y-1.5"><Label htmlFor="exa-api-key">Exa API key (optional)</Label><Input id="exa-api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="result-limit">Results per search</Label><Input id="result-limit" type="number" min={1} max={20} value={resultLimit} onChange={(event) => setResultLimit(Math.max(1, Math.min(20, Number(event.target.value))))} /></div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Accept and continue"}</Button></DialogFooter>
  </Dialog>;
}
