import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentKindDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { PickerMenu } from "./PickerMenu";
import { getWorkspaceLabel } from "../lib/workspace-labels";

type Props = {
  open: boolean;
  contexts: CodingAgentWorktreeContextDto[];
  installations: CodingAgentInstallationStatusDto[];
  initialWorktreeId?: string;
  onClose: () => void;
};

export const NewSessionDialog = ({
  open,
  contexts,
  installations,
  initialWorktreeId,
  onClose,
}: Props) => {
  const navigate = useNavigate();
  const projectGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        contexts: CodingAgentWorktreeContextDto[];
      }
    >();

    for (const context of contexts) {
      const group = groups.get(context.repository.id);
      if (group) {
        group.contexts.push(context);
      } else {
        groups.set(context.repository.id, {
          id: context.repository.id,
          name: context.repository.name,
          contexts: [context],
        });
      }
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
  }, [contexts]);
  const [worktreeId, setWorktreeId] = useState(initialWorktreeId ?? "");
  const [agentKind, setAgentKind] = useState<CodingAgentKindDto | "">("");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [title, setTitle] = useState("New coding session");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      const requested = contexts.find(
        ({ worktree }) => worktree.id === initialWorktreeId,
      );
      const preferred =
        requested ??
        contexts.find(({ worktree }) => worktree.kind === "primary") ??
        contexts[0];
      setWorktreeId(preferred?.worktree.id ?? "");
      setAgentKind("");
      setAgentPickerOpen(false);
      setWorkspacePickerOpen(false);
    }
  }, [contexts, initialWorktreeId, open]);
  const selectedContext = contexts.find(
    ({ worktree }) => worktree.id === worktreeId,
  );
  const agentOptions = installations.map((installation) => ({
    id: installation.kind,
    label: installation.name,
    disabled: !installation.configured,
    hint: installation.configured ? undefined : "Not configured",
  }));
  const workspaceOptions = projectGroups.flatMap((project) =>
    project.contexts.map((context) => ({
      id: context.worktree.id,
      label: getWorkspaceLabel(context),
      hint: project.name,
    })),
  );
  const selectedInstallation = installations.find(
    ({ kind }) => kind === agentKind,
  );
  if (!open) return null;
  const create = async () => {
    if (!agentKind || !worktreeId || !title.trim()) return;
    setCreating(true);
    setError(undefined);
    try {
      const session = await window.api.codingAgent.createSession({
        agentKind,
        worktreeId,
        title: title.trim(),
      });
      navigate(`/coding-agent/${worktreeId}/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCreating(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogHeader>
        <DialogTitle>New coding session</DialogTitle>
        <DialogDescription>
          Select a workspace. You can choose the AI model directly from the chat.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="coding-agent-harness">Coding agent</Label>
          <PickerMenu
            id="coding-agent-harness"
            ariaLabel="Coding agent"
            open={agentPickerOpen}
            onOpenChange={setAgentPickerOpen}
            options={agentOptions}
            value={agentKind}
            onChange={(id) => setAgentKind(id as CodingAgentKindDto)}
            display={selectedInstallation?.name ?? "Select a coding agent…"}
            triggerClassName="h-10 w-full justify-between rounded-xl bg-muted/55 px-3 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-worktree">Workspace</Label>
          <PickerMenu
            id="agent-worktree"
            ariaLabel="Workspace"
            open={workspacePickerOpen}
            onOpenChange={setWorkspacePickerOpen}
            options={workspaceOptions}
            value={worktreeId}
            onChange={setWorktreeId}
            display={
              selectedContext
                ? getWorkspaceLabel(selectedContext)
                : "Select a workspace…"
            }
            searchable
            searchPlaceholder="Search workspaces…"
            emptyLabel="No matching workspaces"
            triggerClassName="h-10 w-full justify-between rounded-xl bg-muted/55 px-3 text-sm"
          />
          {selectedContext?.worktree.kind === "primary" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Changes are applied directly to the shared checkout and can
              affect other local work.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-title">Session title</Label>
          <Input
            id="agent-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={() => void create()}
          disabled={creating || !agentKind || !worktreeId || !title.trim()}
        >
          {creating ? "Creating…" : "Create chat"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
