import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../lib/use-theme';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/coding-agent', label: 'Coding Agent', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export const AppShell = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const isCodingAgentSession = /^\/coding-agent\/[^/]+\/[^/]+$/.test(
    location.pathname,
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-sm">
            AW
          </div>
          <span className="font-semibold tracking-tight">Agentic Worktrees</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <h1 className="text-base font-semibold tracking-tight">
            {navItems.find((i) =>
              i.end ? i.to === location.pathname : location.pathname.startsWith(i.to),
            )?.label ?? 'Dashboard'}
          </h1>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
            title={theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {theme === 'dark' ? '\u2600\uFE0F' : '\u{1F319}'}
          </button>
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
      </main>
    </div>
  );
};
