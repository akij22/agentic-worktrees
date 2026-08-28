import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilityConfigureRequest, CapabilityDetailDto, CapabilitySummaryDto } from "../../../../shared/ipc/schemas";

export function useCapabilities(runId?: string) {
  const [capabilities, setCapabilities] = useState<CapabilitySummaryDto[]>([]);
  const [detail, setDetail] = useState<CapabilityDetailDto>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  const selectedId = useRef<string | undefined>(undefined);
  const refreshPending = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    try {
      const values = await window.api.capabilities.list(runId ? { runId } : undefined);
      if (!mounted.current || runIdRef.current !== runId) return;
      setCapabilities(values);
      if (selectedId.current) {
        const nextDetail = await window.api.capabilities.get({ capabilityId: selectedId.current, ...(runId ? { runId } : {}) });
        if (!mounted.current || runIdRef.current !== runId) return;
        setDetail(nextDetail);
      }
      setError(undefined);
    } catch { if (mounted.current && runIdRef.current === runId) setError("Could not load capabilities. Please try again."); }
    finally { refreshPending.current = false; if (mounted.current && runIdRef.current === runId) setLoading(false); }
  }, [runId]);

  useEffect(() => {
    mounted.current = true; refreshPending.current = false; setLoading(true); setDetail(undefined); selectedId.current = undefined; void refresh();
    const unsubscribe = window.api.capabilities.onChanged((event) => { if (!runId || event.runId === runId) void refresh(); });
    return () => { mounted.current = false; unsubscribe(); };
  }, [refresh, runId]);

  const select = useCallback(async (capabilityId: string) => {
    selectedId.current = capabilityId;
    try { const value = await window.api.capabilities.get({ capabilityId, ...(runId ? { runId } : {}) }); if (mounted.current && selectedId.current === capabilityId) setDetail(value); }
    catch { if (mounted.current && runIdRef.current === runId) setError("Could not load capability details."); }
  }, [runId]);
  const configure = useCallback(async (request: CapabilityConfigureRequest) => { const value = await window.api.capabilities.configure(request); setDetail(value); await refresh(); return value; }, [refresh]);
  const activate = useCallback(async (capabilityId: string) => { if (!runId) throw new Error("A chat is required to activate a capability."); const value = await window.api.capabilities.activate({ runId, capabilityId }); await refresh(); return value; }, [refresh, runId]);
  const deactivate = useCallback(async (capabilityId: string) => { if (!runId) throw new Error("A chat is required to deactivate a capability."); const value = await window.api.capabilities.deactivate({ runId, capabilityId }); await refresh(); return value; }, [refresh, runId]);
  return { capabilities, detail, loading, error, select, configure, activate, deactivate, refresh };
}
