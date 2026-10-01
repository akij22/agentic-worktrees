import { Blocks, MessageSquare, Settings2 } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { DropdownMenu } from "./ui/dropdown-menu";

const primaryDestinations = [
  { to: "/chat", label: "Threads", icon: MessageSquare },
  { to: "/marketplace", label: "Marketplace", icon: Blocks },
];

const secondaryDestinations = [
  { id: "/worktrees", label: "Worktrees" },
  { id: "/intelligence", label: "Intelligence" },
];

export const findPageLabel = (pathname: string): string | undefined => {
  if (pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/")) {
    return "Threads";
  }
  if (pathname === "/settings") return "Settings";
  return [...primaryDestinations, ...secondaryDestinations.map((item) => ({
    to: item.id,
    label: item.label,
  }))].find((item) => item.to === pathname)?.label;
};

export const AppNavigation = () => {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Main navigation" className="shrink-0 px-3 pt-3 pb-2">
      <div className="flex rounded-lg border border-sidebar-border bg-background/60 p-0.5">
        {primaryDestinations.map(({ to, label, icon: Icon }) => {
          const active = to === "/chat"
            ? pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/")
            : pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 stroke-[1.75]" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export const AppNavigationFooter = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentSecondary = secondaryDestinations.find((item) => item.id === pathname);

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2">
      <NavLink
        to="/settings"
        className={({ isActive }) => cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Settings2 aria-hidden="true" className="size-4 stroke-[1.75]" />
        Settings
      </NavLink>
      <DropdownMenu
        label={currentSecondary?.label ?? "More"}
        items={secondaryDestinations}
        onSelect={(to) => navigate(to)}
      />
    </div>
  );
};
