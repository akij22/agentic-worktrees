import { useCallback, useEffect, useRef, useState } from "react";
import type { CapabilityDetailDto, MarketplaceItemDto } from "../../../../shared/ipc/schemas";
import type { SkillDetailDto } from "../../../../shared/skills/schemas";

export function useMarketplace(runId?: string) {
  const [items, setItems] = useState<MarketplaceItemDto[]>([]);
  const [detail, setDetail] = useState<CapabilityDetailDto | SkillDetailDto>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    try {
      const [capabilities, skills] = await Promise.all([
        window.api.capabilities.list(runId ? { runId } : undefined),
        window.api.skills.list(),
      ]);
      if (requestGeneration !== generation.current) return;
      setItems([
        ...capabilities.map((capability) => ({ kind: "capability" as const, capability })),
        ...skills.map((skill) => ({ kind: "skill" as const, skill })),
      ]);
      setError(undefined);
    } catch {
      if (requestGeneration === generation.current) setError("Could not load marketplace items. Please try again.");
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    generation.current += 1;
    setDetail(undefined);
    setLoading(true);
    void refresh();
    const capabilitySubscription = window.api.capabilities.onChanged(() => void refresh());
    const skillSubscription = window.api.skills.onChanged(() => void refresh());
    return () => {
      generation.current += 1;
      capabilitySubscription();
      skillSubscription();
    };
  }, [refresh]);

  const select = useCallback(async (item: MarketplaceItemDto) => {
    try {
      const selected = item.kind === "capability"
        ? await window.api.capabilities.get({ capabilityId: item.capability.id, ...(runId ? { runId } : {}) })
        : await window.api.skills.get({ skillId: item.skill.id });
      setDetail(selected);
      setError(undefined);
      return selected;
    } catch {
      setError("Could not load marketplace item details.");
      return undefined;
    }
  }, [runId]);

  const install = useCallback(async () => {
    try {
      const value = await window.api.skills.install();
      await refresh();
      setError(undefined);
      return value;
    } catch {
      setError("Could not install the skill.");
      return undefined;
    }
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await window.api.skills.remove({ skillId: id });
      setDetail(undefined);
      await refresh();
      setError(undefined);
      return true;
    } catch {
      setError("Could not remove the skill.");
      return false;
    }
  }, [refresh]);

  return { items, detail, loading, error, refresh, select, install, remove };
}
