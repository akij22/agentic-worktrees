import { type ReactNode, useRef, useState } from "react";
import type { CodingAgentSessionDto } from "../../../../shared/ipc/schemas";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";

export const ThreadContextMenu = ({
  session,
  onDelete,
  children,
}: {
  session: CodingAgentSessionDto;
  onDelete: (session: CodingAgentSessionDto) => Promise<void>;
  children: ReactNode;
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const trigger = useRef<HTMLDivElement>(null);
  const menuPending = useRef(false);
  const openMenu = async (x: number, y: number) => {
    if (menuPending.current || pending.current || confirmOpen) return;
    menuPending.current = true;
    try {
      const result = await window.api.codingAgent.showSessionContextMenu({
        runId: session.id,
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
      });
      if (!result.success) throw new Error(result.error.message);
      trigger.current?.querySelector("button")?.focus({ preventScroll: true });
      if (result.action === "delete") {
        setError(undefined);
        setConfirmOpen(true);
      }
    } catch {
      setError("Could not open the chat menu. Please try again.");
    } finally {
      menuPending.current = false;
    }
  };

  const remove = async () => {
    if (pending.current) return;
    pending.current = true;
    setDeleting(true);
    setError(undefined);
    try {
      await onDelete(session);
      setConfirmOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not delete this chat. Please try again.",
      );
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        ref={trigger}
        onContextMenu={(event) => {
          event.preventDefault();
          void openMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10")
          )
            return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          void openMenu(bounds.left + 16, bounds.top + 16);
        }}
      >
        {children}
        {error && !confirmOpen && (
          <p role="alert" className="px-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending.current) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent
          size="sm"
          finalFocus={() => trigger.current?.querySelector("button") ?? null}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{session.title || "Untitled thread"}”
              and its saved chat history. Your repository and worktree will be
              kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? "Deleting…" : "Delete chat"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
