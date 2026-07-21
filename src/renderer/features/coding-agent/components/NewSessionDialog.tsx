import { useEffect, useState } from "react";
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
import { Select } from "../../../components/ui/select";

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
  const [worktreeId, setWorktreeId] = useState(initialWorktreeId ?? "");
  const [agentKind, setAgentKind] = useState<CodingAgentKindDto | "">("");
  const [title, setTitle] = useState("New coding session");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setWorktreeId(initialWorktreeId ?? contexts[0]?.worktree.id ?? "");
      setAgentKind("");
    }
  }, [contexts, initialWorktreeId, open]);
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
          Select a worktree. You can choose the AI model directly from the chat.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="coding-agent-harness">Coding agent</Label>
          <Select
            id="coding-agent-harness"
            value={agentKind}
            onChange={(event) =>
              setAgentKind(event.target.value as CodingAgentKindDto | "")
            }
          >
            <option value="">Select a coding agent…</option>
            {installations.map((installation) => (
              <option
                key={installation.kind}
                value={installation.kind}
                disabled={!installation.configured}
              >
                {installation.name}
                {installation.configured ? "" : " (not configured)"}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-worktree">Worktree</Label>
          <Select
            id="agent-worktree"
            value={worktreeId}
            onChange={(event) => setWorktreeId(event.target.value)}
          >
            {contexts.map(({ worktree, repository }) => (
              <option key={worktree.id} value={worktree.id}>
                {repository.fullName} · {worktree.name} ({worktree.branchName})
              </option>
            ))}
          </Select>
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
