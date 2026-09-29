import { useMemo, useState } from "react";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentKindDto,
} from "../../../../shared/ipc/schemas";
import { PickerMenu, type PickerOption } from "./PickerMenu";

export type HarnessChoice = {
  kind: CodingAgentKindDto;
};

type Props = {
  installations: CodingAgentInstallationStatusDto[];
  selectedKind?: CodingAgentKindDto;
  onSelect: (kind: CodingAgentKindDto) => void;
  disabled?: boolean;
};

/**
 * The landing has no session yet, so the harness cannot be read from one.
 * This chip is the place where it is chosen, and choosing it is also the
 * moment the thread is created.
 */
export const HarnessModelPicker = ({
  installations,
  selectedKind,
  onSelect,
  disabled,
}: Props) => {
  const [open, setOpen] = useState(false);

  const options = useMemo<PickerOption[]>(
    () =>
      installations.map((installation) => ({
        id: installation.kind,
        label: installation.name,
        hint: installation.version ?? undefined,
        group: installation.name,
        disabled: !installation.configured,
      })),
    [installations],
  );

  const selected = installations.find(
    (installation) => installation.kind === selectedKind,
  );
  const anyConfigured = installations.some(
    (installation) => installation.configured,
  );

  return (
    <PickerMenu
      ariaLabel="Coding agent"
      open={open}
      onOpenChange={setOpen}
      options={options}
      value={selectedKind ?? ""}
      onChange={(id) => onSelect(id as CodingAgentKindDto)}
      display={selected?.name ?? "Select a coding agent…"}
      emptyLabel="No coding agents are available"
      disabled={disabled || options.length === 0 || !anyConfigured}
      triggerClassName="session-composer__picker max-w-52"
    />
  );
};
