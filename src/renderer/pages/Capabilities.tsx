import { Blocks } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { CapabilityDetail } from "../features/capabilities/components/CapabilityDetail";
import { CapabilityRegistry } from "../features/capabilities/components/CapabilityRegistry";
import { CapabilitySetupDialog } from "../features/capabilities/components/CapabilitySetupDialog";
import { useCapabilities } from "../features/capabilities/hooks/useCapabilities";

export const Capabilities = () => {
  const location = useLocation();
  const runId = (location.state as { runId?: string } | null)?.runId;
  const library = useCapabilities(runId);
  const [setupOpen, setSetupOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const selected = library.detail;

  const activateSelected = () => {
    if (!selected) return;
    setActionError(undefined);
    void library
      .activate(selected.id)
      .catch(() =>
        setActionError("Could not add this capability to the chat."),
      );
  };
  const deactivateSelected = () => {
    if (!selected || !window.confirm(`Remove ${selected.name} from this chat?`))
      return;
    setActionError(undefined);
    void library
      .deactivate(selected.id)
      .catch(() =>
        setActionError("Could not remove this capability from the chat."),
      );
  };

  return (
    <section className="grid h-full min-h-[34rem] min-w-0 overflow-auto border-y border-border bg-[var(--color-paper)] lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,2fr)] lg:grid-rows-[auto_auto_minmax(0,1fr)] lg:overflow-hidden">
      <CapabilityRegistry
        capabilities={library.capabilities}
        error={library.error}
        loading={library.loading}
        runId={runId}
        selectedId={selected?.id}
        onSelect={(capabilityId) => void library.select(capabilityId)}
      />

      <main className="min-h-0 min-w-0 bg-[var(--color-paper)] lg:col-start-2 lg:row-start-3">
        {selected ? (
          <>
            <CapabilityDetail
              capability={selected}
              runId={runId}
              onConfigure={() => setSetupOpen(true)}
              onActivate={activateSelected}
              onDeactivate={deactivateSelected}
            />
            {actionError ? (
              <p
                role="alert"
                className="border-t border-border p-3 text-xs text-destructive-foreground"
              >
                {actionError}
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid h-full min-h-72 place-items-center px-6 text-center">
            <div>
              <Blocks
                aria-hidden="true"
                className="mx-auto size-6 text-muted-foreground"
              />
              <p className="mt-3 text-sm font-semibold">Select a capability.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Permissions and compatibility will appear here.
              </p>
            </div>
          </div>
        )}
      </main>

      {selected ? (
        <CapabilitySetupDialog
          capability={selected}
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onConfigure={library.configure}
        />
      ) : null}
    </section>
  );
};
