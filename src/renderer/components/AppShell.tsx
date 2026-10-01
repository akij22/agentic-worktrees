import { Outlet, useLocation } from "react-router-dom";
import { AppNavigation, AppNavigationFooter, findPageLabel } from "./AppNavigation";
import { RouteTransition } from "./RouteTransition";
import { isFullBleedWorkspace, WORKSPACE_SIDEBAR_DEFAULT_WIDTH } from "./app-shell-layout";

export const AppShell = () => {
  const location = useLocation();
  const isFullBleed = isFullBleedWorkspace(location.pathname);
  const isChat = location.pathname === "/" || location.pathname === "/chat" || location.pathname.startsWith("/chat/");

  const pageOwnsSidebar = isChat || location.pathname === "/marketplace";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Threads and Marketplace own their populated sidebars. */}
      {!pageOwnsSidebar ? (
        <aside
          aria-label="Application sidebar"
          style={{ width: WORKSPACE_SIDEBAR_DEFAULT_WIDTH }}
          className="flex min-h-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-secondary text-sidebar-foreground"
        >
          <AppNavigation />
          <div className="flex-1" />
          <AppNavigationFooter />
        </aside>
      ) : null}
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
                {findPageLabel(location.pathname) ?? "Threads"}
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
