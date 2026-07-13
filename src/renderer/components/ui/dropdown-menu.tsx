import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export interface DropdownMenuItem<T extends string> {
  id: T;
  label: string;
}

interface DropdownMenuProps<T extends string> {
  label: string;
  items: DropdownMenuItem<T>[];
  onSelect: (id: T) => void;
  className?: string;
}

export const DropdownMenu = <T extends string>({
  label,
  items,
  onSelect,
  className,
}: DropdownMenuProps<T>) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuItemRefs.current[0]?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-10 mt-1 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                menuItemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
              onKeyDown={(event) => {
                const focusItem = (nextIndex: number) =>
                  menuItemRefs.current[nextIndex]?.focus();
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusItem((index + 1) % items.length);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusItem((index - 1 + items.length) % items.length);
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  focusItem(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  focusItem(items.length - 1);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
