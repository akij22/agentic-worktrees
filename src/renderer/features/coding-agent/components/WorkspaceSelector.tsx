import { Dialog } from "@base-ui/react/dialog";
import { Check, ChevronDown, Folder, GitBranch, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";
import "./WorkspaceSelector.css";

type Props = {
  contexts: CodingAgentWorktreeContextDto[];
  value?: string;
  onChange: (worktreeId: string) => void;
};

export const WorkspaceSelector = ({ contexts, value, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selected = contexts.find(({ worktree }) => worktree.id === value);
  const filtered = contexts.filter(({ repository, worktree }) =>
    `${repository.name} ${worktree.name} ${worktree.branchName} ${worktree.kind === "primary" ? "Main checkout" : ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const active = filtered[activeIndex];

  useEffect(() => {
    if (open)
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActiveIndex(
            Math.max(
              0,
              contexts.findIndex(({ worktree }) => worktree.id === value),
            ),
          );
        }
      }}
    >
      <Dialog.Trigger
        aria-label="Current checkout"
        className="workspace-selector__trigger"
      >
        <span>
          {selected
            ? selected.worktree.kind === "primary"
              ? "Main checkout"
              : selected.worktree.name
            : "Select a workspace…"}
        </span>
        <ChevronDown aria-hidden="true" size={12} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="workspace-selector__backdrop" />
        <Dialog.Popup
          aria-modal="true"
          className="workspace-selector"
          initialFocus={searchRef}
        >
          <header className="workspace-selector__header">
            <div>
              <Dialog.Title className="workspace-selector__title">
                Select a project
              </Dialog.Title>
              <Dialog.Description className="workspace-selector__description">
                Choose the workspace for your chat.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close project selector"
              className="workspace-selector__close"
            >
              <X aria-hidden="true" size={16} />
            </Dialog.Close>
          </header>
          <div className="workspace-selector__search">
            <Search aria-hidden="true" size={16} />
            <input
              ref={searchRef}
              role="combobox"
              aria-label="Search projects and workspaces"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={
                active ? `${listId}-${active.worktree.id}` : undefined
              }
              value={query}
              placeholder="Search projects, workspaces or branches…"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (filtered.length)
                    setActiveIndex(
                      (index) =>
                        (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          filtered.length) %
                        filtered.length,
                    );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (active) select(active.worktree.id);
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Project workspaces"
            className="workspace-selector__results"
          >
            {filtered.map(({ repository, worktree }, index) => (
              <div key={worktree.id} role="presentation">
                {repository.id !== filtered[index - 1]?.repository.id ? (
                  <div
                    className="workspace-selector__project"
                    role="presentation"
                  >
                    <Folder aria-hidden="true" size={14} />
                    <span>{repository.name}</span>
                  </div>
                ) : null}
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  id={`${listId}-${worktree.id}`}
                  type="button"
                  role="option"
                  aria-label={`${repository.name}, ${worktree.kind === "primary" ? "Main checkout" : worktree.name}, ${worktree.branchName}`}
                  aria-selected={worktree.id === value}
                  tabIndex={-1}
                  className="workspace-selector__option"
                  data-active={index === activeIndex || undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(worktree.id)}
                >
                  <span className="workspace-selector__details">
                    <span className="workspace-selector__name">
                      {worktree.kind === "primary"
                        ? "Main checkout"
                        : worktree.name}
                    </span>
                    <span className="workspace-selector__branch">
                      <GitBranch aria-hidden="true" size={12} />
                      <span>{worktree.branchName}</span>
                    </span>
                  </span>
                  {worktree.id === value ? (
                    <Check
                      aria-hidden="true"
                      size={16}
                      className="workspace-selector__check"
                    />
                  ) : null}
                </button>
              </div>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="workspace-selector__empty" role="status">
              <Search aria-hidden="true" size={20} />
              <p>No matching workspaces</p>
              <span>Try another project or branch name.</span>
            </div>
          ) : null}
          <footer className="workspace-selector__footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>esc</kbd> Close
            </span>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
