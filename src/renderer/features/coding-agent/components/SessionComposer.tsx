import type { ChangeEvent, KeyboardEvent } from "react";
import type {
  CodingAgentModelDto,
  CodingAgentSessionDto,
} from "../../../../shared/ipc/schemas";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";

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
}: Props) => {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };
  const onModelSelect = (event: ChangeEvent<HTMLSelectElement>) =>
    onModelChange(event.target.value);
  return (
    <div className="border-t border-border bg-muted/15 p-4">
      <div className="rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the change you want OpenCode to make…"
          rows={3}
          disabled={locked}
          className="block w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-1 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <Select
              aria-label="AI model"
              value={modelKey}
              onChange={onModelSelect}
              disabled={
                loadingModels || changingModel || busy || models.length === 0
              }
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
          <Button size="sm" onClick={onSend} disabled={!draft.trim() || locked}>
            Send ↗
          </Button>
        </div>
      </div>
    </div>
  );
};
