# Dual-Chat Panel Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate the secondary coding-agent chat in and out from the right while the primary chat synchronously resizes.

**Architecture:** A focused hook owns the mount/visible lifecycle and safely cancels animation frames and close timers. Pure layout helpers produce compatible grid tracks for interpolation, while `CodingAgentWorkspace` retains ownership of mode, focus, and divider resizing. CSS performs the 220ms grid, opacity, and transform transitions without adding a dependency.

**Tech Stack:** React 19, TypeScript 5, Tailwind CSS 4, Vitest, Testing Library, CSS Grid.

## Global Constraints

- Use a synchronized push layout, not an overlay drawer.
- Use exactly `220ms` with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Move secondary content from `translateX(24px)` to `translateX(0)` and `opacity: 0` to `opacity: 1`.
- Keep the secondary panel mounted until closing completes.
- Cancel pending close work when dual mode reopens.
- Preserve the selected divider ratio across closing and reopening.
- Disable transition delay and movement under `prefers-reduced-motion: reduce`.
- Make closing secondary content inert and hidden from assistive technology.
- Do not add dependencies or change IPC, backend behavior, session selection, or query parameters.

---

### Task 1: Transition lifecycle and grid calculations

**Files:**
- Create: `src/renderer/features/coding-agent/hooks/useDualChatTransition.ts`
- Create: `src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx`
- Create: `src/renderer/lib/use-prefers-reduced-motion.ts`
- Modify: `src/renderer/features/coding-agent/lib/dual-chat-layout.ts`
- Modify: `src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts`

**Interfaces:**
- Produces: `DUAL_CHAT_TRANSITION_DURATION_MS = 220`
- Produces: `useDualChatTransition(mode: CodingAgentLayoutMode, prefersReducedMotion: boolean): { isSecondaryMounted: boolean; isSecondaryVisible: boolean }`
- Produces: `usePrefersReducedMotion(): boolean`
- Produces: `getDualChatGridTemplate(primaryPanelPercent: number, expanded: boolean): string`

- [ ] **Step 1: Add failing grid-template tests**

Extend `src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts` imports with `getDualChatGridTemplate`, then add:

```ts
it('builds compatible collapsed and expanded dual-chat grid tracks', () => {
  expect(getDualChatGridTemplate(40, false)).toBe(
    'minmax(0, 100fr) 0px minmax(0, 0fr)',
  );
  expect(getDualChatGridTemplate(40, true)).toBe(
    'minmax(0, 40fr) 8px minmax(0, 60fr)',
  );
});

it('clamps dual-chat split ratios before building grid tracks', () => {
  expect(getDualChatGridTemplate(-10, true)).toContain(
    'minmax(0, 0fr) 8px minmax(0, 100fr)',
  );
  expect(getDualChatGridTemplate(120, true)).toContain(
    'minmax(0, 100fr) 8px minmax(0, 0fr)',
  );
});
```

- [ ] **Step 2: Run the layout tests and confirm the helper is missing**

```bash
npx vitest run src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts
```

Expected: FAIL because `getDualChatGridTemplate` is not exported.

- [ ] **Step 3: Implement the grid-template helper**

Add to `src/renderer/features/coding-agent/lib/dual-chat-layout.ts`:

```ts
export const getDualChatGridTemplate = (
  primaryPanelPercent: number,
  expanded: boolean,
): string => {
  if (!expanded) {
    return 'minmax(0, 100fr) 0px minmax(0, 0fr)';
  }

  const primary = Math.min(100, Math.max(0, primaryPanelPercent));
  return `minmax(0, ${primary}fr) ${DUAL_CHAT_DIVIDER_WIDTH}px minmax(0, ${100 - primary}fr)`;
};
```

- [ ] **Step 4: Run the layout tests and confirm they pass**

```bash
npx vitest run src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts
```

Expected: PASS with seven tests.

- [ ] **Step 5: Write failing lifecycle tests**

Create `src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodingAgentLayoutMode } from '../components/CodingAgentLayoutControls';
import {
  DUAL_CHAT_TRANSITION_DURATION_MS,
  useDualChatTransition,
} from './useDualChatTransition';

describe('useDualChatTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderTransition = (
    initialMode: CodingAgentLayoutMode = 'single',
    prefersReducedMotion = false,
  ) =>
    renderHook(
      ({ mode, reducedMotion }) =>
        useDualChatTransition(mode, reducedMotion),
      {
        initialProps: {
          mode: initialMode,
          reducedMotion: prefersReducedMotion,
        },
      },
    );

  it('mounts collapsed, then reveals the secondary panel on the next frame', () => {
    const { result, rerender } = renderTransition();

    rerender({ mode: 'dual', reducedMotion: false });
    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: false,
    });

    act(() => vi.advanceTimersByTime(0));
    expect(result.current.isSecondaryVisible).toBe(true);
  });

  it('keeps the panel mounted until the closing duration finishes', () => {
    const { result, rerender } = renderTransition('dual');
    act(() => vi.advanceTimersByTime(0));

    rerender({ mode: 'single', reducedMotion: false });
    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: false,
    });

    act(() => vi.advanceTimersByTime(DUAL_CHAT_TRANSITION_DURATION_MS - 1));
    expect(result.current.isSecondaryMounted).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.isSecondaryMounted).toBe(false);
  });

  it('cancels a pending unmount when dual mode reopens', () => {
    const { result, rerender } = renderTransition('dual');
    act(() => vi.advanceTimersByTime(0));
    rerender({ mode: 'single', reducedMotion: false });
    act(() => vi.advanceTimersByTime(100));

    rerender({ mode: 'dual', reducedMotion: false });
    act(() => vi.advanceTimersByTime(DUAL_CHAT_TRANSITION_DURATION_MS));

    expect(result.current).toEqual({
      isSecondaryMounted: true,
      isSecondaryVisible: true,
    });
  });

  it('switches immediately when reduced motion is requested', () => {
    const { result, rerender } = renderTransition('dual', true);
    expect(result.current.isSecondaryVisible).toBe(true);

    rerender({ mode: 'single', reducedMotion: true });
    expect(result.current).toEqual({
      isSecondaryMounted: false,
      isSecondaryVisible: false,
    });
  });
});
```

- [ ] **Step 6: Run the lifecycle tests and confirm the hook is missing**

```bash
npx vitest run src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx
```

Expected: FAIL because `useDualChatTransition.ts` does not exist.

- [ ] **Step 7: Implement reduced-motion preference tracking**

Create `src/renderer/lib/use-prefers-reduced-motion.ts`:

```ts
import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const usePrefersReducedMotion = (): boolean => {
  const [matches, setMatches] = useState(
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setMatches(media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  return matches;
};
```

- [ ] **Step 8: Implement the tested transition lifecycle**

Create `src/renderer/features/coding-agent/hooks/useDualChatTransition.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { CodingAgentLayoutMode } from '../components/CodingAgentLayoutControls';

export const DUAL_CHAT_TRANSITION_DURATION_MS = 220;

export const useDualChatTransition = (
  mode: CodingAgentLayoutMode,
  prefersReducedMotion: boolean,
) => {
  const [isSecondaryMounted, setIsSecondaryMounted] = useState(
    mode === 'dual',
  );
  const [isSecondaryVisible, setIsSecondaryVisible] = useState(
    mode === 'dual',
  );
  const frameRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }

    if (mode === 'dual') {
      if (!isSecondaryMounted) {
        setIsSecondaryMounted(true);
      } else if (prefersReducedMotion) {
        setIsSecondaryVisible(true);
      } else {
        frameRef.current = window.requestAnimationFrame(() => {
          setIsSecondaryVisible(true);
          frameRef.current = undefined;
        });
      }
    } else {
      setIsSecondaryVisible(false);
      if (isSecondaryMounted) {
        if (prefersReducedMotion) {
          setIsSecondaryMounted(false);
        } else {
          closeTimerRef.current = window.setTimeout(() => {
            setIsSecondaryMounted(false);
            closeTimerRef.current = undefined;
          }, DUAL_CHAT_TRANSITION_DURATION_MS);
        }
      }
    }

    return () => {
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [isSecondaryMounted, mode, prefersReducedMotion]);

  return { isSecondaryMounted, isSecondaryVisible };
};
```

- [ ] **Step 9: Run focused tests and type checking**

```bash
npx vitest run \
  src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx \
  src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts
npm run typecheck
```

Expected: both suites pass and TypeScript reports no diagnostics.

- [ ] **Step 10: Commit the lifecycle foundation**

```bash
git add \
  src/renderer/features/coding-agent/hooks/useDualChatTransition.ts \
  src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx \
  src/renderer/lib/use-prefers-reduced-motion.ts \
  src/renderer/features/coding-agent/lib/dual-chat-layout.ts \
  src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts
git commit -m "feat(dual-chat): add panel transition lifecycle" \
  -m "- Keep secondary content mounted through its closing duration.\n- Cancel pending unmounts when dual mode reopens.\n- Add reduced-motion behavior and interpolable grid-track calculations."
```

---

### Task 2: Workspace integration and transition styling

**Files:**
- Modify: `src/renderer/features/coding-agent/components/CodingAgentLayoutControls.tsx`
- Modify: `src/renderer/features/coding-agent/views/CodingAgentWorkspace.tsx`
- Modify: `src/index.css`
- Test: `src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx`

**Interfaces:**
- Consumes: `useDualChatTransition(mode, prefersReducedMotion)` from Task 1
- Consumes: `usePrefersReducedMotion()` from Task 1
- Consumes: `getDualChatGridTemplate(primaryPanelPercent, expanded)` from Task 1
- Produces: optional `dualButtonRef: Ref<HTMLButtonElement>` on `CodingAgentLayoutControls`
- Produces: `.dual-chat-workspace`, `.dual-chat-divider`, and `.dual-chat-secondary` styles

- [ ] **Step 1: Extend the layout-control rendering test**

In `src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx`, extend the accessible-controls assertion with:

```ts
expect(markup).toContain('data-layout-control="dual"');
```

- [ ] **Step 2: Run the component test and confirm the marker is missing**

```bash
npx vitest run src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx
```

Expected: FAIL because the dual control does not yet render `data-layout-control="dual"`.

- [ ] **Step 3: Expose the dual-layout button ref**

Update `CodingAgentLayoutControls.tsx`:

```tsx
import type { Ref } from 'react';
import { Button } from '../../../components/ui/button';

// Keep CodingAgentLayoutMode unchanged.

type Props = {
  mode: CodingAgentLayoutMode;
  onModeChange: (mode: CodingAgentLayoutMode) => void;
  dualButtonRef?: Ref<HTMLButtonElement>;
};
```

Accept `dualButtonRef` in the component and add these properties to the dual button:

```tsx
ref={dualButtonRef}
data-layout-control="dual"
```

- [ ] **Step 4: Integrate lifecycle, focus, and grid state in `CodingAgentWorkspace`**

Add imports for the new hook, preference hook, duration constant, and grid helper. Add:

```tsx
const secondaryPanelRef = useRef<HTMLDivElement>(null);
const dualLayoutButtonRef = useRef<HTMLButtonElement>(null);
const prefersReducedMotion = usePrefersReducedMotion();
const { isSecondaryMounted, isSecondaryVisible } = useDualChatTransition(
  mode,
  prefersReducedMotion,
);
```

Replace rounded percentage storage in `updatePrimaryPanelWidth` with the precise ratio:

```ts
setPrimaryPanelPercent((nextWidth / availableWidth) * 100);
```

Create the mode handler:

```ts
const handleModeChange = (nextMode: CodingAgentLayoutMode) => {
  if (
    nextMode === 'single' &&
    secondaryPanelRef.current?.contains(document.activeElement)
  ) {
    dualLayoutButtonRef.current?.focus();
  }
  setMode(nextMode);
};
```

Build workspace style only while the secondary panel is mounted:

```tsx
const workspaceStyle = isSecondaryMounted
  ? ({
      gridTemplateColumns: getDualChatGridTemplate(
        primaryPanelPercent,
        isSecondaryVisible,
      ),
      '--dual-chat-transition-duration': `${DUAL_CHAT_TRANSITION_DURATION_MS}ms`,
    } as CSSProperties)
  : undefined;
```

When mounted, render the workspace as a three-track grid with:

```tsx
data-secondary-visible={isSecondaryVisible}
data-resizing={isResizing}
className={
  isSecondaryMounted
    ? 'dual-chat-workspace grid min-h-0 flex-1 overflow-hidden'
    : 'min-h-0 flex-1 overflow-hidden'
}
```

Wrap the primary session in `div.min-w-0.overflow-hidden`, pass `showInspection={!isSecondaryMounted}`, and render controls as:

```tsx
<CodingAgentLayoutControls
  mode={mode}
  onModeChange={handleModeChange}
  dualButtonRef={dualLayoutButtonRef}
/>
```

While `isSecondaryMounted`, render the existing divider with:

```tsx
aria-hidden={!isSecondaryVisible}
tabIndex={isSecondaryVisible ? 0 : -1}
className="dual-chat-divider ...existing classes..."
```

Guard divider keyboard and pointer handlers with `if (!isSecondaryVisible) return;`.

Wrap `SecondaryChatPanel` with:

```tsx
<div
  ref={secondaryPanelRef}
  aria-hidden={!isSecondaryVisible}
  inert={!isSecondaryVisible}
  className="dual-chat-secondary min-w-0 overflow-hidden"
>
  <SecondaryChatPanel primaryRunId={primaryRunId} />
</div>
```

Round `primaryPanelPercent` only for `aria-valuenow` and `aria-valuetext`.

- [ ] **Step 5: Add synchronized transition styles**

Append inside `@layer components` in `src/index.css`:

```css
  .dual-chat-workspace {
    transition: grid-template-columns
      var(--dual-chat-transition-duration, 220ms)
      cubic-bezier(0.22, 1, 0.36, 1);
  }

  .dual-chat-divider {
    opacity: 0;
    transition: opacity var(--dual-chat-transition-duration, 220ms)
      cubic-bezier(0.22, 1, 0.36, 1);
  }

  .dual-chat-secondary {
    opacity: 0;
    transform: translateX(24px);
    transition:
      opacity var(--dual-chat-transition-duration, 220ms)
        cubic-bezier(0.22, 1, 0.36, 1),
      transform var(--dual-chat-transition-duration, 220ms)
        cubic-bezier(0.22, 1, 0.36, 1);
  }

  .dual-chat-workspace[data-secondary-visible="true"]
    .dual-chat-divider,
  .dual-chat-workspace[data-secondary-visible="true"]
    .dual-chat-secondary {
    opacity: 1;
  }

  .dual-chat-workspace[data-secondary-visible="true"]
    .dual-chat-secondary {
    transform: translateX(0);
  }

  .dual-chat-workspace[data-resizing="true"] {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .dual-chat-workspace,
    .dual-chat-divider,
    .dual-chat-secondary {
      transition: none;
    }
  }
```

- [ ] **Step 6: Run focused component, lifecycle, and layout tests**

```bash
npx vitest run \
  src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx \
  src/renderer/features/coding-agent/hooks/useDualChatTransition.test.tsx \
  src/renderer/features/coding-agent/lib/dual-chat-layout.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 7: Run project verification**

Because Electron runtime currently requires ABI 148, first rebuild `better-sqlite3` for Node tests, run checks, then restore Electron native modules:

```bash
npm rebuild better-sqlite3
npm test
npm run typecheck
npm run lint
git diff --check
npm run package
npm run rebuild
```

Expected:

- All Vitest tests pass.
- TypeScript exits without diagnostics.
- ESLint reports no errors; the three pre-existing import warnings may remain.
- `git diff --check` is clean.
- Electron Forge packages successfully.
- The final rebuild restores `better-sqlite3` and `node-pty` for Electron ABI 148.

- [ ] **Step 8: Perform Electron smoke and manual motion checks**

Run `npm start` and verify:

1. Opening dual mode smoothly narrows the primary chat while the secondary chat slides in from the right.
2. Closing reverses the motion before unmounting the secondary panel.
3. Rapid close/reopen reverses cleanly without a flash.
4. A resized split reopens at the same ratio.
5. Divider dragging remains immediate.
6. Closing while focus is in the secondary panel returns focus to the layout control.
7. Reduced-motion mode switches immediately.
8. Light and dark themes render the same motion.
9. No native ABI or unhandled-promise errors appear.

- [ ] **Step 9: Commit the integrated transition**

```bash
git add \
  src/renderer/features/coding-agent/components/CodingAgentLayoutControls.tsx \
  src/renderer/features/coding-agent/views/CodingAgentWorkspace.tsx \
  src/index.css \
  src/renderer/features/coding-agent/components/coding-agent-layout.test.tsx
git commit -m "feat(dual-chat): animate the secondary panel" \
  -m "- Synchronize primary width, divider, and secondary-panel movement.\n- Preserve secondary content through close animations and interrupted reversals.\n- Restore focus safely and disable movement for reduced-motion users."
```
