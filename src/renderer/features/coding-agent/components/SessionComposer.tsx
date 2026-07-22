import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  CodingAgentModelDto,
  CodingAgentSessionDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import {
  filterOpenCodeSlashCommands,
  type OpenCodeSlashCommandId,
} from "../lib/slash-commands";

type Props = {
  session: CodingAgentSessionDto;
  draft: string;
  models: CodingAgentModelDto[];
  modelKey: string;
  reasoningVariant: string;
  reasoningVariants: string[];
  loadingModels: boolean;
  changingModel: boolean;
  busy: boolean;
  locked: boolean;
  onDraftChange: (draft: string) => void;
  onModelChange: (key: string) => void;
  onReasoningChange: (variant: string) => void;
  onSend: () => void;
  onStop: () => void;
  onSlashCommand: (command: OpenCodeSlashCommandId) => void;
};

export const SessionComposer = ({
  session,
  draft,
  models,
  modelKey,
  reasoningVariant,
  reasoningVariants,
  loadingModels,
  changingModel,
  busy,
  locked,
  onDraftChange,
  onModelChange,
  onReasoningChange,
  onSend,
  onStop,
  onSlashCommand,
}: Props) => {
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const slashCommands =
    session.agentKind === "opencode"
      ? filterOpenCodeSlashCommands(draft)
      : [];
  useEffect(() => setSelectedCommandIndex(0), [draft]);
  const executeSlashCommand = (command: OpenCodeSlashCommandId) => {
    onDraftChange("");
    if (command === "model") {
      const select = modelSelectRef.current;
      select?.focus();
      if (select && "showPicker" in select) {
        try {
          select.showPicker();
        } catch {
          // Keeping focus on the select provides a keyboard-accessible fallback.
        }
      }
      return;
    }
    onSlashCommand(command);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashCommands.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedCommandIndex((current) =>
          (current + direction + slashCommands.length) % slashCommands.length,
        );
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        const selected = slashCommands[selectedCommandIndex];
        if (selected) executeSlashCommand(selected.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDraftChange("");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };
  const onModelSelect = (event: ChangeEvent<HTMLSelectElement>) =>
    onModelChange(event.target.value);
  const submit = () => {
    const selected = slashCommands[selectedCommandIndex];
    if (selected) {
      executeSlashCommand(selected.id);
      return;
    }
    onSend();
  };
  return (
    <div className="relative border-t border-border bg-muted/15 p-4">
      {slashCommands.length > 0 ? (
        <div
          role="listbox"
          aria-label="OpenCode slash commands"
          className="absolute bottom-[calc(100%-0.25rem)] left-4 right-4 z-20 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {slashCommands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selectedCommandIndex}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                index === selectedCommandIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedCommandIndex(index)}
              onClick={() => executeSlashCommand(command.id)}
            >
              <span className="w-20 shrink-0 font-mono text-xs font-semibold">
                {command.label}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {command.description}
              </span>
            </button>
          ))}
          <p className="border-t border-border px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
            ↑↓ navigate · Enter select · Esc close
          </p>
        </div>
      ) : null}
      <div className="rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Describe the change you want ${session.agentName} to make…`}
          rows={3}
          disabled={locked}
          className="block w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-1 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <Select
              ref={modelSelectRef}
              aria-label="AI model"
              value={modelKey}
              onChange={onModelSelect}
              disabled={loadingModels || changingModel || models.length === 0}
              className="h-7 w-44 border-border bg-muted/40 px-2 font-mono text-[11px] shadow-none"
            >
              {loadingModels ? <option>Loading models…</option> : null}
              {!loadingModels && models.length === 0 ? (
                <option value={`${session.providerId}::${session.modelId}`}>
                  {session.providerId}/{session.modelId}
                </option>
              ) : null}
              {models.map((model) => (
                <option
                  key={`${model.providerId}:${model.modelId}`}
                  value={`${model.providerId}::${model.modelId}`}
                >
                  {model.providerName} · {model.modelName}
                </option>
              ))}
            </Select>
            {reasoningVariants.length > 0 ? (
              <Select
                aria-label="Reasoning level"
                value={reasoningVariant}
                onChange={(event) => onReasoningChange(event.target.value)}
                disabled={locked}
                className="h-7 w-32 border-border bg-muted/40 px-2 font-mono text-[11px] capitalize shadow-none"
              >
                <option value="">Reasoning · default</option>
                {reasoningVariants.map((variant) => (
                  <option key={variant} value={variant} className="capitalize">
                    Reasoning · {variant}
                  </option>
                ))}
              </Select>
            ) : null}
            <span className="hidden text-xs text-muted-foreground 2xl:inline">
              Enter to send · Shift + Enter for newline
            </span>
          </div>
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              aria-label={`Stop ${session.agentName}`}
              title={`Stop ${session.agentName}`}
              onClick={onStop}
            >
              <span
                aria-hidden="true"
                className="size-3 rounded-[1px] bg-current"
              />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={!draft.trim() || locked}
            >
              Send ↗
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
