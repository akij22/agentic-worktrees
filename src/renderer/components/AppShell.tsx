import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import appLogo from '../assets/agentic-worktrees-logo.png';
import commentIcon from '../../../docs/assets/comment.png';
import folderIcon from '../../../docs/assets/folder.png';
import pullIcon from '../../../docs/assets/pull.png';
import settingIcon from '../../../docs/assets/setting.png';
import { RouteTransition } from './RouteTransition';
import {
  clampDashboardSidebarWidth,
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  DASHBOARD_SIDEBAR_MAX_WIDTH,
  DASHBOARD_SIDEBAR_MIN_WIDTH,
  isDashboardSidebarCollapsed as isDashboardSidebarCompact,
  isDashboardWorkspace,
} from './app-shell-layout';

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: folderIcon,
    /* icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ), */
  },
  {
    to: '/coding-agent',
    label: 'Coding Agent',
    end: false,
    icon: commentIcon,
    /* icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M8 9 5 12l3 3M16 9l3 3-3 3M14 5l-4 14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ), */
  },
  {
    to: '/intelligence',
    label: 'Intelligence',
    end: false,
    icon: pullIcon,
    /* icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="5" cy="12" r="2.5" />
        <circle cx="18" cy="5" r="2.5" />
        <circle cx="18" cy="19" r="2.5" />
        <path d="m7.3 10.8 8.4-4.6M7.3 13.2l8.4 4.6" strokeLinecap="round" />
      </svg>
    ), */
  },
  {
    to: '/settings',
    label: 'Settings',
    end: false,
    icon: settingIcon,
    /* icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.3 2.3-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20.5h-3.25v-.1A1.7 1.7 0 0 0 10.23 18.84a1.7 1.7 0 0 0-1.88.34l-.06.06-2.3-2.3.06-.06A1.7 1.7 0 0 0 6.39 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-3.25h.1A1.7 1.7 0 0 0 6.39 9.67a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.3-2.3.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.1h3.25v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.3 2.3-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.1v3.25h-.1A1.7 1.7 0 0 0 19.4 15Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ), */
  },
];

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
        className="relative z-20 flex min-h-[20rem] w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground shadow-[16px_0_40px_-36px_rgba(112,185,238,0.4)]"
      >
        <div
          className={`flex h-16 items-center ${
            isDashboardSidebarCollapsed
              ? 'justify-center px-2'
              : 'gap-2.5 px-5'
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#f8f5ef] shadow-sm">
            <img src={appLogo} alt="" aria-hidden="true" className="h-full w-full object-cover" />
          </div>
          <span
            className={
              isDashboardSidebarCollapsed
                ? 'sr-only'
                : 'font-semibold tracking-tight text-foreground'
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
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={isDashboardSidebarCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex h-10 items-center rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring ${
                  isDashboardSidebarCollapsed
                    ? 'justify-center px-2'
                    : 'gap-3 px-3'
                } ${
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`
              }
            >
              <span className="h-5 w-5 shrink-0">
                <img
                  src={item.icon}
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-contain brightness-0 invert"
                />
              </span>
              {isDashboardSidebarCollapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                item.label
              )}
            </NavLink>
          ))}
        </nav>

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
