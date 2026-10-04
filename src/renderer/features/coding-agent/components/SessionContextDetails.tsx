import { Popover } from "@base-ui/react/popover";
import { Info, X } from "lucide-react";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";

export function SessionContextDetails({context}: {context: CodingAgentWorktreeContextDto}) {
  const details = [["Repository",context.repository.fullName],["Worktree",context.worktree.name],["Branch",context.worktree.branchName],["Path",context.worktree.path]];
  return (
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button variant="ghost" size="icon" className="size-8 shrink-0" />
            }
            aria-label="Session details"
            title="Session details"
          >
            <Info aria-hidden="true" className="size-4" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              sideOffset={8}
              align="end"
              collisionPadding={12}
              className="z-50"
            >
              <Popover.Popup className="session-header-details rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Popover.Title className="text-sm font-semibold">
                    Session details
                  </Popover.Title>
                  <Popover.Close
                    render={
                      <Button variant="ghost" size="icon" className="size-8" />
                    }
                    aria-label="Close session details"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Popover.Close>
                </div>
                <dl className="space-y-3">
                  {details.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="mb-1 text-xs text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="min-w-0 whitespace-normal font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
  );
}
