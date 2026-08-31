import { useEffect, useState } from "react";
import type { CapabilityConfigureRequest, CapabilityDetailDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { capabilityConfigureRequest, capabilityNetworkPermissionLabel, initialCapabilityFormValues, type CapabilityFormValues } from "../lib/capability-form";

export function CapabilitySetupDialog({ capability, open, onOpenChange, onConfigure }: { capability: CapabilityDetailDto; open: boolean; onOpenChange(open: boolean): void; onConfigure(request: CapabilityConfigureRequest): Promise<unknown> }) {
  const [values, setValues] = useState<CapabilityFormValues>(() => initialCapabilityFormValues(capability));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setValues(initialCapabilityFormValues(capability)); setSecrets({}); setCleared(new Set()); setError(undefined);
  }, [capability.id, open]);
  const update = (key: string, value: string | number | boolean) => setValues((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setError(undefined);
    try { await onConfigure(capabilityConfigureRequest(capability, values, secrets, cleared)); onOpenChange(false); }
    catch { setError("Could not save capability configuration."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogHeader><DialogTitle>Configure {capability.name}</DialogTitle><DialogDescription>Review permissions and settings before enabling this capability.</DialogDescription></DialogHeader>
    <div className="mt-5 space-y-4 text-sm">
      <div className="rounded-lg border border-primary/15 bg-primary/[0.045] p-3 text-muted-foreground">
        <p className="font-medium text-foreground">Network permissions</p>
        {capability.permissions.network.length ? <ul className="mt-1 list-inside list-disc">{capability.permissions.network.map((item) => <li key={item}>{capabilityNetworkPermissionLabel(item)}</li>)}</ul> : <p className="mt-1">None</p>}
      </div>
      {capability.settings.length === 0 ? <p>No additional settings are required.</p> : capability.settings.map((setting) => <div key={setting.key} className="space-y-1.5">
        <Label htmlFor={`capability-${setting.key}`}>{setting.key}</Label>
        {setting.type === "string" && setting.enum ? <select id={`capability-${setting.key}`} className="h-9 w-full rounded-md border border-border bg-background px-3" value={String(values[setting.key] ?? "")} onChange={(event) => update(setting.key, event.target.value)}>{setting.enum.map((option) => <option key={option}>{option}</option>)}</select> : null}
        {setting.type === "string" && !setting.enum ? <Input id={`capability-${setting.key}`} value={String(values[setting.key] ?? "")} onChange={(event) => update(setting.key, event.target.value)} /> : null}
        {setting.type === "integer" ? <Input id={`capability-${setting.key}`} type="number" min={setting.min} max={setting.max} value={Number(values[setting.key] ?? setting.min ?? 0)} onChange={(event) => update(setting.key, Number(event.target.value))} /> : null}
        {setting.type === "boolean" ? <input id={`capability-${setting.key}`} type="checkbox" checked={Boolean(values[setting.key])} onChange={(event) => update(setting.key, event.target.checked)} /> : null}
        {setting.type === "secret" ? <div className="flex gap-2"><Input id={`capability-${setting.key}`} type="password" autoComplete="off" value={secrets[setting.key] ?? ""} onChange={(event) => { setSecrets((current) => ({ ...current, [setting.key]: event.target.value })); setCleared((current) => { const next = new Set(current); next.delete(setting.key); return next; }); }} />{capability.secretConfigured ? <Button type="button" variant="outline" aria-label={`Clear ${setting.key}`} onClick={() => setCleared((current) => new Set(current).add(setting.key))}>Clear</Button> : null}</div> : null}
      </div>)}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Accept and continue"}</Button></DialogFooter>
  </Dialog>;
}
