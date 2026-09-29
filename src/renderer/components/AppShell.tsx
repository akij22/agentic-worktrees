import { useEffect, useRef, useState } from "react";
import {
  Blocks,
  FolderGit2,
  GitPullRequestArrow,
  MessageSquareCode,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import appLogo from "../assets/agentic-worktrees-logo.png";
import { cn } from "../lib/utils";
import { RouteTransition } from "./RouteTransition";
import {
  clampNavSidebarWidth,
  isFullBleedWorkspace,
  NAV_SIDEBAR_DEFAULT_WIDTH,
  NAV_SIDEBAR_MAX_WIDTH,
  NAV_SIDEBAR_MIN_WIDTH,
  isNavSidebarCollapsed as isNavSidebarCompact,
} from "./app-shell-layout";

type NavItem = {
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
  placement: "main" | "footer";
};

export const navItems: NavItem[] = [
  {
    to: "/chat",
    label: "Chat",
    end: false,
    icon: MessageSquareCode,
    placement: "main",
  },
  {
    to: "/worktrees",
    label: "Worktrees",
    end: true,
    icon: FolderGit2,
    placement: "main",
  },
  {
    to: "/intelligence",
    label: "Intelligence",
    end: true,
    icon: GitPullRequestArrow,
    placement: "main",
  },
  {
    to: "/marketplace",
    label: "Marketplace",
    end: true,
    icon: Blocks,
    placement: "main",
  },
  {
    to: "/settings",
    label: "Settings",
    end: true,
    icon: Settings2,
    placement: "footer",
  },
];

export const findNavItem = (pathname: string): NavItem | undefined =>
  navItems.find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );

const SidebarNavItem = ({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) => {
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex h-10 items-center rounded-lg text-[13px] font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          collapsed ? "justify-center px-2" : "gap-3 px-3",
          isActive
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_8px_22px_-18px_rgba(138,180,248,0.75)]"
            : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )
      }
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon
          aria-hidden="true"
          className="size-[17px] stroke-[1.75] transition-colors group-aria-[current=page]:text-primary"
        />
      </span>
      {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
    </NavLink>
  );
};

export const AppShell = () => {
  const location = useLocation();
  const shellRef = useRef<HTMLDivElement>(null);
  const [navSidebarWidth, setNavSidebarWidth] = useState(
    NAV_SIDEBAR_DEFAULT_WIDTH,
  );
  const [isResizingNavSidebar, setIsResizingNavSidebar] = useState(false);
  const isFullBleed = isFullBleedWorkspace(location.pathname);
  const isNavSidebarCollapsed = isNavSidebarCompact(navSidebarWidth);

  useEffect(() => {
    if (!isResizingNavSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = shellRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setNavSidebarWidth(clampNavSidebarWidth(event.clientX - bounds.left));
    };
    const stopResizing = () => setIsResizingNavSidebar(false);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [isResizingNavSidebar]);

  return (
    <div
      ref={shellRef}
      className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
    >
      <aside
        style={{ width: `${navSidebarWidth}px` }}
        className="relative z-20 flex min-h-[20rem] w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[12px_0_32px_-28px_rgba(0,0,0,0.95)]"
      >
        <div
          className={`flex h-16 items-center ${
            isNavSidebarCollapsed ? "justify-center px-2" : "gap-2.5 px-5"
          }`}
        >
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#f5f3ee] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_7px_20px_-12px_rgba(0,0,0,0.9)]">
            <img
              src={appLogo}
              alt="Agentic Worktrees"
              className="h-full w-full object-cover"
            />
          </div>
          <span
            className={
              isNavSidebarCollapsed
                ? "sr-only"
                : "text-sm font-semibold tracking-[-0.018em] text-foreground"
            }
          >
            Agentic Worktrees
          </span>
        </div>
        <nav
          aria-label="Main navigation"
          className={`flex flex-1 flex-col gap-1 py-4 ${
            isNavSidebarCollapsed ? "px-2" : "px-3"
          }`}
        >
          {navItems
            .filter((item) => item.placement === "main")
            .map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={isNavSidebarCollapsed}
              />
            ))}
        </nav>

        <div className={`pb-3 ${isNavSidebarCollapsed ? "px-2" : "px-3"}`}>
          {navItems
            .filter((item) => item.placement === "footer")
            .map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={isNavSidebarCollapsed}
              />
            ))}
        </div>
      </aside>

      <div
        role="separator"
        aria-label="Resize main navigation"
        aria-orientation="vertical"
        aria-valuemin={NAV_SIDEBAR_MIN_WIDTH}
        aria-valuemax={NAV_SIDEBAR_MAX_WIDTH}
        aria-valuenow={navSidebarWidth}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setNavSidebarWidth((width) => clampNavSidebarWidth(width - 16));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setNavSidebarWidth((width) => clampNavSidebarWidth(width + 16));
          }
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          setIsResizingNavSidebar(true);
        }}
        className={`group relative z-10 -ml-px flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          isResizingNavSidebar
            ? "bg-primary/15"
            : "bg-transparent hover:bg-primary/10"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-10 w-px rounded-full transition-all ${
            isResizingNavSidebar
              ? "h-14 bg-primary"
              : "bg-border group-hover:h-14 group-hover:bg-primary/70"
          }`}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isFullBleed ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <RouteTransition pathname={location.pathname} className="h-full">
              <Outlet />
            </RouteTransition>
          </div>
        ) : (
          <>
            <header className="flex h-16 shrink-0 items-center px-6">
              <h1 className="text-base font-semibold tracking-tight">
                {findNavItem(location.pathname)?.label ?? "Chat"}
              </h1>
            </header>
            <div className="flex-1 overflow-auto p-6">
              <RouteTransition pathname={location.pathname} className="h-full">
                <Outlet />
              </RouteTransition>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
