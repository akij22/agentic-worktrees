import { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  FolderGit2,
  GitPullRequestArrow,
  MessageSquareCode,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import appLogo from '../assets/agentic-worktrees-logo.png';
import { cn } from '../lib/utils';
import { RouteTransition } from './RouteTransition';
import {
  clampDashboardSidebarWidth,
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  DASHBOARD_SIDEBAR_MAX_WIDTH,
  DASHBOARD_SIDEBAR_MIN_WIDTH,
  isDashboardSidebarCollapsed as isDashboardSidebarCompact,
  isDashboardWorkspace,
} from './app-shell-layout';

type NavItem = {
  to: string;
  label: string;
  end: boolean;
  icon: LucideIcon;
  placement: 'main' | 'footer';
};

const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: FolderGit2,
    placement: 'main',
  },
  {
    to: '/coding-agent',
    label: 'Coding Agent',
    end: false,
    icon: MessageSquareCode,
    placement: 'main',
  },
  {
    to: '/capabilities',
    label: 'Capabilities',
    end: false,
    icon: Blocks,
    placement: 'main',
  },
  {
    to: '/intelligence',
    label: 'Intelligence',
    end: false,
    icon: GitPullRequestArrow,
    placement: 'main',
  },
  {
    to: '/settings',
    label: 'Settings',
    end: false,
    icon: Settings2,
    placement: 'footer',
  },
];

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
          'group flex h-10 items-center rounded-lg text-[13px] font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60',
          collapsed ? 'justify-center px-2' : 'gap-3 px-3',
          isActive
            ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_8px_22px_-18px_rgba(138,180,248,0.75)]'
            : 'text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
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
  const [dashboardSidebarWidth, setDashboardSidebarWidth] = useState(
    DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  );
  const [isResizingDashboardSidebar, setIsResizingDashboardSidebar] = useState(false);
  const isCodingAgentSession = /^\/coding-agent\/[^/]+\/[^/]+$/.test(
    location.pathname,
  );
  const isDashboard = isDashboardWorkspace(location.pathname);
  const isDashboardSidebarCollapsed = isDashboardSidebarCompact(
    dashboardSidebarWidth,
  );

  useEffect(() => {
    if (!isResizingDashboardSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = shellRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setDashboardSidebarWidth(
        clampDashboardSidebarWidth(event.clientX - bounds.left),
      );
    };
    const stopResizing = () => setIsResizingDashboardSidebar(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [isResizingDashboardSidebar]);

  return (
    <div ref={shellRef} className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside
        style={{ width: `${dashboardSidebarWidth}px` }}
        className="relative z-20 flex min-h-[20rem] w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[12px_0_32px_-28px_rgba(0,0,0,0.95)]"
      >
        <div
          className={`flex h-16 items-center ${
            isDashboardSidebarCollapsed
              ? 'justify-center px-2'
              : 'gap-2.5 px-5'
          }`}
        >
          <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#f5f3ee] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_7px_20px_-12px_rgba(0,0,0,0.9)]">
            <img src={appLogo} alt="Agentic Worktrees" className="h-full w-full object-cover" />
          </div>
          <span
            className={
              isDashboardSidebarCollapsed
                ? 'sr-only'
                : 'text-sm font-semibold tracking-[-0.018em] text-foreground'
            }
          >
            Agentic Worktrees
          </span>
        </div>
        <nav
          aria-label="Main navigation"
          className={`flex flex-1 flex-col gap-1 py-4 ${
            isDashboardSidebarCollapsed ? 'px-2' : 'px-3'
          }`}
        >
          {navItems
            .filter((item) => item.placement === 'main')
            .map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={isDashboardSidebarCollapsed}
              />
            ))}
        </nav>

        <div
          className={`pb-3 ${isDashboardSidebarCollapsed ? 'px-2' : 'px-3'}`}
        >
          {navItems
            .filter((item) => item.placement === 'footer')
            .map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={isDashboardSidebarCollapsed}
              />
            ))}
        </div>

      </aside>

      <div
          role="separator"
          aria-label="Resize main navigation"
          aria-orientation="vertical"
          aria-valuemin={DASHBOARD_SIDEBAR_MIN_WIDTH}
          aria-valuemax={DASHBOARD_SIDEBAR_MAX_WIDTH}
          aria-valuenow={dashboardSidebarWidth}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setDashboardSidebarWidth((width) =>
                clampDashboardSidebarWidth(width - 16),
              );
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setDashboardSidebarWidth((width) =>
                clampDashboardSidebarWidth(width + 16),
              );
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            setIsResizingDashboardSidebar(true);
          }}
          className={`group relative z-10 -ml-px flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            isResizingDashboardSidebar
              ? 'bg-primary/15'
              : 'bg-transparent hover:bg-primary/10'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-10 w-px rounded-full transition-all ${
              isResizingDashboardSidebar
                ? 'h-14 bg-primary'
                : 'bg-border group-hover:h-14 group-hover:bg-primary/70'
            }`}
          />
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isDashboard ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <RouteTransition pathname={location.pathname} className="h-full">
              <Outlet />
            </RouteTransition>
          </div>
        ) : (
          <>
            {!isCodingAgentSession ? (
              <header className="flex h-16 shrink-0 items-center px-6">
                <h1 className="text-base font-semibold tracking-tight">
                  {navItems.find((i) =>
                    i.end ? i.to === location.pathname : location.pathname.startsWith(i.to),
                  )?.label ?? 'Dashboard'}
                </h1>
              </header>
            ) : null}
            <div
              className={
                isCodingAgentSession
                  ? 'min-h-0 flex-1 overflow-hidden'
                  : 'flex-1 overflow-auto p-6'
              }
            >
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
