import { LoaderCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Skeleton } from "../../../components/ui/skeleton";
import type { SessionGridDetail } from "../types";
import { formatDate } from "../lib/formatters";
import {
  buildSecondarySessionOptions,
  type SecondarySessionOption,
} from "../lib/secondary-session-options";
import { GridIcon } from "./GridIcon";

type Props = {
  primaryRunId: string;
  sessions: CodingAgentSessionDto[];
  contexts: CodingAgentWorktreeContextDto[];
  sessionDetails: Map<string, SessionGridDetail>;
  loading: boolean;
  error?: string;
  unavailableMessage?: string;
  onSelect: (runId: string) => void;
};

type SessionStatus = {
  label: "Working" | "Permission required" | "Error" | "Ready";
  className: string;
  spinning: boolean;
};

const getSessionStatus = ({
  session,
  detail,
}: SecondarySessionOption): SessionStatus => {
  if (session.errorMessage || session.status === "error") {
    return {
      label: "Error",
      className: "border-destructive/35 bg-destructive/10 text-destructive",
      spinning: false,
    };
  }
  if (session.status === "waiting_permission") {
    return {
      label: "Permission required",
      className: "border-chart-4/50 bg-chart-4/10 text-amber-700 dark:text-chart-4",
      spinning: false,
    };
  }
  if (detail?.isProcessing) {
    return {
      label: "Working",
      className: "border-primary/30 bg-primary/10 text-primary",
      spinning: true,
    };
  }
  return {
    label: "Ready",
    className: "border-chart-3/35 bg-chart-3/10 text-emerald-700 dark:text-chart-3",
    spinning: false,
  };
};

export const SecondarySessionSelector = ({
  primaryRunId,
  sessions,
  contexts,
  sessionDetails,
  loading,
  error,
  unavailableMessage,
  onSelect,
}: Props) => {
  const [query, setQuery] = useState("");
  const allOptions = useMemo(
    () =>
      buildSecondarySessionOptions({
        primaryRunId,
        sessions,
        contexts,
        sessionDetails,
        query: "",
      }),
    [contexts, primaryRunId, sessionDetails, sessions],
  );
  const visibleOptions = useMemo(
    () =>
      buildSecondarySessionOptions({
        primaryRunId,
        sessions,
        contexts,
        sessionDetails,
        query,
      }),
    [contexts, primaryRunId, query, sessionDetails, sessions],
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-card p-6">
        <div
          role="status"
          className="w-full max-w-2xl space-y-4 rounded-xl border border-border bg-background p-5 shadow-sm"
        >
          <span className="sr-only">Loading coding agent chats</span>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-9 w-full" />
          <div className="space-y-2 pt-1">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-card p-6">
      <div className="flex max-h-[calc(100%-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <div className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Open a second chat</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Choose an existing coding session to work on it alongside this
                chat.
              </p>
            </div>
            {allOptions.length > 0 ? (
              <span className="shrink-0 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {visibleOptions.length}/{allOptions.length}
              </span>
            ) : null}
          </div>

          {unavailableMessage ? (
            <p className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {unavailableMessage}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {allOptions.length > 0 ? (
            <div className="relative mt-4">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                autoFocus
                type="search"
                aria-label="Search coding agent chats"
                placeholder="Search title, repository, branch, model, activity…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9 pr-16"
              />
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2 text-muted-foreground"
                  onClick={() => setQuery("")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {allOptions.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium">No other chats available</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Create another coding session before opening the dual chat
                view.
              </p>
            </div>
          ) : visibleOptions.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium">No matching chats</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different title, repository, branch, model, or activity.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleOptions.map((option) => {
                const status = getSessionStatus(option);

                return (
                  <button
                    key={option.session.id}
                    type="button"
                    onClick={() => onSelect(option.session.id)}
                    className="group w-full rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/45 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {option.session.title}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-primary">
                          <GridIcon name="branch" />
                          <span className="truncate">{option.branch}</span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-medium ${status.className}`}
                      >
                        {status.spinning ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="size-3 animate-spin"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-current"
                          />
                        )}
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-3 flex min-w-0 items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="truncate font-mono">
                        {option.repository}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="flex shrink-0 items-center gap-1 font-mono">
                        <GridIcon name="bot" />
                        {option.session.providerId}/{option.session.modelId}
                      </span>
                      <span className="ml-auto shrink-0 font-mono">
                        {formatDate(option.session.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-2 truncate rounded-md bg-muted/35 px-2.5 py-2 font-mono text-[11px] text-muted-foreground transition-colors group-hover:bg-background/80">
                      <span className="mr-2 text-primary">&gt;</span>
                      {option.activity}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
