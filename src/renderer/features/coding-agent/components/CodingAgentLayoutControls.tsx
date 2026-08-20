import type { Ref } from "react";
import { Button } from "../../../components/ui/button";

export type CodingAgentLayoutMode = "single" | "dual";

type Props = {
  mode: CodingAgentLayoutMode;
  onModeChange: (mode: CodingAgentLayoutMode) => void;
  dualButtonRef?: Ref<HTMLButtonElement>;
};

const SinglePanelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.8" />
  </svg>
);

const DualPanelIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.8" />
    <path d="M12 4v16" strokeWidth="1.8" />
  </svg>
);

export const CodingAgentLayoutControls = ({
  mode,
  onModeChange,
  dualButtonRef,
}: Props) => (
  <div
    role="group"
    aria-label="Chat layout"
    className="inline-flex items-center rounded-xl bg-surface-raised/65 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
  >
    <Button
      type="button"
      size="icon"
      variant={mode === "single" ? "secondary" : "ghost"}
      className="h-8 w-8"
      aria-label="Single chat view"
      aria-pressed={mode === "single"}
      title="Single chat view"
      onClick={() => onModeChange("single")}
    >
      <SinglePanelIcon />
    </Button>
    <Button
      ref={dualButtonRef}
      type="button"
      size="icon"
      variant={mode === "dual" ? "secondary" : "ghost"}
      data-layout-control="dual"
      className="h-8 w-8"
      aria-label="Dual chat view"
      aria-pressed={mode === "dual"}
      title="Dual chat view"
      onClick={() => onModeChange("dual")}
    >
      <DualPanelIcon />
    </Button>
  </div>
);
