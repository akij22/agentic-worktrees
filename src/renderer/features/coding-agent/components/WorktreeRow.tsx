import { ChevronDown, Folder, GitBranch, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import { PickerMenu } from "./PickerMenu";
import { getWorkspaceLabel } from "../lib/workspace-labels";

type Props = {
  contexts: CodingAgentWorktreeContextDto[];
  selectedWorktreeId?: string;
  activeCapabilityCount: number;
  onSelectWorktree: (worktreeId: string) => void;
  onOpenCapabilities?: () => void;
  capabilitiesDisabled?: boolean;
  capabilitiesExpanded?: boolean;
  capabilitiesPanelId?: string;
};

const buildGroups = (contexts: CodingAgentWorktreeContextDto[]) => {
  const groups = new Map<
    string,
    { id: string; name: string; contexts: CodingAgentWorktreeContextDto[] }
  >();

  for (const context of contexts) {
    const group = groups.get(context.repository.id);
    if (group) {
      group.contexts.push(context);
      continue;
    }
    groups.set(context.repository.id, {
      id: context.repository.id,
      name: context.repository.name,
      contexts: [context],
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    contexts: group.contexts.toSorted((left, right) => {
      if (left.worktree.kind !== right.worktree.kind) {
        return left.worktree.kind === "primary" ? -1 : 1;
      }
      return left.worktree.name.localeCompare(right.worktree.name);
    }),
  }));
};

/**
 * The line under the composer. It answers "where am I working", and the
 * capability trigger next to it is the entry point to the worktree's
 * Assignment.
 */
export const WorktreeRow = ({
  contexts,
  selectedWorktreeId,
  activeCapabilityCount,
  onSelectWorktree,
  onOpenCapabilities,
  capabilitiesDisabled = false,
  capabilitiesExpanded = false,
  capabilitiesPanelId = "worktree-capability-panel",
}: Props) => {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => buildGroups(contexts), [contexts]);
  const options = useMemo(
    () =>
      groups.flatMap((group) =>
        group.contexts.map((context) => ({
          id: context.worktree.id,
          label: getWorkspaceLabel(context),
          hint: group.name,
        })),
      ),
    [groups],
  );
  const selectedContext = contexts.find(
    ({ worktree }) => worktree.id === selectedWorktreeId,
  );

  if (contexts.length === 0) return null;

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 max-w-full items-center gap-1.5">
        <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <PickerMenu
          ariaLabel="Current checkout"
          open={open}
          onOpenChange={setOpen}
          options={options}
          value={selectedWorktreeId ?? ""}
          onChange={onSelectWorktree}
          display={
            selectedContext
              ? selectedContext.worktree.kind === "primary"
              ? "Main checkout"
              : selectedContext.worktree.name
              : "Select a workspace…"
          }
          searchable
          searchPlaceholder="Search workspaces…"
          emptyLabel="No matching workspaces"
          triggerClassName="h-8 max-w-[15rem] gap-2 border-transparent bg-transparent px-1 text-xs font-medium shadow-none"
        />
      </div>

      <span
        className="flex min-w-0 flex-1 items-center gap-2 border-l border-border pl-3 font-mono text-[11px] text-muted-foreground"
        title={selectedContext?.worktree.branchName}
      >
        <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">
          {selectedContext?.worktree.branchName ?? "Current branch"}
        </span>
      </span>

      {onOpenCapabilities ? (
        <button
          type="button"
          onClick={onOpenCapabilities}
          disabled={capabilitiesDisabled}
          aria-expanded={capabilitiesExpanded}
          aria-controls={capabilitiesPanelId}
          className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wrench aria-hidden="true" className="size-3.5" />
          Capabilities
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
            {activeCapabilityCount}
          </span>
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </button>
      ) : null}

      {selectedContext?.worktree.kind === "primary" ? (
        <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <Folder aria-hidden="true" className="size-3 shrink-0" />
          Shared checkout — changes affect other local work
        </span>
      ) : null}
    </div>
  );
};
