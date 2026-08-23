import { Check, ChevronDown, Search } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";

export type PickerOption = {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

type Props = {
  id?: string;
  ariaLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  display?: string;
  searchable?: boolean;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  triggerClassName?: string;
};

export const PickerMenu = ({
  id,
  ariaLabel,
  open,
  onOpenChange,
  options,
  value,
  onChange,
  display,
  searchable,
  disabled,
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  triggerClassName,
}: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.id === value);
  const label = display ?? selected?.label ?? "Select…";

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onOpenChange]);

  if (options.length === 0 && !display) return null;

  const filtered = query.trim()
    ? options.filter((option) =>
        `${option.label} ${option.hint ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : options;

  const commit = (id: string) => {
    const option = options.find((candidate) => candidate.id === id);
    if (option?.disabled) return;
    onChange(id);
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        for (let offset = 1; offset <= filtered.length; offset += 1) {
          const index =
            (current + direction * offset + filtered.length) % filtered.length;
          if (!filtered[index]?.disabled) return index;
        }
        return current;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.id);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-muted text-accent-foreground ring-1 ring-ring/60",
          triggerClassName,
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          className="absolute bottom-full left-0 z-30 mb-1.5 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-popover p-1 shadow-2xl ring-1 ring-white/[0.08]"
        >
          {searchable ? (
            <div className="relative mb-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={searchRef}
                type="text"
                role="searchbox"
                aria-label={`Filter ${ariaLabel}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-lg bg-muted/40 pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                {emptyLabel}
              </p>
            ) : (
              filtered.map((option, index) => {
                const isSelected = option.id === value;
                return (
                  <button
                    key={option.id}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    disabled={option.disabled}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => !option.disabled && commit(option.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      index === activeIndex && "bg-accent text-accent-foreground",
                      isSelected && "font-semibold",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0 text-primary",
                        !isSelected && "invisible",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {option.hint}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
