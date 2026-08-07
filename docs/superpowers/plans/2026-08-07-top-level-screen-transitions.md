# Top-Level Screen Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast fade-and-lift entrance when navigating among Dashboard, Coding Agent, and Settings while keeping the application shell and Coding Agent session navigation stable.

**Architecture:** A pure helper classifies paths into top-level route sections, and a focused `RouteTransition` component keys an animated wrapper by that section. `AppShell` renders each existing outlet through the wrapper without changing its layout branches; global CSS supplies a compositor-friendly animation only when reduced motion is not requested.

**Tech Stack:** React 19, React Router 7, TypeScript 5, Tailwind CSS 4, Vitest, React DOM server rendering.

## Global Constraints

- Use an enter-only transition; do not retain or animate the outgoing screen.
- Animate from `opacity: 0` and `translateY(8px)` to `opacity: 1` and `translateY(0)` over exactly `170ms`.
- Use `cubic-bezier(0.22, 1, 0.36, 1)` easing.
- Do not add a runtime dependency.
- Keep `/coding-agent` and every `/coding-agent/*` path in one transition section.
- Keep the sidebar and persistent shell outside the animated wrapper.
- Preserve the existing Dashboard, standard-page, and active-session overflow behavior.
- Apply no animation when `prefers-reduced-motion: reduce` is active.
- Do not change renderer business logic, IPC contracts, or main-process code.

---

### Task 1: Route transition boundary

**Files:**
- Create: `src/renderer/components/route-transition.ts`
- Create: `src/renderer/components/RouteTransition.tsx`
- Test: `src/renderer/components/route-transition.test.tsx`

**Interfaces:**
- Produces: `getRouteTransitionSection(pathname: string): RouteTransitionSection`
- Produces: `RouteTransitionSection = 'dashboard' | 'coding-agent' | 'settings'`
- Produces: `RouteTransition({ pathname, className, children }: RouteTransitionProps): JSX.Element`
- Consumes: the existing `cn(...inputs)` helper from `src/renderer/lib/utils.ts`

- [ ] **Step 1: Write the failing route-classification and wrapper tests**

Create `src/renderer/components/route-transition.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteTransition } from './RouteTransition';
import { getRouteTransitionSection } from './route-transition';

describe('RouteTransition', () => {
  it('classifies top-level screens into distinct transition sections', () => {
    expect(getRouteTransitionSection('/')).toBe('dashboard');
    expect(getRouteTransitionSection('/coding-agent')).toBe('coding-agent');
    expect(getRouteTransitionSection('/settings')).toBe('settings');
  });

  it('keeps all Coding Agent session paths in the Coding Agent section', () => {
    expect(getRouteTransitionSection('/coding-agent/worktree-1/run-1')).toBe(
      'coding-agent',
    );
    expect(getRouteTransitionSection('/coding-agent/unexpected/nested/path')).toBe(
      'coding-agent',
    );
  });

  it('matches the existing Dashboard redirect behavior for unknown paths', () => {
    expect(getRouteTransitionSection('/unknown')).toBe('dashboard');
  });

  it('renders an animated layout wrapper without changing its content', () => {
    const markup = renderToStaticMarkup(
      <RouteTransition pathname="/settings" className="h-full">
        <span>Settings content</span>
      </RouteTransition>,
    );

    expect(markup).toContain('class="route-screen-enter h-full"');
    expect(markup).toContain('<span>Settings content</span>');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the new modules are missing**

Run:

```bash
npx vitest run src/renderer/components/route-transition.test.tsx
```

Expected: FAIL because `./RouteTransition` and `./route-transition` do not exist.

- [ ] **Step 3: Implement the pure route classifier**

Create `src/renderer/components/route-transition.ts`:

```ts
export type RouteTransitionSection =
  | 'dashboard'
  | 'coding-agent'
  | 'settings';

export const getRouteTransitionSection = (
  pathname: string,
): RouteTransitionSection => {
  if (
    pathname === '/coding-agent' ||
    pathname.startsWith('/coding-agent/')
  ) {
    return 'coding-agent';
  }

  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return 'settings';
  }

  return 'dashboard';
};
```

The Dashboard fallback deliberately matches the wildcard route's existing redirect to `/` and avoids introducing a transient fourth animation section.

- [ ] **Step 4: Implement the keyed transition wrapper**

Create `src/renderer/components/RouteTransition.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { getRouteTransitionSection } from './route-transition';

interface RouteTransitionProps {
  pathname: string;
  className?: string;
  children: ReactNode;
}

export const RouteTransition = ({
  pathname,
  className,
  children,
}: RouteTransitionProps) => (
  <div
    key={getRouteTransitionSection(pathname)}
    className={cn('route-screen-enter', className)}
  >
    {children}
  </div>
);
```

The key belongs to the returned wrapper so React replaces that wrapper only when the classified top-level section changes. Nested Coding Agent navigation retains the same key.

- [ ] **Step 5: Run the focused test and confirm it passes**

Run:

```bash
npx vitest run src/renderer/components/route-transition.test.tsx
```

Expected: PASS with four tests.

- [ ] **Step 6: Run type checking for the new component boundary**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 7: Commit the tested transition boundary**

```bash
git add src/renderer/components/route-transition.ts \
  src/renderer/components/RouteTransition.tsx \
  src/renderer/components/route-transition.test.tsx
git commit -m "feat(renderer): add keyed route transition boundary" \
  -m "- Classify top-level paths while grouping all Coding Agent session routes.\n- Add a reusable wrapper that remounts only when the top-level section changes.\n- Cover route grouping, fallback behavior, wrapper styling, and rendered content."
```

---

### Task 2: App shell integration and motion styling

**Files:**
- Modify: `src/renderer/components/AppShell.tsx:1-6,228-250`
- Modify: `src/index.css` after the existing `.diff-code-font` component rule
- Test: `src/renderer/components/route-transition.test.tsx`

**Interfaces:**
- Consumes: `RouteTransition({ pathname, className, children })` from Task 1
- Consumes: `location.pathname` already available in `AppShell`
- Produces: `.route-screen-enter` global CSS class
- Produces: `route-screen-enter` CSS keyframes

- [ ] **Step 1: Import the route transition wrapper into the application shell**

Add this import beside the other local component imports in `src/renderer/components/AppShell.tsx`:

```tsx
import { RouteTransition } from './RouteTransition';
```

- [ ] **Step 2: Wrap both existing outlet positions without moving the layout branches**

Replace the Dashboard outlet:

```tsx
<div className="min-h-0 flex-1 overflow-hidden">
  <RouteTransition pathname={location.pathname} className="h-full">
    <Outlet />
  </RouteTransition>
</div>
```

Replace the standard/session outlet inside its existing content container:

```tsx
<RouteTransition pathname={location.pathname} className="h-full">
  <Outlet />
</RouteTransition>
```

Do not wrap `<main>`, the sidebar, the resize separator, or the conditional page header. Keep the existing `isDashboard` and `isCodingAgentSession` branches unchanged apart from their outlet contents.

- [ ] **Step 3: Add the reduced-motion-safe global entrance animation**

Append the following inside `@layer components` in `src/index.css`, after `.diff-code-font`:

```css
  @keyframes route-screen-enter {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .route-screen-enter {
      animation: route-screen-enter 170ms cubic-bezier(0.22, 1, 0.36, 1)
        both;
    }
  }
```

Using `no-preference` makes the unanimated state the default whenever the environment requests reduced motion or does not expose animation preference normally.

- [ ] **Step 4: Run the focused transition test**

Run:

```bash
npx vitest run src/renderer/components/route-transition.test.tsx
```

Expected: PASS with four tests.

- [ ] **Step 5: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: all Vitest suites pass with exit code 0.

- [ ] **Step 6: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
git diff --check
```

Expected: all commands exit with code 0 and report no new diagnostics or whitespace errors.

- [ ] **Step 7: Build the Electron application**

Run:

```bash
npm run package
```

Expected: Electron Forge packages the application successfully with exit code 0.

- [ ] **Step 8: Perform the manual renderer checks**

Run:

```bash
npm start
```

Confirm in the Electron window:

1. Dashboard → Coding Agent → Settings uses a subtle fade and 8px upward entrance.
2. The sidebar and resize separator remain stationary.
3. Coding Agent landing → active session does not replay the route entrance.
4. Switching active sessions does not replay the route entrance.
5. Dashboard and active-session content still fill their available height without new scrollbars or clipping.
6. Rapid top-level navigation never leaves stale content visible.
7. Light and dark themes use identical motion timing.
8. Emulating `prefers-reduced-motion: reduce` disables both fading and movement.
9. Keyboard navigation and focus indicators remain unchanged.

Stop the development process after the checks.

- [ ] **Step 9: Commit the integrated animation**

```bash
git add src/renderer/components/AppShell.tsx src/index.css
git commit -m "feat(renderer): animate top-level screen entrances" \
  -m "- Render routed content through the keyed transition boundary without animating the shell.\n- Add a 170ms fade-and-lift entrance using compositor-friendly properties.\n- Disable route motion when the user requests reduced animation."
```
