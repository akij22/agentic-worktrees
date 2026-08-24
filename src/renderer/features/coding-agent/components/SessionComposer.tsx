import {
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
import { PickerMenu } from "./PickerMenu";
import {
  filterSlashCommands,
  type SlashCommandId,
} from "../lib/slash-commands";
import {
  findActiveFileMention,
  insertFileMention,
} from "../lib/file-mentions";
import { useFileMentionSuggestions } from "../hooks/useFileMentionSuggestions";

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
  onSlashCommand: (command: SlashCommandId) => void;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | undefined>(undefined);
  const [caret, setCaret] = useState(draft.length);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [reasoningPickerOpen, setReasoningPickerOpen] = useState(false);
  const slashCommands = filterSlashCommands(draft);
  const detectedMention =
    slashCommands.length === 0
      ? findActiveFileMention(draft, caret)
      : undefined;
  const mentionKey = detectedMention
    ? `${detectedMention.start}:${detectedMention.end}:${detectedMention.query}`
    : undefined;
  const activeMention =
    mentionKey && mentionKey !== dismissedMentionKey
      ? detectedMention
      : undefined;
  const fileSuggestions = useFileMentionSuggestions({
    worktreeId: session.worktreeId,
    mention: activeMention,
  });
  const filePaletteOpen = Boolean(activeMention);
  const selectableCount =
    slashCommands.length > 0 ? slashCommands.length : fileSuggestions.paths.length;

  useEffect(
    () => setSelectedSuggestionIndex(0),
    [draft, fileSuggestions.paths.join("\0")],
  );
  useEffect(() => {
    const nextCaret = pendingCaretRef.current;
    if (nextCaret === undefined) return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(nextCaret, nextCaret);
    setCaret(nextCaret);
    pendingCaretRef.current = undefined;
  }, [draft]);
  const executeSlashCommand = (command: SlashCommandId) => {
    onDraftChange("");
    if (command === "model") {
      setModelPickerOpen(true);
      return;
    }
    onSlashCommand(command);
  };
  const selectFile = (path: string) => {
    if (!activeMention) return;
    const next = insertFileMention(draft, activeMention, path);
    pendingCaretRef.current = next.caret;
    setDismissedMentionKey(undefined);
    onDraftChange(next.draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashCommands.length > 0 || filePaletteOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (selectableCount === 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedSuggestionIndex((current) =>
          (current + direction + selectableCount) % selectableCount,
        );
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        const selectedCommand = slashCommands[selectedSuggestionIndex];
        if (selectedCommand) executeSlashCommand(selectedCommand.id);
        const selectedPath = fileSuggestions.paths[selectedSuggestionIndex];
        if (slashCommands.length === 0 && selectedPath) selectFile(selectedPath);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (slashCommands.length > 0) {
          onDraftChange("");
        } else if (mentionKey) {
          setDismissedMentionKey(mentionKey);
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };
  const modelOptions = models.map((model) => ({
    id: `${model.providerId}::${model.modelId}`,
    label: model.modelName,
    hint: model.providerName,
  }));
  const selectedModel = models.find(
    (model) => `${model.providerId}::${model.modelId}` === modelKey,
  );
  const reasoningOptions = [
    { id: "", label: "Default" },
    ...reasoningVariants.map((variant) => ({
      id: variant,
      label: variant.charAt(0).toUpperCase() + variant.slice(1),
    })),
  ];
  const submit = () => {
    const selectedCommand = slashCommands[selectedSuggestionIndex];
    if (selectedCommand) {
      executeSlashCommand(selectedCommand.id);
      return;
    }
    const selectedPath = fileSuggestions.paths[selectedSuggestionIndex];
    if (filePaletteOpen && selectedPath) {
      selectFile(selectedPath);
      return;
    }
    onSend();
  };
  return (
    <div className="relative bg-background px-4 pb-4 pt-2">
      {slashCommands.length > 0 ? (
        <div
          role="listbox"
          aria-label="Session slash commands"
          className="absolute bottom-[calc(100%-0.25rem)] left-4 right-4 z-20 overflow-hidden rounded-lg border border-white/[0.075] bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
        >
          {slashCommands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === selectedSuggestionIndex}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                index === selectedSuggestionIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedSuggestionIndex(index)}
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
          <p className="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
            ↑↓ navigate · Enter select · Esc close
          </p>
        </div>
      ) : filePaletteOpen ? (
        <div
          role="listbox"
          aria-label="Worktree files"
          className="absolute bottom-[calc(100%-0.25rem)] left-4 right-4 z-20 max-h-72 overflow-auto rounded-lg border border-white/[0.075] bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
        >
          {fileSuggestions.loading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Searching worktree files…
            </p>
          ) : fileSuggestions.error ? (
            <p
              className="px-3 py-2 text-xs text-destructive"
              title={fileSuggestions.error}
            >
              Could not search worktree files.
            </p>
          ) : fileSuggestions.paths.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matching files
            </p>
          ) : (
            fileSuggestions.paths.map((path, index) => (
              <button
                key={path}
                type="button"
                role="option"
                aria-label={path}
                aria-selected={index === selectedSuggestionIndex}
                className={`block w-full truncate rounded-xl px-3 py-2 text-left font-mono text-xs transition-colors ${
                  index === selectedSuggestionIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
                title={path}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSelectedSuggestionIndex(index)}
                onClick={() => selectFile(path)}
              >
                {path}
              </button>
            ))
          )}
          <p className="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
            ↑↓ navigate · Enter select · Esc close
          </p>
        </div>
      ) : null}
      <div className="rounded-xl border border-white/[0.085] bg-[#090a0c] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_22px_52px_-34px_rgba(0,0,0,0.95)] transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setCaret(event.target.selectionStart);
            setDismissedMentionKey(undefined);
            onDraftChange(event.target.value);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          placeholder={`Describe the change you want ${session.agentName} to make…`}
          rows={3}
          disabled={locked}
          className="block w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-placeholder disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3 px-1 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <PickerMenu
              ariaLabel="AI model"
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              options={
                loadingModels
                  ? [{ id: modelKey, label: "Loading models…" }]
                  : modelOptions.length > 0
                    ? modelOptions
                    : [
                        {
                          id: `${session.providerId}::${session.modelId}`,
                          label: session.modelId,
                          hint: session.providerId,
                        },
                      ]
              }
              value={modelKey}
              onChange={onModelChange}
              display={
                loadingModels
                  ? "Loading models…"
                  : selectedModel
                    ? selectedModel.modelName
                    : session.modelId
              }
              searchable
              searchPlaceholder="Search models…"
              emptyLabel="No matching models"
              disabled={loadingModels || changingModel || models.length === 0}
              triggerClassName="max-w-52"
            />
            {reasoningVariants.length > 0 ? (
              <PickerMenu
                ariaLabel="Reasoning level"
                open={reasoningPickerOpen}
                onOpenChange={setReasoningPickerOpen}
                options={reasoningOptions}
                value={reasoningVariant}
                onChange={onReasoningChange}
                display={
                  reasoningVariant
                    ? reasoningVariant.charAt(0).toUpperCase() +
                      reasoningVariant.slice(1)
                    : "Reasoning · default"
                }
                disabled={locked}
                triggerClassName="max-w-40"
              />
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
