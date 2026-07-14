import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../lib/use-theme';
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
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    to: '/coding-agent',
    label: 'Coding Agent',
    end: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M8 9 5 12l3 3M16 9l3 3-3 3M14 5l-4 14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    end: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.3 2.3-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20.5h-3.25v-.1A1.7 1.7 0 0 0 10.23 18.84a1.7 1.7 0 0 0-1.88.34l-.06.06-2.3-2.3.06-.06A1.7 1.7 0 0 0 6.39 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-3.25h.1A1.7 1.7 0 0 0 6.39 9.67a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.3-2.3.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.1h3.25v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.3 2.3-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.1v3.25h-.1A1.7 1.7 0 0 0 19.4 15Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export const AppShell = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
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
        className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <div
          className={`flex h-16 items-center border-b border-sidebar-border ${
            isDashboardSidebarCollapsed
              ? 'justify-center px-2'
              : 'gap-2.5 px-5'
          }`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground shadow-sm">
            AW
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
              <span className="h-5 w-5 shrink-0">{item.icon}</span>
              {isDashboardSidebarCollapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                item.label
              )}
            </NavLink>
          ))}
        </nav>

        <div
          className={`border-t border-sidebar-border ${
            isDashboardSidebarCollapsed ? 'p-2' : 'p-3'
          }`}
        >
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
            title={theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
            className={`inline-flex h-10 w-full items-center rounded-md text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring ${
              isDashboardSidebarCollapsed
                ? 'justify-center px-2'
                : 'gap-3 px-3'
            }`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {theme === 'dark' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
                </>
              ) : (
                <path d="M20.5 15.6A8.5 8.5 0 0 1 8.4 3.5 8.5 8.5 0 1 0 20.5 15.6Z" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
            {isDashboardSidebarCollapsed ? (
              <span className="sr-only">
                {theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </span>
            ) : (
              theme === 'dark' ? 'Light theme' : 'Dark theme'
            )}
          </button>
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
            <Outlet />
          </div>
        ) : (
          <>
            <header className="flex h-16 shrink-0 items-center border-b border-border px-6">
              <h1 className="text-base font-semibold tracking-tight">
                {navItems.find((i) =>
                  i.end ? i.to === location.pathname : location.pathname.startsWith(i.to),
                )?.label ?? 'Dashboard'}
              </h1>
            </header>
            <div
              className={
                isCodingAgentSession
                  ? 'min-h-0 flex-1 overflow-hidden'
                  : 'flex-1 overflow-auto p-6'
              }
            >
              <Outlet />
            </div>
          </>
        )}
      </main>
    </div>
  );
};
