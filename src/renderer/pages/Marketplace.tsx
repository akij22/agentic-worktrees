/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 · Ecosystem Index · modern-minimal */
import { Blocks, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "../components/ui/button";
import { SkillDetail } from "../features/skills/components/SkillDetail";
import { MarketplaceCapabilityDetail } from "../features/marketplace/components/MarketplaceCapabilityDetail";
import { useMarketplace } from "../features/marketplace/hooks/useMarketplace";
import { CapabilitySetupDialog } from "../features/capabilities/components/CapabilitySetupDialog";
const filters = ["all", "capability", "skill", "installed"] as const;
const label = {
  all: "All",
  capability: "Capabilities",
  skill: "Skills",
  installed: "Installed",
};
export function Marketplace() {
  const location = useLocation(),
    runId = (location.state as { runId?: string } | null)?.runId,
    market = useMarketplace(runId),
    sourceRef = useRef<HTMLInputElement>(null);
  const [configuring, setConfiguring] = useState(false);
  const openedTarget = useRef<string | undefined>(undefined);
  const navigationState: unknown = location.state;
  const resource =
    navigationState &&
    typeof navigationState === "object" &&
    "resource" in navigationState
      ? navigationState.resource
      : null;
  const target =
    resource &&
    typeof resource === "object" &&
    "kind" in resource &&
    "id" in resource &&
    (resource.kind === "capability" || resource.kind === "skill") &&
    typeof resource.id === "string"
      ? { kind: resource.kind, id: resource.id }
      : null;
  useEffect(() => {
    if (!target || market.loading) return;
    const key = `${location.key}:${target.kind}:${target.id}`;
    if (openedTarget.current === key) return;
    const item = market.items.find(
      (item) =>
        item.kind === target.kind &&
        (item.kind === "skill" ? item.skill.id : item.capability.id) ===
          target.id,
    );
    if (item) {
      openedTarget.current = key;
      void market.select(item);
    }
  }, [
    location.key,
    target?.kind,
    target?.id,
    market.loading,
    market.items,
    market.select,
  ]);
  const inspect = () => {
    if (market.isExactSpec) void market.inspectPackage(market.query.trim());
  };
  return (
    <section
      aria-labelledby="marketplace-title"
      className="grid h-full min-h-[34rem] min-w-0 overflow-x-clip border-y border-border bg-[var(--color-paper)] lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]"
    >
      <header className="col-span-full grid gap-3 border-b border-border p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(18rem,34rem)_auto] md:items-center">
        <div className="flex items-center gap-3">
          <Blocks className="size-4 text-primary" />
          <div>
            <h1 id="marketplace-title" className="text-lg font-bold">
              Marketplace
            </h1>
            <p className="text-xs text-muted-foreground">
              Official packages, local Skills, and explicit trust review.
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            inspect();
          }}
          className="flex min-w-0 gap-2"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">
              Search Official items or enter an npm package
            </span>
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <input
              ref={sourceRef}
              aria-label="Search Official items or enter an npm package"
              placeholder="Search Official items or enter an npm package"
              value={market.query}
              onChange={(e) => market.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  market.setQuery("");
                  sourceRef.current?.focus();
                }
              }}
              className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {market.isExactSpec ? (
            <Button type="submit" className="whitespace-nowrap">
              Inspect package
            </Button>
          ) : null}
        </form>
        <Button
          variant="outline"
          onClick={() => void market.installSkill()}
          className="whitespace-nowrap"
        >
          Import local Skill
        </Button>
      </header>
      <aside
        aria-label="Ecosystem index"
        className="min-h-0 min-w-0 overflow-auto border-r border-border bg-[var(--color-paper-2)] p-3"
      >
        <div
          role="group"
          aria-label="Marketplace filters"
          className="mb-3 flex flex-wrap gap-1"
        >
          {filters.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={market.filter === value ? "default" : "ghost"}
              aria-pressed={market.filter === value}
              onClick={() => market.setFilter(value)}
            >
              {label[value]}
            </Button>
          ))}
        </div>
        <h2 className="border-y border-border py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Ecosystem index
        </h2>
        {market.loading ? (
          <p role="status" className="p-3 text-xs text-muted-foreground">
            Loading Marketplace…
          </p>
        ) : market.items.length ? (
          market.items.map((item) => {
            const value = item.kind === "skill" ? item.skill : item.capability;
            const trust =
              item.kind === "skill"
                ? "Local"
                : item.capability.trust.replace("-", " ");
            return (
              <button
                key={`${item.kind}:${value.id}`}
                aria-pressed={
                  market.selected?.kind === item.kind &&
                  (market.selected.kind === "skill"
                    ? market.selected.skill.id
                    : market.selected.capability.id) === value.id
                }
                onClick={() => void market.select(item)}
                className="group w-full border-b border-border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-primary">
                  <span>{item.kind}</span>
                  <span>{trust}</span>
                </span>
                <strong className="mt-1 block text-sm">{value.name}</strong>
                <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {value.description}
                </span>
              </button>
            );
          })
        ) : (
          <p className="p-4 text-center text-sm">
            {market.query || market.filter !== "all"
              ? "No Marketplace items match your filters."
              : "No Marketplace items are available."}
          </p>
        )}
        {market.error ? (
          <div className="p-3">
            <p role="alert" className="text-xs text-destructive">
              {market.error}
            </p>
          </div>
        ) : null}
      </aside>
      <main className="min-h-0 min-w-0">
        {market.detail ? (
          "instructionPreview" in market.detail ? (
            <SkillDetail
              skill={market.detail}
              onRemove={() => {
                const selected = market.detail;
                if (selected && window.confirm(`Remove ${selected.name}?`))
                  void market.removeSkill(selected.id);
              }}
            />
          ) : (
            <>
              {["installed", "needs_setup"].includes(
                market.detail.installationState,
              ) ? (
                <Button
                  variant="outline"
                  className="m-4 mb-0"
                  onClick={() => setConfiguring(true)}
                >
                  Configure {market.detail.name}
                </Button>
              ) : null}
              <MarketplaceCapabilityDetail
                capability={market.detail}
                inspection={market.inspection}
                progress={market.progress}
                onInstall={() => void market.installCapability()}
                onRequestUpdate={() => void market.requestUpdate()}
                onUpdate={() => void market.updateCapability()}
                removalReview={market.removalReview}
                onRequestRemoval={() => void market.requestRemoval()}
                onConfirmRemoval={() => void market.confirmRemoval()}
                onCancelRemoval={() => market.cancelRemoval()}
                onCancel={() => {
                  void market
                    .cancelOperation()
                    .finally(() => sourceRef.current?.focus());
                }}
              />
              <CapabilitySetupDialog
                capability={market.detail}
                open={configuring}
                onOpenChange={setConfiguring}
                onConfigure={async (request) => {
                  await window.api.capabilities.configure(request);
                  await market.refresh(true);
                }}
              />
            </>
          )
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
            Select an item to review its provenance and permissions.
          </div>
        )}
      </main>
    </section>
  );
}
