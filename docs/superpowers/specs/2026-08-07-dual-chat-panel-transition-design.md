# Dual-Chat Panel Transition Design

## Summary

Add a synchronized side-panel transition when the user opens or closes the dual-chat layout. The primary chat smoothly makes room while the secondary chat slides in from the right; closing reverses the same motion before the secondary chat unmounts.

## Goals

- Make dual-chat opening and closing feel smooth and spatially coherent.
- Preserve the existing side-by-side, resizable dual-chat layout.
- Keep frequent layout changes responsive.
- Support interrupted and reversed transitions without flashes or stale panels.
- Respect reduced-motion preferences and preserve keyboard accessibility.

## Non-goals

- Converting the secondary chat into an overlay drawer.
- Animating session changes within an already open secondary panel.
- Changing session loading, selection, persistence, or URL query behavior.
- Adding a motion-library dependency.
- Changing IPC or main-process behavior.

## Architecture

`CodingAgentWorkspace` remains responsible for layout mode and divider resizing. The workspace augments its existing `single | dual` mode with two presentation states:

- `isSecondaryMounted`: keeps the secondary panel rendered during its closing transition.
- `isSecondaryVisible`: controls whether the dual layout is visually expanded or collapsed.

This separation allows the requested layout mode to change immediately while preserving the outgoing panel long enough to animate.

## Opening Lifecycle

1. The user chooses dual-chat mode.
2. The workspace mounts the secondary panel in a collapsed right-side track.
3. On the next animation frame, the workspace marks the secondary panel visible.
4. The primary track narrows while the divider and secondary track expand.
5. The secondary content fades in and translates into place from the right.

## Closing Lifecycle

1. The user chooses single-chat mode.
2. The workspace marks the secondary panel hidden but keeps it mounted.
3. The opening transition reverses.
4. After the transition duration, the secondary panel unmounts.
5. The primary chat's inspection panel is restored only after closing finishes.

If the user reopens dual mode while closing, the pending unmount is cancelled and the existing panel reverses into its open state. Rapid toggles must not leave the layout stuck or render stale secondary content.

## Layout and Resizing

The visual transition synchronizes:

- Primary chat track width.
- Divider width and opacity.
- Secondary chat track width.
- Secondary content translation and opacity.

The open layout preserves the current user-selected primary-panel ratio. Divider dragging remains immediate and must not use the open/close transition duration. The divider is interactive only when the dual layout is fully visible.

## Motion Specification

- Duration: `220ms`.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Secondary initial transform: `translateX(24px)`.
- Secondary final transform: `translateX(0)`.
- Secondary initial opacity: `0`.
- Secondary final opacity: `1`.

Do not animate blur or shadows. The transition may animate grid sizing for the synchronized layout change and must use transform and opacity for the secondary content.

## Accessibility

Under `prefers-reduced-motion: reduce`, the layout switches immediately without movement or a delayed unmount.

As soon as closing begins, the secondary panel must become non-interactive and hidden from assistive technology. If focus is inside the secondary panel when closing begins, focus moves to the dual-layout toggle. The collapsed divider and secondary panel must not remain exposed in single mode. Existing keyboard controls for the divider remain available when dual mode is fully open.

## Error Handling

The transition introduces no asynchronous backend work. A pending close timer or animation-frame request must be cancelled when the state reverses or the workspace unmounts. Existing secondary-session loading and error states remain unchanged.

## Testing

Automated coverage should verify:

- The secondary panel remains mounted during closing.
- The secondary panel unmounts after `220ms`.
- Reopening during closing cancels the pending unmount.
- Reduced motion removes the closing delay.
- Dual-layout column calculations preserve the selected split ratio.
- Existing session selection and resizing behavior remains valid.

Manual verification should cover:

- Opening and closing from the layout controls.
- Rapid open/close reversal.
- Closing after resizing the divider.
- Reopening after a resized close.
- Focus behavior when closing from inside the secondary panel.
- Keyboard separator controls.
- Reduced-motion emulation.
- Light and dark themes.

## Expected Code Scope

Implementation should remain within the renderer and be limited to:

- Dual-chat transition lifecycle state and focused helpers.
- `CodingAgentWorkspace` layout wrappers and interaction behavior.
- Transition styling and reduced-motion rules.
- Focused tests for lifecycle and layout calculations.
