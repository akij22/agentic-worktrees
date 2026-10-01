/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 · Ecosystem Index · modern-minimal */
import { FolderPlus, Search } from "lucide-react";
import { useRef } from "react";
import { useLocation } from "react-router-dom";
import { AppNavigation, AppNavigationFooter } from "../components/AppNavigation";
import { WORKSPACE_SIDEBAR_DEFAULT_WIDTH } from "../components/app-shell-layout";
import { Button } from "../components/ui/button";
import { SkillDetail } from "../features/skills/components/SkillDetail";
import { MarketplaceCapabilityDetail } from "../features/marketplace/components/MarketplaceCapabilityDetail";
import { useMarketplace } from "../features/marketplace/hooks/useMarketplace";
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
  const inspect = () => {
    if (market.isExactSpec) void market.inspectPackage(market.query.trim());
  };
  return (
    <section
      aria-labelledby="marketplace-title"
      className="flex h-full min-h-0 min-w-0 overflow-hidden bg-background"
    >
      <aside
        aria-label="Ecosystem index"
        style={{ width: WORKSPACE_SIDEBAR_DEFAULT_WIDTH }}
        className="flex h-full min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-secondary text-sidebar-foreground"
      >
        <AppNavigation />
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border/70 px-4">
          <h1
            id="marketplace-title"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            Marketplace
          </h1>
          <Button
            size="icon"
            variant="outline"
            aria-label="Import local Skill"
            title="Import local Skill"
            onClick={() => void market.installSkill()}
            className="size-8 bg-background/65"
          >
            <FolderPlus aria-hidden="true" />
          </Button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            inspect();
          }}
          className="flex shrink-0 flex-col gap-2 px-3 pt-3"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">
              Search Official items or enter an npm package
            </span>
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
            />
            <input
              ref={sourceRef}
              aria-label="Search Official items or enter an npm package"
              placeholder="Search items or npm package"
              value={market.query}
              onChange={(e) => market.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  market.setQuery("");
                  sourceRef.current?.focus();
                }
              }}
              className="h-8 w-full rounded-lg border border-sidebar-border bg-background/60 pl-8 pr-2.5 text-xs placeholder:text-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
            />
          </label>
          {market.isExactSpec ? (
            <Button type="submit" className="whitespace-nowrap">
              Inspect package
            </Button>
          ) : null}
        </form>
        <div
          role="group"
          aria-label="Marketplace filters"
          className="flex shrink-0 flex-wrap gap-1 px-3 py-2.5"
        >
          {filters.map((value) => (
            <Button
              key={value}
              size="sm"
              className="h-7 px-2 text-[11px]"
              variant={market.filter === value ? "default" : "ghost"}
              aria-pressed={market.filter === value}
              onClick={() => market.setFilter(value)}
            >
              {label[value]}
            </Button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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
                  className="group w-full border-b border-sidebar-border px-2.5 py-3 text-left transition-colors hover:bg-sidebar-row-hover/70 aria-pressed:bg-sidebar-row-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring/60"
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
        </div>
        <AppNavigationFooter />
      </aside>
      <section
        aria-label="Marketplace item details"
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
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
          )
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
            Select an item to review its provenance and permissions.
          </div>
        )}
      </section>
    </section>
  );
}
