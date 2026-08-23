import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";

export interface DropdownMenuItem<T extends string> {
  id: T;
  label: string;
  iconSrc?: string;
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
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.065] bg-surface-raised/65 px-3 text-xs font-semibold text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {label}
        <ChevronDown aria-hidden="true" className="size-3.5 stroke-[1.8]" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-10 mt-1.5 min-w-48 rounded-lg border border-white/[0.075] bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl"
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
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
            >
              {item.iconSrc && (
                <span
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 shrink-0 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
                  style={{
                    maskImage: `url(${item.iconSrc})`,
                    WebkitMaskImage: `url(${item.iconSrc})`,
                  }}
                />
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
