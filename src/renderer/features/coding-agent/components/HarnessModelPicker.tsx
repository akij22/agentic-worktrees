import { useMemo, useState } from "react";
import type {
  CodingAgentInstallationStatusDto,
  CodingAgentKindDto,
  CodingAgentModelDto,
} from "../../../../shared/ipc/schemas";
import { PickerMenu, type PickerOption } from "./PickerMenu";

type Props = {
  installations: CodingAgentInstallationStatusDto[];
  modelsByKind: Partial<Record<CodingAgentKindDto, CodingAgentModelDto[]>>;
  selectedKind?: CodingAgentKindDto;
  selectedModel?: CodingAgentModelDto;
  loadingModels?: boolean;
  errorMessage?: string;
  onSelect: (kind: CodingAgentKindDto, model: CodingAgentModelDto) => void;
  disabled?: boolean;
};

type PickerStage = "harness" | "model";

const modelKey = (kind: CodingAgentKindDto, model: CodingAgentModelDto) =>
  `${kind}::${model.providerId}::${model.modelId}`;

/** A compact two-step selector for the harness and the model that starts a thread. */
export const HarnessModelPicker = ({
  installations,
  modelsByKind,
  selectedKind,
  selectedModel,
  loadingModels = false,
  errorMessage,
  onSelect,
  disabled,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<PickerStage>("harness");
  const [pendingKind, setPendingKind] = useState<CodingAgentKindDto | undefined>(
    selectedKind,
  );

  const selectedHarness = installations.find(
    (installation) => installation.kind === selectedKind,
  );
  const modelOptions = useMemo<PickerOption[]>(() => {
    if (!pendingKind) return [];
    return (modelsByKind[pendingKind] ?? []).map((model) => ({
      id: modelKey(pendingKind, model),
      label: model.modelName,
      hint: model.isDefault ? "Default" : model.modelId,
      group: model.providerName,
    }));
  }, [modelsByKind, pendingKind]);
  const harnessOptions = useMemo<PickerOption[]>(
    () =>
      installations.map((installation) => ({
        id: installation.kind,
        label: installation.name,
        hint: installation.configured
          ? installation.version ?? "Ready"
          : "Not configured",
        group: "Provider",
        disabled: !installation.configured,
      })),
    [installations],
  );

  const openPicker = (nextOpen: boolean) => {
    if (nextOpen) {
      setPendingKind(selectedKind);
      setStage("harness");
    }
    setOpen(nextOpen);
  };
  const chooseHarness = (kind: string) => {
    if (kind !== "codex" && kind !== "opencode") return;
    setPendingKind(kind);
    setStage("model");
  };
  const chooseModel = (id: string) => {
    if (!pendingKind) return;
    const model = (modelsByKind[pendingKind] ?? []).find(
      (candidate) => modelKey(pendingKind, candidate) === id,
    );
    if (!model) return;
    onSelect(pendingKind, model);
    setOpen(false);
  };

  return (
    <PickerMenu
      key={`${stage}:${pendingKind ?? "none"}`}
      ariaLabel="Provider and model"
      open={open}
      onOpenChange={openPicker}
      options={stage === "harness" ? harnessOptions : modelOptions}
      value={
        stage === "harness"
          ? selectedKind ?? ""
          : pendingKind && pendingKind === selectedKind && selectedModel
            ? modelKey(pendingKind, selectedModel)
            : ""
      }
      onChange={stage === "harness" ? chooseHarness : chooseModel}
      display={
        selectedHarness && selectedModel
          ? `${selectedHarness.name} · ${selectedModel.modelName}`
          : loadingModels
            ? "Loading models…"
            : "Choose provider and model…"
      }
      title={
        stage === "harness"
          ? "Choose a provider"
          : `${installations.find(({ kind }) => kind === pendingKind)?.name ?? "Provider"} models`
      }
      onBack={stage === "model" ? () => setStage("harness") : undefined}
      closeOnChange={stage === "model"}
      searchable
      searchPlaceholder={
        stage === "harness" ? "Find a provider…" : "Find a model…"
      }
      emptyLabel={
        loadingModels
          ? "Loading models…"
          : stage === "model"
            ? "No models available for this provider"
            : "No providers available"
      }
      state={errorMessage ? "error" : selectedModel ? "success" : undefined}
      description={errorMessage}
      disabled={disabled || installations.every(({ configured }) => !configured)}
      triggerClassName="session-composer__picker max-w-64"
    />
  );
};
