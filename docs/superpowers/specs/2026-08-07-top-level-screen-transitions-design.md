# Top-Level Screen Transitions Design

## Summary

Add a restrained entrance transition when navigating between the application's top-level Dashboard, Coding Agent, and Settings screens. The persistent application shell must remain visually stable, and navigation within the Coding Agent section must not trigger the transition.

## Goals

- Make top-level screen changes feel smoother without delaying navigation.
- Keep the sidebar and other persistent shell elements stationary.
- Preserve the existing overflow and full-height behavior of each screen.
- Respect the user's reduced-motion preference.
- Avoid new runtime dependencies.

## Non-goals

- Exit animations or crossfades between old and new screens.
- Animation between the Coding Agent landing page and an active session.
- Animation when switching between Coding Agent sessions.
- Animation of dashboard selections, tabs, dialogs, panels, or loading states.
- Changes to routing, IPC, main-process behavior, or page business logic.

## Route Classification

The renderer derives a stable transition section from `location.pathname`:

| Path | Transition section |
| --- | --- |
| `/` | `dashboard` |
| `/coding-agent` | `coding-agent` |
| `/coding-agent/*` | `coding-agent` |
| `/settings` | `settings` |

All Coding Agent paths share the same key. Consequently, entering or leaving the Coding Agent section animates, while navigation within it does not.

## Architecture

Introduce a focused renderer component responsible for route-section classification and transition rendering. `AppShell` supplies the current pathname and renders its routed `<Outlet />` through this component inside the existing content-layout branches.

The transition wrapper must not surround the complete `<main>` element. Keeping it inside the current branches prevents the persistent header from animating and preserves the distinct overflow behavior used by Dashboard, ordinary pages, and active Coding Agent sessions.

The wrapper is keyed by the top-level transition section. When the section changes, React mounts a new wrapper and its CSS entrance animation runs. The new route renders immediately; there is no exit phase, artificial delay, or retained copy of the previous screen.

## Motion Specification

The entrance animation uses only compositor-friendly properties:

- Initial opacity: `0`
- Final opacity: `1`
- Initial transform: `translateY(8px)`
- Final transform: `translateY(0)`
- Duration: `170ms`
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)`

The wrapper must fill the content area without changing its dimensions or overflow contract. The animation must not disable pointer input or delay page effects and data loading. Blur, scale, and permanently applied `will-change` declarations are excluded.

## Accessibility

Under `prefers-reduced-motion: reduce`, the route wrapper must render without opacity or transform animation. Navigation must not move focus automatically, suppress focus indicators, or alter keyboard behavior.

## Error Handling

The transition is presentation-only and introduces no asynchronous operation or recoverable failure state. Existing route errors and page-level errors remain responsible for their current behavior. Unknown paths continue to use the existing redirect to Dashboard.

## Testing

Prefer testing route classification as a pure function rather than asserting CSS timing in JSDOM.

Automated coverage should verify:

- Dashboard, Coding Agent, and Settings map to distinct section keys.
- Coding Agent landing and nested session paths map to the same section key.
- Unexpected nested Coding Agent paths remain within the Coding Agent section.

Manual verification should cover:

- Dashboard → Coding Agent → Settings transitions.
- Coding Agent landing → active session without a top-level transition.
- Switching active sessions without a top-level transition.
- Rapid top-level navigation without stale content.
- Dashboard and Coding Agent scrolling and clipping behavior.
- Light and dark themes.
- Reduced-motion emulation.
- Keyboard navigation and visible focus.

Run the project checks after implementation:

```bash
npm run typecheck
npm test
npm run lint
npm run package
```

## Expected Code Scope

The implementation should remain limited to:

- A small route-transition renderer component and its pure route-classification helper.
- A focused change to `AppShell` that places routed content inside the wrapper.
- Global transition keyframes and reduced-motion styling.
- Focused tests for route classification and integration behavior where practical.
