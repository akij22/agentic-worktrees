import { Blocks, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CapabilitySummaryDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";

const formatLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const stateTone: Record<CapabilitySummaryDto["state"], string> = {
  active: "bg-chart-3",
  activation_failed: "bg-error",
  available: "bg-muted-foreground",
  inactive: "bg-warning",
  needs_setup: "bg-warning",
  pending_activation: "bg-warning",
  pending_deactivation: "bg-warning",
  ready: "bg-primary",
  reloading: "bg-primary",
  unavailable: "bg-error",
};

type CapabilityRegistryProps = {
  capabilities: CapabilitySummaryDto[];
  error?: string;
  loading: boolean;
  runId?: string;
  selectedId?: string;
  onSelect(capabilityId: string): void;
};

export function CapabilityRegistry({
  capabilities,
  error,
  loading,
  runId,
  selectedId,
  onSelect,
}: CapabilityRegistryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [compatibility, setCompatibility] = useState("all");
  const [state, setState] = useState("all");

  const categories = useMemo(
    () => [...new Set(capabilities.map((item) => item.category))],
    [capabilities],
  );
  const filtered = useMemo(
    () =>
      capabilities.filter(
        (capability) =>
          `${capability.name} ${capability.description}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (category === "all" || capability.category === category) &&
          (compatibility === "all" ||
            capability.compatibility[compatibility as "codex" | "opencode"] ===
              "supported") &&
          (state === "all" || capability.state === state),
      ),
    [capabilities, category, compatibility, query, state],
  );
  const readyCount = capabilities.filter((item) =>
    ["active", "ready"].includes(item.state),
  ).length;
  const hasFilters =
    query.length > 0 ||
    category !== "all" ||
    compatibility !== "all" ||
    state !== "all";

  useEffect(() => {
    if (!selectedId && filtered[0]) onSelect(filtered[0].id);
  }, [filtered, onSelect, selectedId]);

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
    setCompatibility("all");
    setState("all");
  };

  return (
    <>
      <header className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between lg:col-span-2">
        <div className="flex min-w-0 items-start gap-3 md:items-center">
          <Blocks
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-primary md:mt-0"
          />
          <div className="min-w-0 md:flex md:items-baseline md:gap-3">
            <h1 className="min-w-0 [overflow-wrap:anywhere] text-lg font-bold tracking-[-0.025em] text-foreground">
              Capability marketplace
            </h1>
            <p className="mt-0.5 max-w-[62ch] text-xs leading-5 text-muted-foreground md:mt-0">
              {runId
                ? "Inspect permissions, then add tools to this chat."
                : "Review permissions, compatibility, and source before setup."}
            </p>
          </div>
        </div>
        <dl className="flex shrink-0 items-center gap-4 pl-7 text-[11px] tabular-nums md:pl-0">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Reviewed</dt>
            <dd className="font-semibold text-foreground">
              {capabilities.length}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5 border-l border-border pl-4">
            <dt className="text-muted-foreground">Ready</dt>
            <dd className="font-semibold text-primary">{readyCount}</dd>
          </div>
        </dl>
      </header>

      <div className="grid min-w-0 gap-2 border-b border-border bg-card/40 p-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-[minmax(15rem,1fr)_10.5rem_10.5rem_10.5rem]">
        <div className="relative min-w-0 sm:col-span-2 lg:col-span-1">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search capabilities"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or function"
            className="h-11 pl-9 pr-9 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:ring-0"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear capability search"
              onClick={() => setQuery("")}
              className="absolute right-0 top-0 grid size-11 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px motion-reduce:transform-none"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <Select
          aria-label="Filter capability category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-11 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:ring-0"
        >
          <option value="all">All categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {formatLabel(value)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter capability compatibility"
          value={compatibility}
          onChange={(event) => setCompatibility(event.target.value)}
          className="h-11 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:ring-0"
        >
          <option value="all">All agents</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </Select>
        <Select
          aria-label="Filter capability state"
          value={state}
          onChange={(event) => setState(event.target.value)}
          className="h-11 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:ring-0"
        >
          <option value="all">All states</option>
          <option value="available">Available</option>
          <option value="needs_setup">Needs setup</option>
          <option value="ready">Ready</option>
          <option value="unavailable">Unavailable</option>
        </Select>
      </div>

      <aside className="flex min-h-0 min-w-0 flex-col border-b border-border bg-[var(--color-paper-2)] lg:border-b-0 lg:border-r">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            Registry
          </div>
          <span
            aria-live="polite"
            className="text-[11px] tabular-nums text-muted-foreground"
          >
            {filtered.length}{" "}
            {filtered.length === 1 ? "capability" : "capabilities"}
          </span>
        </div>

        <div className="min-h-0 max-h-72 flex-1 overflow-auto p-2 lg:max-h-none">
          {loading ? (
            <div
              aria-label="Loading capability registry"
              className="space-y-2 p-1"
            >
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-20 rounded-md border border-border bg-muted/30"
                />
              ))}
            </div>
          ) : filtered.length ? (
            filtered.map((capability, index) => {
              const isSelected = selectedId === capability.id;
              return (
                <button
                  key={capability.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(capability.id)}
                  className={`group mb-1 flex min-h-20 w-full min-w-0 items-start gap-3 rounded-md border px-3 py-3 text-left transition-[background-color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none ${
                    isSelected
                      ? "border-primary/30 bg-primary/[0.08]"
                      : "border-transparent hover:border-border hover:bg-muted/55"
                  }`}
                >
                  <span className="mt-0.5 w-6 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold tracking-[-0.015em] text-foreground">
                        {capability.name}
                      </span>
                      <span
                        className={`size-2 shrink-0 rounded-full ${stateTone[capability.state]}`}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-1.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {capability.description}
                    </span>
                    <span className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{formatLabel(capability.category)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatLabel(capability.state)}</span>
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="grid min-h-52 place-items-center px-5 text-center">
              <div>
                <Search
                  aria-hidden="true"
                  className="mx-auto size-5 text-muted-foreground"
                />
                <p className="mt-3 text-sm font-semibold">
                  No capabilities match.
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Change the search term or remove a filter.
                </p>
                {hasFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="mt-3 motion-reduce:transform-none motion-reduce:transition-none"
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {error ? (
          <p
            role="alert"
            className="border-t border-border p-3 text-xs leading-5 text-destructive-foreground"
          >
            {error}
          </p>
        ) : null}
      </aside>
    </>
  );
}
